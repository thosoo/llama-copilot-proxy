#!/usr/bin/env node

import http from 'http';

const requestBody = JSON.stringify({
  model: "Qwen3-4B",
  messages: [{ role: "user", content: "What is 2+2? Please think step by step." }],
  stream: true
});

const options = {
  hostname: '127.0.0.1',
  port: 11434,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody)
  }
};

console.log('🧪 Testing proxy with thinking prompt...');
console.log('Request:', requestBody);

const req = http.request(options, (res) => {
  console.log(`✅ Response status: ${res.statusCode}`);
  console.log('📋 Response headers:', res.headers);
  
  let responseData = '';
  let thinkingContentSeen = false;
  let messageContentSeen = false;
  
  res.on('data', (chunk) => {
    const data = chunk.toString();
    responseData += data;
    console.log('📦 Received chunk:', data);
    
    // Check for reasoning content (thinking)
    if (data.includes('"reasoning_content"')) {
      thinkingContentSeen = true;
      console.log('🧠 THINKING CONTENT DETECTED!');
    }
    
    // Check for message content (actual response)
    if (data.includes('"content"') && !data.includes('"reasoning_content"')) {
      messageContentSeen = true;
      console.log('💬 MESSAGE CONTENT DETECTED!');
    }
  });
  
  res.on('end', () => {
    console.log('\n🏁 Response complete!');
    console.log('📊 Summary:');
    console.log(`   - Thinking content seen: ${thinkingContentSeen}`);
    console.log(`   - Message content seen: ${messageContentSeen}`);
    console.log(`   - Total data length: ${responseData.length}`);
    
    if (thinkingContentSeen) {
      console.log('🎉 SUCCESS: Thinking mode is working!');
    } else {
      console.log('❌ ISSUE: No thinking content detected');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
});

req.on('timeout', () => {
  console.log('⏰ Request timed out');
  req.destroy();
});

// Set timeout to 30 seconds
req.setTimeout(30000);

req.write(requestBody);
req.end();
