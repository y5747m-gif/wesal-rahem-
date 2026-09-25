#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), 'public');
const port = Number(process.env.PORT || 4173);
const host = '0.0.0.0';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.split('/').includes('..')) {
      send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
      return;
    }
    if (pathname === '/health') pathname = '/health.json';
    const relative = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(root, relative);
    if (!filePath.startsWith(root)) {
      send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isFile()) {
        const body = await readFile(filePath);
        const type = types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        send(res, 200, body, type);
        return;
      }
    } catch {
      // Missing files fall through to the home page so the site root is never a platform 404.
    }
    if (path.extname(pathname)) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    const home = await readFile(path.join(root, 'index.html'));
    send(res, 200, home, types['.html']);
  } catch (error) {
    send(res, 500, 'Server error', 'text/plain; charset=utf-8');
    console.error(error);
  }
});

server.listen(port, host, () => {
  console.log(`Wesal preview listening on http://${host}:${port}`);
});
