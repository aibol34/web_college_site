require('dotenv').config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
const { networkInterfaces } = require("os");
const fs = require("fs");
const morgan = require("morgan");
const multer = require('multer');
const csv = require('csv-parser');
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================== ENV & CONSTANTS ==========================
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:12392';
const DIRECTUS_API_KEY = process.env.DIRECTUS_API_KEY || 'NM_dTn_hkRBjZCAXazqaYVdoRBz6qoaL';
const SECRET_PASSKEY = '00aa00aa';
const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'schedule.html');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// ========================== MIDDLEWARE ==========================
app.use(cors({
    origin: [
        "http://web.aspc.kz",
        "http://localhost:12392",
        "http://web.aspc.kz:3000",
        "http://localhost:3000", 
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use("/static", express.static(path.join(__dirname, "static")));
app.use(express.static("public"));
app.use(express.static(__dirname));

// ========================== MAIN PAGE ==========================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "index.html"));
});

// ========================== DIRECTUS PROXY ==========================
app.use('/directus', async (req, res) => {
    try {
        const response = await axios({
            method: req.method,
            url: `${DIRECTUS_URL}${req.path.replace('/directus', '')}`,
            headers: {
                'Authorization': `Bearer ${DIRECTUS_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: req.body,
            params: req.query
        });
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.message
        });
    }
});

// ========================== IMAGE PROXY ==========================
app.get("/proxy-image", async (req, res) => {
    try {
        const imageUrl = decodeURIComponent(req.query.url);
        const response = await axios.get(imageUrl, { 
            responseType: "arraybuffer",
            maxContentLength: 10 * 1024 * 1024
        });
        
        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader("Content-Type", contentType);
        res.send(response.data);
    } catch (error) {
        res.status(500).json({ error: "Ошибка загрузки изображения" });
    }
});

// ========================== NEWS API ==========================
app.get('/api/news', async (req, res) => {
    try {
        const response = await axios.get(`${DIRECTUS_URL}/items/news`, {
            params: {
                fields: 'id,title,content,date,image.*',
                sort: '-date'
            },
            headers: {
                'Authorization': `Bearer ${DIRECTUS_API_KEY}`
            }
        });
        res.json(response.data.data);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения новостей' });
    }
});

// ========================== SCHEDULE FILE HANDLING ==========================
const upload = multer({ dest: 'uploads/' });

function parseCSVtoHTML(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', () => {
                if (rows.length === 0) return resolve('<p>No data found in CSV.</p>');
                const headers = Object.keys(rows[0]);
                let html = '<table><thead><tr>';
                headers.forEach(h => html += `<th>${h}</th>`);
                html += '</tr></thead><tbody>';
                rows.forEach(row => {
                    html += '<tr>';
                    headers.forEach(h => html += `<td>${row[h]}</td>`);
                    html += '</tr>';
                });
                html += '</tbody></table>';
                resolve(html);
            })
            .on('error', reject);
    });
}

function extractDocumentXML(filePath) {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('word/document.xml');
    return entry ? zip.readAsText(entry) : null;
}

function extractTableColorMaps(xmlString) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
    });

    const json = parser.parse(xmlString);
    const tables = json['w:document']['w:body']['w:tbl'] || [];
    const tblArray = Array.isArray(tables) ? tables : [tables];
    const tableColorMaps = [];

    tblArray.forEach((tbl, tblIndex) => {
        const map = [];
        const rows = tbl['w:tr'] || [];
        const trArray = Array.isArray(rows) ? rows : [rows];

        trArray.forEach((row, rowIndex) => {
            const cells = row['w:tc'] || [];
            const tcArray = Array.isArray(cells) ? cells : [cells];

            tcArray.forEach((cell, colIndex) => {
                const props = cell['w:tcPr'] || {};
                const shading = props['w:shd'];
                let fill = null;

                if (shading) {
                    fill = shading['w:fill'] || shading['fill'] || shading['_fill'];
                }

                if (fill && fill !== 'auto') {
                    const color = `#${fill}`;
                    map.push({ row: rowIndex, col: colIndex, color });
                }
            });
        });

        tableColorMaps.push(map);
    });

    return tableColorMaps;
}

