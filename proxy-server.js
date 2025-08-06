import express from 'express';
// Helper for verbose logging (now always logs)
const verboseLog = (...args) => { if (process.env.VERBOSE) console.log(...args); };
const verboseError = (...args) => { if (process.env.VERBOSE) console.error(...args); };
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Set long timeouts for all requests (10 minutes)
app.use((req, res, next) => {
  req.setTimeout(600000); // 10 minutes
  res.setTimeout(600000); // 10 minutes
  next();
});
// Path rewrite middleware for Copilot BYOK → llama-server
app.use((req, res, next) => {
  // Only rewrite POST requests for chat/completions and completions
  if (req.method === 'POST') {
    if (req.originalUrl === '/api/chat') {
      req.url = '/v1/chat/completions';
      req.originalUrl = '/v1/chat/completions';
      verboseLog('🔄 Rewrote /api/chat → /v1/chat/completions');
    } else if (req.originalUrl === '/api/generate') {
      req.url = '/v1/completions';
      req.originalUrl = '/v1/completions';
      verboseLog('🔄 Rewrote /api/generate → /v1/completions');
    }
  }
  next();
});

// Add middleware to log ALL requests
const jsonEndpointSet = new Set([
  '/api/models',
  '/api/show',
  '/v1/models',
  '/api/tags'
]);
app.use((req, res, next) => {
  // Always log routing
  if (req.method === 'POST' && (req.originalUrl === '/v1/chat/completions' || req.originalUrl === '/v1/completions' || req.originalUrl.match(/^(\/)?(v1\/)?chat\/completions$/))) {
    console.log(`➡️ [${req.method}] Routed to: ${req.originalUrl}`);
    if (process.env.VERBOSE && req.body && Object.keys(req.body).length > 0) {
      console.log(`📦 Request body:`, JSON.stringify(req.body, null, 2));
    }
  } else if (req.method === 'POST' && !jsonEndpointSet.has(req.originalUrl)) {
    // Fallback POSTs (not JSON endpoints)
    console.log(`🔄 [${req.method}] Routing: ${req.originalUrl} - User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
    if (process.env.VERBOSE && req.body && Object.keys(req.body).length > 0) {
      console.log(`📦 Request body:`, JSON.stringify(req.body, null, 2));
    }
  } else {
    // GETs and JSON endpoints: only log routing, not body
    console.log(`🔄 [${req.method}] Routing: ${req.originalUrl} - User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
  }
  next();
});

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

// Ensure every tool has a parameters key in its function object
function patchToolsArray(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map(tool => {
    if (tool.type === 'function' && tool.function) {
      let params = tool.function.parameters;
      // Ensure parameters is a valid JSON object (not a string)
      if (typeof params === 'string') {
        try {
          params = JSON.parse(params);
        } catch (e) {
          params = {};
        }
      }
      return {
        ...tool,
        function: {
          ...tool.function,
          parameters: params || {}
        }
      };
    }
    return tool;
  });
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
    console.log(`[${method}] Proxying ${path} -> ${UPSTREAM}${path}`);
    let body = req.body;
    if (method === 'POST') {
      // Check if this request contains tools (which would be wrong for /api/show)
      if (path === '/api/show' && body && Array.isArray(body.tools)) {
        console.error(`🚨 ERROR: /api/show received request with tools! This should not happen!`);
        console.error(`🚨 Tools found:`, JSON.stringify(body.tools, null, 2));
        console.error(`🚨 Full body:`, JSON.stringify(body, null, 2));
      }
      // Do NOT log request body for JSON endpoints
      // Note: Tools are passed through unchanged - llama.cpp expects OpenAI format
    }
    try {
      // Always send minified JSON upstream
      const upstreamRes = await fetch(`${UPSTREAM}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(body) : undefined
      });
      const data = await upstreamRes.json();
      // Pretty-print upstream response for logs
      console.log(`[${method}] Upstream response for ${path}:`, JSON.stringify(data, null, 2));
      res.json(path === '/api/tags' ? data : patch(data));
    } catch (err) {
      console.error(`[${method}] Proxy error for ${path}:`, err);
      res.status(502).json({ error: 'proxy_error' });
    }
  });
});

// Streaming chat completions with tool‑schema fix and deepseek thinking mode support

import { Transform } from 'stream';
app.post(/^(\/(v1\/)?){0,1}chat\/completions$/, (req, res) => {
  console.log(`[POST] Proxying chat completion: ${req.originalUrl}`);
  if (process.env.VERBOSE) console.log(`[POST] Headers:`, req.headers);
  let body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  
  // Estimate prompt length to warn about potential timeouts
  let estimatedTokens = 0;
  if (body.messages && Array.isArray(body.messages)) {
    estimatedTokens = body.messages.reduce((acc, msg) => {
      if (msg.content && typeof msg.content === 'string') {
        return acc + Math.ceil(msg.content.length / 3); // Rough token estimation
      }
      return acc;
    }, 0);
    
    if (estimatedTokens > 2000) {
      console.log(`⚠️  [WARNING] Large prompt detected (~${estimatedTokens} tokens). This may cause timeout issues.`);
      console.log(`⚠️  [TIP] Consider reducing context size or increasing timeout settings.`);
    }
  }
  
  if (Array.isArray(body.tools)) {
    if (process.env.VERBOSE) console.log(`[POST] Full tool-calling request body:`, JSON.stringify(body, null, 2));
    body.tools = patchToolsArray(body.tools);
    const minifiedTools = JSON.stringify(body.tools);
    if (process.env.VERBOSE) console.log(`[POST] Minified tools (patched):`, minifiedTools);
  }
  const payload = JSON.stringify(body);
  if (process.env.VERBOSE) console.log(`[POST] Upstream payload (minified):`, payload);
  
  let heartbeatInterval; // Declare heartbeat interval in function scope
  
  const upstreamReq = http.request(`${UPSTREAM}${req.originalUrl}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Accept': 'text/event-stream, application/json'
    }
  }, upRes => {
    verboseLog(`[POST] Upstream response status: ${upRes.statusCode}`);
    verboseLog(`[POST] Upstream response headers:`, upRes.headers);
    const isStreaming = upRes.headers['content-type']?.includes('text/event-stream');
    
    // Log when we receive the first response from upstream
    console.log(`✅ [INFO] Upstream responded (~${estimatedTokens} tokens prompt processed)`);
    
    if (isStreaming) {
      res.writeHead(upRes.statusCode || 200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      
      // Send multiple heartbeats to prevent timeout during long prompt processing
      res.write(': heartbeat\n\n');
      res.write(': processing-prompt\n\n');
      
      // Send periodic heartbeats for any substantial prompt (even shorter ones can cause delays)
      let heartbeatInterval;
      if (estimatedTokens > 1000) {
        console.log(`📡 [INFO] Setting up extended heartbeat for prompt (~${estimatedTokens} tokens)`);
        heartbeatInterval = setInterval(() => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(': heartbeat-extended\n\n');
          } else {
            clearInterval(heartbeatInterval);
          }
        }, 1500); // Heartbeat every 1.5 seconds for any substantial prompt
      }
      // Transform stream to parse and emit reasoning_content as special SSE events
      // This enables deepseek/qwen3 thinking mode for Copilot by exposing model reasoning
      let buffer = '';
      const thinkTransform = new Transform({
        transform(chunk, encoding, callback) {
          buffer += chunk.toString();
          let output = '';
          
          // Process complete SSE data lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.reasoning_content) {
                  // Emit reasoning content as special thinking event
                  output += `event: thinking\ndata: ${JSON.stringify(data.choices[0].delta.reasoning_content)}\n\n`;
                }
              } catch (e) {
                // Not valid JSON, pass through unchanged
              }
            }
            // Pass through all original lines
            output += line + '\n';
          }
          
          callback(null, output);
        },
        flush(callback) {
          if (buffer.length > 0) {
            this.push(buffer);
            buffer = '';
          }
          callback();
        }
      });
      pipeline(upRes, thinkTransform, res, (err) => {
        // Clean up heartbeat interval
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        
        if (err) {
          const isClientDisconnect = ['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ENOTFOUND', 'ETIMEDOUT'].includes(err.code);
          if (isClientDisconnect) {
            verboseLog(`[POST] Client disconnected from ${req.originalUrl}: ${err.code}`);
          } else {
            console.error(`[POST] Pipeline error for ${req.originalUrl}:`, err);
          }
        } else {
          verboseLog(`[POST] Response piped to client for ${req.originalUrl}`);
        }
      });
    } else {
      // For non-streaming responses, parse and emit reasoning_content in JSON
      let raw = '';
      upRes.on('data', chunk => { raw += chunk.toString(); });
      upRes.on('end', () => {
        // Try to parse JSON and extract reasoning_content
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        let thinking = null;
        if (typeof data === 'object' && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.reasoning_content) {
          thinking = data.choices[0].message.reasoning_content;
          data.choices[0].message.thinking = thinking;
        }
        const responseHeaders = { ...upRes.headers };
        if (responseHeaders['content-encoding']) {
          delete responseHeaders['content-encoding'];
        }
        res.writeHead(upRes.statusCode || 500, responseHeaders);
        res.end(JSON.stringify(data));
      });
    }
  });
  upstreamReq.on('error', (err) => {
    console.error(`[POST] Upstream request error for ${req.originalUrl}:`, err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'upstream_connection_error', message: err.message });
    }
  });
  req.on('close', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    if (process.env.VERBOSE) console.log(`[POST] Client closed connection for ${req.originalUrl}`);
  });
  req.on('error', (err) => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    const isClientDisconnect = ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err.code);
    if (isClientDisconnect) {
      if (process.env.VERBOSE) console.log(`[POST] Client connection error for ${req.originalUrl}: ${err.code}`);
    } else {
      if (process.env.VERBOSE) console.error(`[POST] Client request error for ${req.originalUrl}:`, err);
    }
  });
  upstreamReq.write(payload);
  upstreamReq.end();
  
  // Log that we've sent the request to upstream
  console.log(`📤 [INFO] Sent request to upstream (~${estimatedTokens} tokens). Waiting for processing...`);
});
// Debug endpoint to inspect minified JSON payload
app.post('/debug/json', (req, res) => {
  let body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  const minified = JSON.stringify(body);
  res.json({ minified });
});

