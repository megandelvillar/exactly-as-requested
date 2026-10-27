/* dev-server.js
 *
 * A tiny server for running the piece on YOUR computer. No packages, no login.
 *   node dev-server.js     then open http://localhost:3000
 *
 * It only serves the files in this folder. (The AI runs in the browser, so
 * there is no backend and no API key.) Any static file server would do, for
 * example `python3 -m http.server`. This one also tells the browser never to
 * cache the files, so you always see your latest edits.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.join(__dirname, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));

  // Safety: never serve anything outside this folder.
  if (!file.startsWith(__dirname + path.sep)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(data);
  });
}).listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
