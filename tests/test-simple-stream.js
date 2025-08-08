#!/usr/bin/env node

import http from 'http';

console.log('🚀 SIMPLE RACE CONDITION TEST - Testing activeStreams counter...\n');

// Test 1: Start a stream and immediately send /api/show
console.log('📡 Test 1: Starting stream...');

const payload = JSON.stringify({
  model: 'test',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
});

const chatReq = http.request({
  hostname: 'localhost',
  port: 5433,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  console.log('✅ Stream started, status:', res.statusCode);
  
  // Immediately send /api/show request
  setTimeout(() => {
    console.log('🔍 Sending /api/show during stream...');
    
    const showPayload = JSON.stringify({ model: 'test' });
    const showReq = http.request({
      hostname: 'localhost',
      port: 5433,
      path: '/api/show',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(showPayload)
      }
    }, (showRes) => {
      console.log(`✅ /api/show response: ${showRes.statusCode}`);
      console.log('🎯 Check proxy logs to see if activeStreams > 0 during stream!');
      process.exit(0);
    });
    
    showReq.on('error', (err) => {
      console.log('❌ /api/show error:', err.message);
      process.exit(1);
    });
    
    showReq.write(showPayload);
    showReq.end();
  }, 100); // Send /api/show 100ms after stream starts
  
  res.on('data', () => {}); // Consume data
  res.on('end', () => {
    console.log('🏁 Stream ended');
  });
});

chatReq.on('error', (err) => {
  console.log('❌ Chat request error:', err.message);
  process.exit(1);
});

chatReq.write(payload);
chatReq.end();

setTimeout(() => {
  console.log('⏰ Test timed out after 10 seconds');
  process.exit(1);
}, 10000);
