import express from 'express';
import fetch from 'node-fetch';
import http from 'node:http';
import { pipeline } from 'node:stream';
import httpProxy from 'http-proxy';

const { createProxyServer } = httpProxy;
const LISTEN_PORT = 11434;
const UPSTREAM = 'http://127.0.0.1:11433';

const app = express();
const proxy = createProxyServer({ changeOrigin: true });
app.use(express.json({ limit: '100mb' }));

function addCaps(entry) {
  const caps = new Set(entry.capabilities || []);
  caps.add('tools');
  caps.add('planAndExecute');
  entry.capabilities = [...caps];
  return entry;
}

function patch(json) {
  if (Array.isArray(json)) return json.map(addCaps);
  if (Array.isArray(json.models)) {
    json.models = json.models.map(addCaps);
    return json;
  }
  return addCaps(json);
}

// JSON endpoints that need capability injection
const jsonRoutes = [
  ['GET', '/api/models'],
  ['POST', '/api/show'],
  ['GET', '/v1/models'],
  ['GET', '/api/tags']
];

jsonRoutes.forEach(([method, path]) => {
  app[method.toLowerCase()](path, async (req, res) => {
    try {
      const upstreamRes = await fetch(`${UPSTREAM}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(req.body) : undefined
      });
      const data = await upstreamRes.json();
      res.json(path === '/api/tags' ? data : patch(data));
    } catch (err) {
      res.status(502).json({ error: 'proxy_error' });
    }
  });
});

// Streaming chat completions with tool‑schema fix

app.post(/\/chat\/completions$/, (req, res) => {
  const body = (typeof req.body === 'object' && req.body !== null) ? JSON.parse(JSON.stringify(req.body)) : {};
  if (Array.isArray(body.tools)) {
    body.tools = body.tools.map(t => (t && t.type === 'function' && t.function) ? t.function : t);
  }

  const payload = JSON.stringify(body);
  const upstreamReq = http.request(`${UPSTREAM}${req.originalUrl}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, upRes => {
    res.writeHead(upRes.statusCode || 500, upRes.headers);
    pipeline(upRes, res, () => {});
  });
  upstreamReq.write(payload);
  upstreamReq.end();
});

// Fallback proxy
app.use((req, res) => proxy.web(req, res, { target: `${UPSTREAM}${req.url}` }));

app.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`Proxy listening on http://127.0.0.1:${LISTEN_PORT}`);
});