function injectColorsIntoHTMLTables(html, tableColorMaps) {
    const tableBlocks = html.match(/<table[\s\S]*?<\/table>/gi);
    if (!tableBlocks) return html;

    const updatedTables = tableBlocks.map((tableHTML, i) => {
        const colorMap = tableColorMaps[i] || [];
        let rowIndex = -1;

        return tableHTML.replace(/<tr>(.*?)<\/tr>/gis, (match, rowContent) => {
            rowIndex++;
            let colIndex = -1;

            const newRow = rowContent.replace(/<td>(.*?)<\/td>/gis, (cellMatch, cellContent) => {
                colIndex++;
                const colorMatch = colorMap.find(c => c.row === rowIndex && c.col === colIndex);
                if (colorMatch) {
                    return `<td style="background-color:${colorMatch.color}">${cellContent}</td>`;
                }
                return `<td>${cellContent}</td>`;
            });

            return `<tr>${newRow}</tr>`;
        });
    });

    let resultHTML = html;
    tableBlocks.forEach((original, i) => {
        resultHTML = resultHTML.replace(original, updatedTables[i]);
    });

    return resultHTML;
}

app.post('/upload', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).send('No file uploaded.');

    const ext = path.extname(file.originalname).toLowerCase();

    try {
        let finalHTML = '';

        if (ext === '.csv') {
            finalHTML = await parseCSVtoHTML(file.path);
        } else if (ext === '.docx') {
            const mammothResult = await mammoth.convertToHtml({ path: file.path });
            const xml = extractDocumentXML(file.path);
            const tableColorMaps = xml ? extractTableColorMaps(xml) : [];
            finalHTML = injectColorsIntoHTMLTables(mammothResult.value, tableColorMaps);
        } else {
            fs.unlink(file.path, () => {});
            return res.status(400).send('Unsupported file type.');
        }

        // ✅ Save to file cache
        fs.writeFileSync(CACHE_FILE, finalHTML, 'utf-8');

        fs.unlink(file.path, () => {});
        res.send(finalHTML);
    } catch (err) {
        console.error(err);
        fs.unlink(file.path, () => {});
        res.status(500).send('Error parsing file.');
    }
});

// ========================== AUTH ==========================
app.post('/auth-passkey', express.json(), (req, res) => {
    const { passkey } = req.body;
    if (passkey === SECRET_PASSKEY) {
        res.status(200).json({ success: true });
    } else {
        res.status(403).json({ success: false });
    }
});

// ========================== CACHED DATA ==========================
app.get('/cached-data', (req, res) => {
    if (!fs.existsSync(CACHE_FILE)) {
        return res.status(404).send('No cached data.');
    }

    const stats = fs.statSync(CACHE_FILE);
    const age = Date.now() - stats.mtimeMs;

    if (age < CACHE_LIFETIME_MS) {
        res.sendFile(CACHE_FILE);
    } else {
        res.status(404).send('No cached data.');
    }
});

// ========================== HTML ROUTER ==========================
app.get("/*", (req, res) => {
    const requestPath = req.params[0];
    const cleanPath = requestPath.replace(/\.html$/, '');
    
    const possiblePaths = [
        path.join(__dirname, `${cleanPath}.html`),
        path.join(__dirname, cleanPath, "index.html"),
        path.join(__dirname, cleanPath, "page1.html"),
    ];
    
    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
        }
    }
    
    res.status(404).sendFile(path.join(__dirname, "views", "404.html"));
});

// ========================== SERVER START ==========================
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Сервер запущен: http://${getLocalIP()}:${PORT}`);
    console.log(`Админ-панель Directus: ${DIRECTUS_URL}`);
});

// ========================== UTILS ==========================
function getLocalIP() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }
    return "localhost";
}

// ========================== ERROR HANDLING ==========================
process.on("uncaughtException", (err) => {
    console.error("Необработанное исключение:", err);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Необработанное отклонение промиса:", promise, "Причина:", reason);
});
