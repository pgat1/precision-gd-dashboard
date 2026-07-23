const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============ CONFIG ============
const PORT = 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

// ============ SERVER ============
const server = http.createServer((req, res) => {

  // CORS headers for local use
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve the dashboard HTML file
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const dashPath = path.join(__dirname, 'precision_v5.html');
    if (fs.existsSync(dashPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(dashPath));
    } else {
      res.writeHead(404);
      res.end('Dashboard file not found. Make sure precision_v5.html is in the same folder.');
    }
    return;
  }

  // Proxy Anthropic API calls
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        };

        const apiReq = https.request(options, (apiRes) => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(data);
          });
        });

        apiReq.on('error', (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });

        apiReq.write(JSON.stringify(payload));
        apiReq.end();

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✅ Precision GD Dashboard is running');
  console.log('  📊 Open your browser and go to: http://localhost:' + PORT);
  console.log('');
  console.log('  Press Ctrl+C to stop the server');
  console.log('');
});
