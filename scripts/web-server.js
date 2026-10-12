import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.RECALL_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RECALL_PORT must be between 1024 and 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: https://api.github.com; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (!['localhost', '127.0.0.1'].includes((req.headers.host || '').split(':')[0]) || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(403).end('Forbidden'); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end('Bad request'); return; }
    if (pathname === '/') { res.writeHead(302, { Location: '/renderer/site/index.html' }).end(); return; }
    if (!/^\/(renderer|lib)\/[a-zA-Z0-9_./-]+$/.test(pathname) || pathname.includes('..')) {
      res.writeHead(404).end('Not found'); return;
    }
    const filename = path.join(root, pathname);
    try {
      const body = await readFile(filename);
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, '127.0.0.1', () => console.log(`Recall Labs local browser mode: http://localhost:${port}`));
}
