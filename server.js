require('dotenv').config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
const { networkInterfaces } = require("os");
const fs = require("fs");
const morgan = require("morgan");

const app = express();
const PORT = process.env.PORT || 3000;

// ========================== Настройки Directus ==========================
// const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:12392';
// const DIRECTUS_API_KEY = process.env.DIRECTUS_API_KEY || 'NM_dTn_hkRBjZCAXazqaYVdoRBz6qoaL';

// ========================== Логирование ==========================
app.use(morgan('combined'));

// ========================== CORS ==========================
const allowedOrigins = [
    "http://web.aspc.kz",
    "http://localhost:12392",
    "http://web.aspc.kz:3000"
];

app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ========================== Middleware ==========================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use("/static", express.static(path.join(__dirname, "static")));
app.use(express.static("public"));

// ========================== Главная ==========================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "index.html"));
});

// ========================== Прокси для всего Directus ==========================
// app.use('/directus', async (req, res) => {
//   try {
//     const response = await axios({
//       method: req.method,
//       url: `${DIRECTUS_URL}${req.path.replace('/directus', '')}`,
//       headers: {
//         'Authorization': `Bearer ${DIRECTUS_API_KEY}`,
//         'Content-Type': 'application/json'
//       },
//       data: req.body,
//       params: req.query
//     });
//     res.json(response.data);
//   } catch (error) {
//     res.status(error.response?.status || 500).json({
//       error: error.message
//     });
//   }
// });

// ========================== Прокси изображений ==========================
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

// ========================== API для вакансий ==========================
app.get('/api/items/vacancy', async (req, res) => {
  try {
    const vacancies = readVacancies();
    res.json(vacancies);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения вакансий' });
  }
});

// Путь к файлу с вакансиями
const vacanciesFilePath = path.join(__dirname, 'static', 'data', 'vacancies.json');

// Функция для чтения вакансий из файла
function readVacancies() {
  try {
    const data = fs.readFileSync(vacanciesFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Функция для записи вакансий в файл
function writeVacancies(vacancies) {
  fs.writeFileSync(vacanciesFilePath, JSON.stringify(vacancies, null, 2), 'utf8');
}

// ========================== CRUD для вакансий ==========================
app.post('/api/items/vacancy', async (req, res) => {
  try {
    const newVacancy = req.body;
    const vacancies = readVacancies();
    // Добавляем уникальный ID для новой вакансии
    newVacancy.id = Date.now().toString();
    vacancies.push(newVacancy);
    writeVacancies(vacancies);
    res.status(201).json(newVacancy);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка добавления вакансии' });
  }
});

app.delete('/api/items/vacancy/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const vacancies = readVacancies();
    const index = vacancies.findIndex(v => v.id === id);
    if (index !== -1) {
      vacancies.splice(index, 1);
      writeVacancies(vacancies);
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'Вакансия не найдена' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления вакансии' });
  }
});

// Путь к файлу с новостями
const newsFilePath = path.join(__dirname, 'static', 'data', 'news.json');

// Функция для чтения новостей из файла
function readNews() {
  try {
    const data = fs.readFileSync(newsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Функция для записи новостей в файл
function writeNews(news) {
  fs.writeFileSync(newsFilePath, JSON.stringify(news, null, 2), 'utf8');
}

// ========================== API для новостей ==========================
app.get('/api/items/news', async (req, res) => {
  try {
    const news = readNews();
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения новостей' });
  }
});

app.post('/api/items/news', async (req, res) => {
  try {
    const newNews = req.body;
    const news = readNews();
    newNews.id = Date.now().toString();
    news.push(newNews);
    writeNews(news);
    res.status(201).json(newNews);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка добавления новости' });
  }
});

app.delete('/api/items/news/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const news = readNews();
    const index = news.findIndex(n => n.id === id);
    if (index !== -1) {
      news.splice(index, 1);
      writeNews(news);
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'Новость не найдена' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Ошибка удаления новости' });
  }
});

// ========================== Универсальный роутер для всех HTML ==========================
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

// ========================== Запуск сервера ==========================
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Сервер запущен: http://${getLocalIP()}:${PORT}`);
    console.log(`Доступные домены: ${allowedOrigins.join(', ')}`);
});

// ========================== Вспомогательные функции ==========================
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

// ========================== Обработка ошибок ==========================
process.on("uncaughtException", (err) => {
    console.error("Необработанное исключение:", err);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Необработанное отклонение промиса:", promise, "Причина:", reason);
});
