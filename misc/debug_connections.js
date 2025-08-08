#!/usr/bin/env node

/**
 * Simple test script to debug the connection issue
 */

import http from 'http';

const testPayload = JSON.stringify({
  model: 'qwen3',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false
});

console.log('Testing direct connection to llama-server...');

// Test direct connection to llama-server
const directReq = http.request('http://127.0.0.1:11433/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(testPayload)
  }
}, (res) => {
  console.log(`Direct connection - Status: ${res.statusCode}`);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Direct response received, length:', data.length);
    testProxyConnection();
  });
});

directReq.on('error', (err) => {
  console.error('Direct connection error:', err);
});

directReq.write(testPayload);
directReq.end();

function testProxyConnection() {
  console.log('\nTesting proxy connection...');
  
  const proxyReq = http.request('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(testPayload)
    }
  }, (res) => {
    console.log(`Proxy connection - Status: ${res.statusCode}`);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Proxy response received, length:', data.length);
      if (data) {
        console.log('Proxy response:', data.substring(0, 200));
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy connection error:', err);
  });

  proxyReq.write(testPayload);
  proxyReq.end();
}
