/* 零依赖静态文件服务器：`npm run dev` 启动，支持 --port / --host 参数 */
const http = require('http');
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const prefix = name + '=';
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === name) return process.argv[i + 1];
    if (process.argv[i].startsWith(prefix)) return process.argv[i].slice(prefix.length);
  }
  return def;
}

const PORT = parseInt(arg('--port', process.env.PORT || '7100'), 10);
const HOST = arg('--host', process.env.HOST || '0.0.0.0');
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, HOST, () => {
  console.log(`NCM 转换器已启动: http://localhost:${PORT}/`);
});
