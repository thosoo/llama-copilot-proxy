import express from 'express';
// Helper for verbose logging (now always logs)
const verboseLog = (...args) => { if (process.env.VERBOSE) console.log(...args); };
const verboseError = (...args) => { if (process.env.VERBOSE) console.error(...args); };
import fetch from 'node-fetch';
import http from 'node:http';
import { pipeline, Transform } from 'node:stream';
import httpProxy from 'http-proxy';

const { createProxyServer } = httpProxy;
const LISTEN_PORT = process.env.LISTEN_PORT ? parseInt(process.env.LISTEN_PORT, 10) : 11434;
const LLAMA_SERVER_PORT = process.env.LLAMA_SERVER_PORT ? parseInt(process.env.LLAMA_SERVER_PORT, 10) : 8080;
const UPSTREAM = process.env.UPSTREAM || `http://127.0.0.1:${LLAMA_SERVER_PORT}`;

// Global state for streaming and /api/show interference prevention
let activeStreams = 0;
let apiShowCache = null;
let apiShowCacheTime = 0;
let queuedShowRequests = [];
const API_SHOW_CACHE_TTL = 300000; // 5 minutes cache TTL


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

// Helper functions for /api/show caching and interference prevention
async function processQueuedShowRequests() {
  if (queuedShowRequests.length === 0 || activeStreams > 0) return;
  
  console.log(`🔄 [API-SHOW-QUEUE] Processing ${queuedShowRequests.length} queued requests...`);
  
  const requests = queuedShowRequests.splice(0); // Clear the queue
  
  // Process one request to update cache
  if (requests.length > 0) {
    const { body } = requests[0]; // Use first request for cache update
    try {
      const upstreamRes = await fetch(`${UPSTREAM}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await upstreamRes.json();
      
      // Update cache
      apiShowCache = patch(data);
      apiShowCacheTime = Date.now();
      
      console.log(`✅ [API-SHOW-QUEUE] Cache updated from queued request`);
    } catch (error) {
      console.error(`❌ [API-SHOW-QUEUE] Failed to update cache:`, error.message);
    }
  }
}

async function handleApiShowRequest(req, res) {
  const timestamp = new Date().toISOString();
  const body = req.body;
  
  console.log(`🔍 [API-SHOW] ${timestamp} Request received (activeStreams: ${activeStreams})`);
  if (body) {
    console.log(`🔍 [API-SHOW] Body present:`, JSON.stringify(body, null, 2));
  }
  
  // If streams are active, reject the request
  if (activeStreams > 0) {
    console.log(`🚫 [API-SHOW] Rejecting request - streams are active (activeStreams: ${activeStreams})`);
    
    // Add to queue for later processing
    queuedShowRequests.push({ body, timestamp });
    console.log(`📋 [API-SHOW] Request queued for later processing (queue size: ${queuedShowRequests.length})`);
    
    // Reject with 503 Service Unavailable
    res.status(503).json({
      error: 'service_temporarily_unavailable',
      message: 'API show requests are not available while streams are active',
      active_streams: activeStreams,
      retry_after: 'Please retry after active streams complete'
    });
    return;
  }
  
  // Make upstream request (no active streams)
  try {
    console.log(`📡 [API-SHOW] Making upstream request to ${UPSTREAM}/api/show`);
    const upstreamRes = await fetch(`${UPSTREAM}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await upstreamRes.json();
    
    console.log(`🔍 [API-SHOW] Response received, processing...`);
    
    const processedData = patch(data);
    
    // Update cache
    apiShowCache = processedData;
    apiShowCacheTime = Date.now();
    
    console.log(`🔍 [API-SHOW] Response sent to client (cache updated)`);
    res.json(processedData);
    
  } catch (err) {
    console.error(`🔍 [API-SHOW] Error occurred during request:`, err);
    res.status(502).json({ error: 'proxy_error' });
  }
}

// JSON endpoints that need capability injection (excluding /api/show which has special handling)
const jsonRoutes = [
  ['GET', '/api/models'],
  ['GET', '/v1/models'],
  ['GET', '/api/tags']
];

// Special handler for /api/show with interference prevention
app.post('/api/show', handleApiShowRequest);

jsonRoutes.forEach(([method, path]) => {
  app[method.toLowerCase()](path, async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${method}] ${timestamp} Proxying ${path} -> ${UPSTREAM}${path}`);
    
    // Special debugging for /api/show to track interference
    if (path === '/api/show') {
      console.log(`🔍 [API-SHOW] ${timestamp} Request received during potential streaming`);
      if (req.body) {
        console.log(`🔍 [API-SHOW] Body present:`, JSON.stringify(req.body, null, 2));
      }
    }
    
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
      
      // Special debugging for /api/show
      if (path === '/api/show') {
        console.log(`🔍 [API-SHOW] Response received, processing...`);
      }
      
      // Pretty-print upstream response for logs
      console.log(`[${method}] Upstream response for ${path}:`, JSON.stringify(data, null, 2));
      res.json(path === '/api/tags' ? data : patch(data));
      
      if (path === '/api/show') {
        console.log(`🔍 [API-SHOW] Response sent to client`);
      }
    } catch (err) {
      console.error(`[${method}] Proxy error for ${path}:`, err);
      if (path === '/api/show') {
        console.error(`🔍 [API-SHOW] Error occurred during request`);
      }
      res.status(502).json({ error: 'proxy_error' });
    }
  });
});

// Streaming chat completions with tool‑schema fix and deepseek thinking mode support

// Environment variables to control thinking mode behavior
// THINKING_MODE options:
//   'vscode'  - Standard reasoning_content for VSCode Copilot (default)
//   'events'  - Custom 'event: thinking' SSE events only
//   'both'    - Both content and event streams
//   'off'     - Disable thinking events
//   'show_reasoning' - Route thinking to normal content stream (VSCode will display it!)
const THINKING_MODE = process.env.THINKING_MODE || 'vscode';
const THINKING_DEBUG = process.env.THINKING_DEBUG === 'true';

app.post(/^(\/(v1\/)?){0,1}chat\/completions$/, (req, res) => {
  console.log(`[POST] Proxying chat completion: ${req.originalUrl}`);
  if (process.env.VERBOSE) console.log(`[POST] Headers:`, req.headers);
  let body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
  
  // Log thinking mode configuration
  if (THINKING_DEBUG) {
    console.log(`🧠 [THINKING] Mode: ${THINKING_MODE}`);
    console.log('   Available modes:');
    console.log('   - \'vscode\': Standard reasoning_content for VSCode Copilot (default)');
    console.log('   - \'events\': Custom \'event: thinking\' SSE events only');
    console.log('   - \'both\': Both standard and custom events');
    console.log('   - \'show_reasoning\': Route thinking to normal content stream (VSCode will display it!)');
    console.log('   - \'off\': Disable thinking content entirely');
    console.log('');
    console.log('   Configure with: THINKING_MODE=show_reasoning THINKING_DEBUG=true node proxy-server.js');
  }
  
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
    console.log(`🔧 [TOOLS] Tool request detected with ${body.tools.length} tools`);
    if (process.env.VERBOSE) console.log(`[POST] Full tool-calling request body:`, JSON.stringify(body, null, 2));
    if (THINKING_DEBUG) {
      console.log(`🔧 [TOOLS] Original tools:`, JSON.stringify(body.tools, null, 2));
    }
    body.tools = patchToolsArray(body.tools);
    const minifiedTools = JSON.stringify(body.tools);
    if (process.env.VERBOSE) console.log(`[POST] Minified tools (patched):`, minifiedTools);
    if (THINKING_DEBUG) {
      console.log(`🔧 [TOOLS] Patched tools:`, JSON.stringify(body.tools, null, 2));
    }
  }
  const payload = JSON.stringify(body);
  if (process.env.VERBOSE) console.log(`[POST] Upstream payload (minified):`, payload);
  
  // Enhanced payload logging for debugging
  if (THINKING_DEBUG) {
    console.log(`📤 [PAYLOAD] Full request payload:`, JSON.stringify(body, null, 2));
  }
  
  let heartbeatInterval; // Declare heartbeat interval in function scope
  let streamCleaned = false; // Flag to prevent multiple cleanup calls
  
  // Track active stream to prevent /api/show interference
  activeStreams++;
  console.log(`🔒 [STREAM-TRACKING] Stream started (active: ${activeStreams})`);
  
  // Cleanup function that can only be called once
  const cleanupStream = (reason) => {
    if (streamCleaned) return; // Already cleaned up
    streamCleaned = true;
    
    activeStreams--;
    console.log(`🔓 [STREAM-TRACKING] Stream ended: ${reason} (active: ${activeStreams})`);
    
    // Clean up heartbeat interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    
    // Process any queued /api/show requests
    if (activeStreams === 0) {
      setTimeout(() => processQueuedShowRequests(), 100);
    }
  };
  
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
      // Only set headers if not already sent (for large prompts, headers are sent early)
      if (!res.headersSent) {
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
        
        // Send initial heartbeats and set up heartbeat interval to keep the connection alive
        res.write(': heartbeat\n\n');
        res.write(': processing-prompt\n\n');
        if (!heartbeatInterval) {
          console.log(`📡 [INFO] Starting heartbeat interval for streaming response`);
          heartbeatInterval = setInterval(() => {
            if (!res.destroyed && !res.writableEnded) {
              res.write(': heartbeat\n\n');
            } else {
              clearInterval(heartbeatInterval);
            }
          }, 10000); // Heartbeat every 10 seconds
        }
      } else {
        // Headers already sent, just log
        console.log(`📡 [INFO] Using pre-sent headers for large prompt response`);
      }
      
      // Initial heartbeats are already being sent from pre-response setup
      // Transform stream to parse and emit reasoning_content based on THINKING_MODE
      // This enables different thinking mode formats for different clients
      let buffer = '';
      let thinkingStarted = false; // Track if we've started thinking
      let requestId = Date.now() + Math.random(); // Unique ID for this request
      
      if (THINKING_DEBUG) {
        console.log(`🔍 [REQUEST-${requestId}] Starting new chat completion stream`);
      }
      
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
                
                // Enhanced debug logging to see what we're actually receiving
                if (THINKING_DEBUG && data.choices && data.choices[0] && data.choices[0].delta) {
                  const delta = data.choices[0].delta;
                  const keys = Object.keys(delta);
                  if (keys.length > 0) {
                    console.log(`🔍 [DEBUG] Delta keys: ${keys.join(', ')}`);
                    if (delta.content) {
                      console.log(`💬 [DEBUG] Content: ${delta.content.slice(0, 30)}...`);
                    }
                  }
                }
                
                if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.reasoning_content) {
                  const reasoningContent = data.choices[0].delta.reasoning_content;
                  
                  // Always show thinking content prominently (since VSCode doesn't display it)
                  console.log('💭', reasoningContent);
                  
                  if (THINKING_DEBUG) {
                    console.log(`🧠 [REQUEST-${requestId}] Received reasoning content: ${reasoningContent.slice(0, 50)}...`);
                  }
                  
                  // Handle different thinking modes
                  switch (THINKING_MODE) {
                    case 'events':
                      // Only emit custom thinking events
                      output += `event: thinking\ndata: ${JSON.stringify(reasoningContent)}\n\n`;
                      break;
                      
                    case 'both':
                      // Emit both custom events and preserve original
                      output += `event: thinking\ndata: ${JSON.stringify(reasoningContent)}\n\n`;
                      output += line + '\n'; // Pass through original
                      break;
                      
                    case 'content': {
                      // Route thinking content to normal content stream (VSCode will display it!)
                      let modifiedData = { ...data };
                      if (modifiedData.choices && modifiedData.choices[0] && modifiedData.choices[0].delta) {
                        let content = reasoningContent;
                        
                        // Add thinking prefix only at the very start
                        if (!thinkingStarted) {
                          content = `💭 ${content}`;
                          thinkingStarted = true;
                          if (THINKING_DEBUG) {
                            console.log(`🎯 [REQUEST-${requestId}] Started thinking mode with prefix`);
                          }
                        }
                        
                        modifiedData.choices[0].delta.content = content;
                        // Remove reasoning_content field
                        delete modifiedData.choices[0].delta.reasoning_content;
                      }
                      output += `data: ${JSON.stringify(modifiedData)}\n`;
                      break;
                    }
                      
                    case 'show_reasoning': {
                      // Route thinking content to normal content stream (VSCode will display it!)
                      let modifiedData = { ...data };
                      if (modifiedData.choices && modifiedData.choices[0] && modifiedData.choices[0].delta) {
                        let content = reasoningContent;
                        // Add thinking prefix only at the very start
                        if (!thinkingStarted) {
                          content = `💭 ${content}`;
                          thinkingStarted = true;
                          if (THINKING_DEBUG) {
                            console.log(`🎯 [REQUEST-${requestId}] Started show_reasoning mode with prefix`);
                          }
                        }
                        modifiedData.choices[0].delta.content = content;
                        // Remove reasoning_content field
                        delete modifiedData.choices[0].delta.reasoning_content;
                      }
                      output += `data: ${JSON.stringify(modifiedData)}\n`;
                      break;
                    }
                  }
                }
              } catch (e) {
                // Not valid JSON, pass through unchanged
                output += line + '\n';
              }
            } else {
              // Pass through all non-data lines (events, comments, etc.)
              output += line + '\n';
            }
          }
          callback(null, output);
        },
        flush(callback) {
          if (buffer.length > 0) {
            this.push(buffer);
            buffer = '';
          }
          // Reset thinking state on flush
          thinkingStarted = false;
          callback();
        }
      });
      pipeline(upRes, thinkTransform, res, (err) => {
        cleanupStream('pipeline completion');
        
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
      // For non-streaming responses, handle reasoning_content based on thinking mode
      let raw = '';
      upRes.on('data', chunk => { raw += chunk.toString(); });
      upRes.on('end', () => {
        // Try to parse JSON and handle reasoning_content based on mode
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        
        if (typeof data === 'object' && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.reasoning_content) {
          const reasoningContent = data.choices[0].message.reasoning_content;
          
          if (THINKING_DEBUG) {
            console.log(`🧠 [THINKING] Non-streaming reasoning content length: ${reasoningContent.length}`);
          }
          
          // Handle different thinking modes for non-streaming
          switch (THINKING_MODE) {
                    case 'show_reasoning': {
                      // Route thinking content to normal content stream (VSCode will display it!)
                      let modifiedData = { ...data };
                      if (modifiedData.choices && modifiedData.choices[0] && modifiedData.choices[0].delta) {
                        let content = reasoningContent;
                        // Add thinking prefix only at the very start
                        if (!thinkingStarted) {
                          content = `💭 ${content}`;
                          thinkingStarted = true;
                          if (THINKING_DEBUG) {
                            console.log(`🎯 [REQUEST-${requestId}] Started show_reasoning mode with prefix`);
                          }
                        }
                        modifiedData.choices[0].delta.content = content;
                        // Remove reasoning_content field
                        delete modifiedData.choices[0].delta.reasoning_content;
                      }
                      output += `data: ${JSON.stringify(modifiedData)}\n`;
                      break;
                    }
          }
        }
        const responseHeaders = { ...upRes.headers };
        if (responseHeaders['content-encoding']) {
          delete responseHeaders['content-encoding'];
        }
        res.writeHead(upRes.statusCode || 500, responseHeaders);
        res.end(JSON.stringify(data));
        
        cleanupStream('non-streaming response');
      });
    }
  });
  upstreamReq.on('error', (err) => {
    console.error(`[POST] Upstream request error for ${req.originalUrl}:`, err);
    
    cleanupStream('upstream error');
    
    if (!res.headersSent) {
      res.status(502).json({ error: 'upstream_connection_error', message: err.message });
    }
  });
  // Note: Removed aggressive req.on('close') handler that was cleaning up streams too early
  // Stream cleanup should only happen when the actual response pipeline completes
  // The original handler was causing interference issues by decrementing activeStreams 
  // before the upstream response was actually finished processing
  req.on('error', (err) => {
    cleanupStream('request error');
    
    const isClientDisconnect = ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err.code);
    if (isClientDisconnect) {
      if (process.env.VERBOSE) console.log(`[POST] Client connection error for ${req.originalUrl}: ${err.code}`);
    } else {
      if (process.env.VERBOSE) console.error(`[POST] Client request error for ${req.originalUrl}:`, err);
    }
  });
  upstreamReq.write(payload);
  upstreamReq.end();
  
  // Start immediate heartbeats for large prompts to prevent client timeout
  // This is crucial for large prompts where upstream processing can take a long time
  if (estimatedTokens > 1000) {
    console.log(`📡 [INFO] Starting immediate heartbeats for large prompt (~${estimatedTokens} tokens)`);
    
    // Send initial response headers and heartbeats immediately
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    
    // Send initial heartbeats
    res.write(': heartbeat-initial\n\n');
    res.write(': processing-large-prompt\n\n');
    
    // Start periodic heartbeats
    heartbeatInterval = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) {
        res.write(': heartbeat-waiting\n\n');
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 1000); // More frequent heartbeats during waiting
  }
  
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
  const startupTime = new Date().toISOString();
  console.log(`\n===========================================`);
  console.log(`🚀 Copilot BYOK → llama.cpp Integration Proxy 🚀`);
  console.log(`Version: ${VERSION} (with DeepSeek Thinking Mode support)`);
  console.log(`A seamless bridge for VS Code Copilot and local llama.cpp (llama-server) with tool support.`);
  console.log(`🕐 Started at: ${startupTime} (PID: ${process.pid})`);
  console.log(`===========================================\n`);
  console.log(`Proxy listening on http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`Upstream target: ${UPSTREAM}`);
  console.log(`Configure VS Code to use: http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`Instead of: http://127.0.0.1:11433\n`);
  
  // Display thinking mode configuration
  console.log(`🧠 Thinking Mode Configuration:`);
  console.log(`   Mode: ${THINKING_MODE}`);
  console.log(`   Debug: ${THINKING_DEBUG ? 'enabled' : 'disabled'}`);
  console.log(`\n   Available modes:`);
  console.log(`   - 'default': Standard reasoning_content for Copilot protocol (reasoning hidden in VS Code GUI)`);
  console.log(`   - 'events': Custom 'event: thinking' SSE events only`);
  console.log(`   - 'both': Both standard and custom events`);
  console.log(`   - 'show_reasoning': Route thinking to normal content stream (VSCode will display it!)`);
  console.log(`   - 'off': Disable thinking content entirely`);
  console.log(`\n   Configure with: THINKING_MODE=show_reasoning THINKING_DEBUG=true node proxy-server.js`);
  console.log(`\n   Configure with: THINKING_MODE=show_reasoning THINKING_DEBUG=true node proxy-server.js`);
});

