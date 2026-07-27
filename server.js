const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PIN_CODE = process.env.PIN_CODE || '2006';

// Session store
const sessions = {};

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function getSession(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/pgd_session=([a-f0-9]+)/);
  if (match && sessions[match[1]]) {
    const s = sessions[match[1]];
    // Expire after 30 days
    if (Date.now() - s.createdAt < 30 * 24 * 60 * 60 * 1000) return s;
    delete sessions[match[1]];
  }
  return null;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Precision GD — Access</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1e4d2b; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: -apple-system, 'SF Pro Display', sans-serif; }
.card { background: #fff; border-radius: 16px; padding: 44px 40px; width: 100%; max-width: 380px; box-shadow: 0 24px 64px rgba(0,0,0,0.3); text-align: center; }
.brand { font-size: 22px; font-weight: 700; color: #1e4d2b; margin-bottom: 4px; }
.brand-sub { font-size: 12px; color: #999; margin-bottom: 36px; }
.label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: #999; margin-bottom: 10px; text-align: left; }
.pin-input { width: 100%; padding: 14px; border-radius: 10px; border: 1.5px solid #e0ded9; font-size: 22px; text-align: center; letter-spacing: 12px; outline: none; color: #1a1a18; transition: border-color .15s; }
.pin-input:focus { border-color: #1e4d2b; }
.btn { width: 100%; padding: 14px; border-radius: 10px; border: none; background: #1e4d2b; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 14px; transition: background .15s; }
.btn:hover { background: #2a6b3c; }
.error { background: #fdecea; color: #c0392b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 20px; }
</style>
</head>
<body>
<div class="card">
  <div class="brand">Precision Garage Door</div>
  <div class="brand-sub">Tech Intelligence Dashboard</div>
  ${error ? `<div class="error">${error}</div>` : ''}
  <div class="label">Enter access code</div>
  <input type="password" class="pin-input" id="pin" maxlength="6" placeholder="••••" autocomplete="off" autofocus>
  <button class="btn" onclick="submit()">Enter</button>
</div>
<script>
async function submit() {
  const pin = document.getElementById('pin').value;
  const res = await fetch('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  if (res.ok) {
    window.location.href = '/';
  } else {
    document.getElementById('pin').value = '';
    document.getElementById('pin').placeholder = 'Incorrect — try again';
  }
}
document.getElementById('pin').addEventListener('keydown', e => {
  if (e.key === 'Enter') submit();
});
</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }

  // PIN verification
  if (req.method === 'POST' && req.url === '/verify') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { pin } = JSON.parse(body);
        if (pin === PIN_CODE) {
          const sid = generateSessionId();
          sessions[sid] = { createdAt: Date.now() };
          res.setHeader('Set-Cookie', `pgd_session=${sid}; HttpOnly; Path=/; Max-Age=${30*24*60*60}; SameSite=Lax`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(401); res.end(JSON.stringify({ error: 'Wrong PIN' }));
        }
      } catch(e) { res.writeHead(400); res.end('Bad request'); }
    }); return;
  }

  // Logout
  if (req.url === '/logout') {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/pgd_session=([a-f0-9]+)/);
    if (match) delete sessions[match[1]];
    res.setHeader('Set-Cookie', 'pgd_session=; HttpOnly; Path=/; Max-Age=0');
    res.writeHead(302, { Location: '/login' });
    res.end(); return;
  }

  // Login page
  if (req.url === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(loginPage(null)); return;
  }

  // API chat — require session
  if (req.method === 'POST' && req.url === '/api/chat') {
    if (!getSession(req)) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const opts = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        };
        const apiReq = https.request(opts, (apiRes) => {
          let data = '';
          apiRes.on('data', c => data += c);
          apiRes.on('end', () => {
            res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(data);
          });
        });
        apiReq.on('error', e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
        apiReq.write(JSON.stringify(payload));
        apiReq.end();
      } catch(e) { res.writeHead(400); res.end('Bad request'); }
    }); return;
  }

  // Serve dashboard — require session
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    if (!getSession(req)) {
      res.writeHead(302, { Location: '/login' });
      res.end(); return;
    }
    const dashPath = path.join(__dirname, 'precision_v5.html');
    if (fs.existsSync(dashPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(dashPath));
    } else {
      res.writeHead(404); res.end('Dashboard not found');
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Precision GD Dashboard running on port ' + PORT);
});
