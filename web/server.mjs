/**
 * server.mjs —— 零依赖静态服务器（ESM + 正确 MIME，便于直接玩 web 版）
 * 用法：node server.mjs [端口]      默认 8123
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.argv[2] || process.env.PORT || 8123);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || !extname(p)) p = p === '/' ? '/index.html' : p + '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': 'fullscreen=*, accelerometer=(), gyroscope=(), camera=(), microphone=()',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 ' + err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`StormPlane HTML5  →  http://0.0.0.0:${PORT}/  (root: ${ROOT})`);
});
