const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleObservationRequest } = require('./spherex-observations');

const port = Number(process.env.PORT ?? 8000);
const routes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8'],
  '/vendor/aladin-lite-3.8.2.js': ['vendor/aladin-lite-3.8.2.js', 'text/javascript; charset=utf-8'],
  '/sky-region.mjs': ['sky-region.mjs', 'text/javascript; charset=utf-8']
};

const server = http.createServer(async (request, response) => {
  if (await handleObservationRequest(request, response)) return;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  const pathname = (request.url || '/').split('?')[0];
  const route = Object.hasOwn(routes, pathname) ? routes[pathname] : null;
  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Not found');
    return;
  }

  fs.readFile(path.join(__dirname, route[0]), (error, data) => {
    response.writeHead(error ? 500 : 200, {
      'Content-Type': error ? 'text/plain; charset=utf-8' : route[1],
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : (error ? 'Could not load file' : data));
  });
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the existing server, then run npm start again.`
    : error.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Planet X is running at http://localhost:${server.address().port}`);
  console.log('Press Ctrl+C to stop. Refresh your browser after editing files.');
});