// Fallback proxy with JSON minification for tools
app.use((req, res) => {
  console.log(`🚨 [${req.method}] FALLBACK proxy for ${req.url} -> ${UPSTREAM}${req.url}`);
  if (process.env.VERBOSE) console.log(`🚨 Headers:`, req.headers);
  
  // Check if this is a POST request with tools that needs minification
  if (req.method === 'POST' && req.body && Array.isArray(req.body.tools)) {
    if (process.env.VERBOSE) console.log(`🚨 FALLBACK detected tools - MINIFYING & PATCHING!`);
    req.body.tools = patchToolsArray(req.body.tools);
    const minifiedTools = JSON.stringify(req.body.tools);
    if (process.env.VERBOSE) console.log(`🚨 Minified tools (patched):`, minifiedTools);
    // Minify the JSON for upstream
    const minifiedPayload = JSON.stringify(req.body);
    if (process.env.VERBOSE) console.log(`🚨 Minified fallback payload:`, minifiedPayload);
    // Create a custom request to upstream with minified JSON
    const upstreamReq = http.request(`${UPSTREAM}${req.url}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Content-Length': Buffer.byteLength(minifiedPayload),
        'Accept': 'text/event-stream, application/json'
      }
    }, upRes => {
      if (process.env.VERBOSE) console.log(`🚨 FALLBACK upstream response status: ${upRes.statusCode}`);
      if (process.env.VERBOSE) console.log(`🚨 FALLBACK upstream response headers:`, upRes.headers);
      
      // Set proper headers for streaming
      const responseHeaders = { ...upRes.headers };
      if (responseHeaders['content-encoding']) {
        delete responseHeaders['content-encoding']; // Remove compression to avoid issues
      }
      
      res.writeHead(upRes.statusCode || 500, responseHeaders);
      pipeline(upRes, res, (err) => {
        if (err && process.env.VERBOSE) {
          console.error(`🚨 FALLBACK pipeline error:`, err);
        }
      });
    });
    
    upstreamReq.on('error', (err) => {
      if (process.env.VERBOSE) console.error(`🚨 FALLBACK upstream request error:`, err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'upstream_connection_error', message: err.message });
      }
    });
    
    upstreamReq.write(minifiedPayload);
    upstreamReq.end();
  } else {
    // Regular fallback for non-tool requests
    if (process.env.VERBOSE && req.body && Object.keys(req.body).length > 0) {
      console.log(`🚨 FALLBACK body (regular):`, JSON.stringify(req.body, null, 2));
    }
    proxy.web(req, res, { target: `${UPSTREAM}${req.url}` }); // Regular proxying for non-tool requests
  }
});

const VERSION = '1.0.0';
app.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`\n===========================================`);
  console.log(`🚀 Copilot BYOK → llama.cpp Integration Proxy 🚀`);
  console.log(`Version: ${VERSION} (with DeepSeek Thinking Mode support)`);
  console.log(`A seamless bridge for VS Code Copilot and local llama.cpp (llama-server) with tool support.`);
  console.log(`===========================================\n`);
  console.log(`Proxy listening on http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`Upstream target: ${UPSTREAM}`);
  console.log(`Configure VS Code to use: http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`Instead of: http://127.0.0.1:11433`);
});

