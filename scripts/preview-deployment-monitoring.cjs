// Loopback-only server exposing an explicit allowlist, never the repo or secrets.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const files = new Map([
  ['deployment-monitoring.html', 'text/html; charset=utf-8'],
  ['deployment-monitoring.css', 'text/css; charset=utf-8'],
  ['deployment-monitoring-controller.mjs', 'text/javascript; charset=utf-8'],
  ['deployment-monitoring-fixtures.mjs', 'text/javascript; charset=utf-8'],
  ['deployment-monitoring-preview.mjs', 'text/javascript; charset=utf-8']
]);
function createPreviewServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const name = req.url === '/' ? 'deployment-monitoring.html' : req.url.slice(1);
    if (!files.has(name)) { res.writeHead(404); res.end(); return; }
    try {
      const data = await fs.readFile(path.join(__dirname, '../docs/prototypes', name));
      res.writeHead(200, { 'Content-Type': files.get(name) }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end('Preview unavailable'); }
  });
}
if (require.main === module) {
  const server = createPreviewServer();
  server.listen(4177, '127.0.0.1', () => console.log('Synthetic preview: http://127.0.0.1:4177/'));
  server.on('error', () => { console.error('Unable to start local preview'); process.exitCode = 1; });
}
module.exports = { createPreviewServer };
