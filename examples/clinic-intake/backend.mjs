// A stand-in for your own backend: the server your app already has, which
// Stowem never talks to. It records what arrives so you can see exactly
// what resolve() produced. Replace it with your real API.

import { createServer } from 'node:http';

export function startBackend(port) {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: body ? JSON.parse(body) : undefined,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ received, close: () => server.close() }));
  });
}
