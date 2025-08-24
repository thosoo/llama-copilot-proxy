#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';

const PROXY_PORT = 11434;
const UPSTREAM_PORT = 18080;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Simple SSE upstream that emits reasoning then content then DONE
function startUpstream() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.match(/^(\/(v1\/)?){0,1}chat\/completions$/)) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        const send = (line) => res.write(line);
        // reasoning delta
        send('data: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', choices: [{ index:0, delta: { reasoning_content: 'Thinking.' } }] }) + '\n\n');
        // some content deltas
        const parts = ['Hello', ' ', 'world', '!'];
        let i = 0;
        const interval = setInterval(() => {
          if (i < parts.length) {
            const chunk = { id: '1', object: 'chat.completion.chunk', choices: [{ index:0, delta: { content: parts[i] } }] };
            send('data: ' + JSON.stringify(chunk) + '\n\n');
            i++;
          } else {
            clearInterval(interval);
            send('data: [DONE]\n\n');
            res.end();
          }
        }, 50);
      });
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(UPSTREAM_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const upstream = await startUpstream();
  const proxy = spawn(process.execPath, ['proxy-server.js'], {
    env: { ...process.env, LISTEN_PORT: String(PROXY_PORT), LLAMA_SERVER_PORT: String(UPSTREAM_PORT), UPSTREAM: `http://127.0.0.1:${UPSTREAM_PORT}`, THINKING_DEBUG: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proxy.stdout.on('data', d => process.stdout.write(String(d)));
  proxy.stderr.on('data', d => process.stderr.write(String(d)));

  // give the proxy a moment to start
  await sleep(500);

  // send a streaming request to the proxy
  const postData = JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], stream: true });
  const options = { hostname: '127.0.0.1', port: PROXY_PORT, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };

  let sawContent = false;
  let sawDone = false;
  await new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      res.on('data', (chunk) => {
        const s = chunk.toString();
        // detect content deltas
        if (s.includes('"delta"') && s.includes('"content"')) {
          sawContent = true;
        }
        if (s.includes('[DONE]')) {
          sawDone = true;
        }
      });
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  // cleanup
  proxy.kill('SIGKILL');
  upstream.close();

  if (!sawContent) {
    console.error('❌ Did not see content deltas forwarded through proxy');
    process.exit(1);
  }
  if (!sawDone) {
    console.error('❌ Did not see [DONE] event');
    process.exit(1);
  }
  console.log('✅ SSE content forwarding test passed');
}

run().catch(err => { console.error(err); process.exit(1); });
