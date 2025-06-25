document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const uploadButton = document.querySelector('button[onclick="uploadFile()"]');

  const MAX_LENGTH = 8;
  let listening = false;
  let buffer = '';

  // Initially hide
  fileInput.style.display = 'none';
  uploadButton.style.display = 'none';

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      buffer = '';
      listening = true;
      return;
    }

    if (!listening) return;

    const isAlphaNum = /^[a-zA-Z0-9]$/.test(e.key);
    if (!isAlphaNum) return;

    buffer += e.key;

    if (buffer.length === MAX_LENGTH) {
      validatePasskey(buffer).then(success => {
        if (success) {
          fileInput.style.display = '';
          uploadButton.style.display = '';
        }
        // Always reset
        buffer = '';
        listening = false;
      });
    }
  });

  async function validatePasskey(passkey) {
    try {
      const API_BASE = location.hostname.includes("localhost") || location.hostname === "127.0.0.1"
    ? "http://localhost:3000" // local Node.js server
    : "https://almatypolytech.edu.kz"; // production NGINX server

const res = await fetch(`${API_BASE}/auth-passkey`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passkey })
});


      const json = await res.json();
      return json.success === true;
    } catch (err) {
      console.error('[Error validating passkey]', err);
      return false;
    }
  }
});
