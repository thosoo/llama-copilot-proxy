#!/usr/bin/env node

/**
 * Test script that mimics VS Code Copilot's exact request pattern
 */

import http from 'http';

const testPayload = JSON.stringify({
  model: 'qwen3',
  messages: [{ role: 'user', content: 'Say hello briefly' }],
  stream: true,
  temperature: 0.7
});

console.log('Testing Copilot-style streaming request...');

const req = http.request('http://127.0.0.1:11434/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(testPayload),
    'User-Agent': 'VSCode-Copilot/1.0',
    'Authorization': 'Bearer dummy-token',
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache'
  }
}, (res) => {
  console.log(`Response status: ${res.statusCode}`);
  console.log('Response headers:', res.headers);
  
  let data = '';
  let chunkCount = 0;
  
  res.on('data', (chunk) => {
    chunkCount++;
    data += chunk.toString();
    console.log(`Chunk ${chunkCount}: ${chunk.toString().substring(0, 100)}...`);
  });
  
  res.on('end', () => {
    console.log(`\nStream ended. Total chunks: ${chunkCount}`);
    console.log(`Data length: ${data.length}`);
    if (data.includes('data: [DONE]')) {
      console.log('✅ Stream completed properly with [DONE]');
    } else {
      console.log('❌ Stream did not end with [DONE]');
    }
  });
  
  res.on('error', (err) => {
    console.error('Response error:', err);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err);
});

// Test early connection close (simulating Copilot behavior)
setTimeout(() => {
  console.log('\n⚠️  Simulating early client disconnect...');
  req.destroy();
}, 2000); // Close after 2 seconds

req.write(testPayload);
req.end();

console.log('Request sent, waiting for response...');
