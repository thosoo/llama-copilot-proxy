#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';

const PROXY_PORT = 11435;
const UPSTREAM_PORT = 18081;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Upstream that emits reasoning first, then content, then DONE
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
        // emit reasoning first
        send('data: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', choices: [{ index:0, delta: { reasoning_content: 'Reasoning goes here.' } }] }) + '\n\n');
        // then later content
        setTimeout(() => {
          send('data: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', choices: [{ index:0, delta: { content: 'This is the visible answer.' } }] }) + '\n\n');
          setTimeout(() => { send('data: [DONE]\n\n'); res.end(); }, 20);
        }, 20);
      });
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve) => server.listen(UPSTREAM_PORT, '127.0.0.1', () => resolve(server)));
}

async function run() {
  const upstream = await startUpstream();
  const proxy = spawn(process.execPath, ['proxy-server.js'], {
    env: { ...process.env, LISTEN_PORT: String(PROXY_PORT), LLAMA_SERVER_PORT: String(UPSTREAM_PORT), UPSTREAM: `http://127.0.0.1:${UPSTREAM_PORT}`, THINKING_MODE: 'show_reasoning' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proxy.stdout.on('data', d => process.stdout.write(String(d)));
  proxy.stderr.on('data', d => process.stderr.write(String(d)));

  await sleep(300);

  const postData = JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], stream: true });
  const options = { hostname: '127.0.0.1', port: PROXY_PORT, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };

  let sawThinkingPrefix = false;
  let sawSeparator = false;
  let sawFinalContent = false;
  let sawDone = false;

  await new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      res.on('data', (chunk) => {
        const s = chunk.toString();
        // look for injected marker and separator in content deltas
        const lines = s.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { sawDone = true; continue; }
          try {
            const obj = JSON.parse(payload);
            const delta = obj?.choices?.[0]?.delta;
            if (delta?.content) {
              if (delta.content.includes('💭 ')) sawThinkingPrefix = true;
              if (delta.content.includes('\n\n---\n\n')) sawSeparator = true;
              if (delta.content.includes('This is the visible answer.')) sawFinalContent = true;
            }
          } catch {}
        }
      });
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  proxy.kill('SIGKILL');
  upstream.close();

  if (!sawThinkingPrefix) { console.error('❌ Missing thinking prefix in content'); process.exit(1); }
  if (!sawSeparator) { console.error('❌ Missing Markdown separator in content'); process.exit(1); }
  if (!sawFinalContent) { console.error('❌ Missing final content after separator'); process.exit(1); }
  if (!sawDone) { console.error('❌ Missing [DONE] event'); process.exit(1); }
  console.log('✅ Separator injection test passed');
}

run().catch(err => { console.error(err); process.exit(1); });
