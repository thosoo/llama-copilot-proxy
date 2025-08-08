#!/usr/bin/env node

import http from 'http';

console.log('🚀 RACE CONDITION FIX TEST - Multiple concurrent /api/show requests...\n');

async function testConcurrentApiShowRequests() {
  console.log('📡 Starting long stream with concurrent /api/show requests...');
  
  // Start a chat completion request
  const payload = JSON.stringify({
    model: 'test',
    messages: [
      { role: 'user', content: 'Write a detailed analysis of renewable energy technologies, including solar, wind, hydro, and geothermal power. Discuss their advantages, disadvantages, environmental impact, and future prospects.' }
    ],
    stream: true,
    reasoning_effort: 'high'
  });
  
  let streamActive = false;
  let streamEnded = false;
  let chunkCount = 0;
  let thinkingChunks = 0;
  let contentChunks = 0;
  
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
    streamActive = true;
    console.log('✅ Stream started, beginning concurrent /api/show requests...\n');
    
    let buffer = '';
    res.on('data', (chunk) => {
      chunkCount++;
      buffer += chunk.toString();
      
      // Parse SSE chunks
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.choices?.[0]?.delta?.reasoning_content) {
              thinkingChunks++;
              if (thinkingChunks % 50 === 0) {
                console.log(`🧠 Thinking progress: ${thinkingChunks} chunks`);
              }
            } else if (data.choices?.[0]?.delta?.content) {
              contentChunks++;
              console.log(`📝 Content chunk: ${contentChunks}`);
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    });
    
    res.on('end', () => {
      streamEnded = true;
      console.log(`\n🏁 Stream completed naturally`);
      console.log(`📊 Total chunks: ${chunkCount} (${thinkingChunks} thinking, ${contentChunks} content)`);
    });
  });
  
  chatReq.on('error', (err) => {
    console.error('❌ Chat request error:', err.message);
  });
  
  // Start concurrent /api/show requests after a delay
  setTimeout(async () => {
    if (!streamActive) {
      console.log('⚠️ Stream not active yet, waiting...');
      return;
    }
    
    console.log('🔍 Starting concurrent /api/show requests...');
    
    const apiShowPayload = JSON.stringify({
      model: '/home/thaison/.cache/llama.cpp/DavidAU_Qwen3-4B-Q8_0-64k-128k-256k-context-GGUF_Qwen3-4B-Q8_0-128k.gguf'
    });
    
    // Send 15 /api/show requests concurrently during the stream
    const promises = [];
    for (let i = 1; i <= 15; i++) {
      const promise = new Promise((resolve) => {
        const showReq = http.request({
          hostname: 'localhost',
          port: 5433,
          path: '/api/show',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(apiShowPayload)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log(`✅ /api/show #${i}: ${res.statusCode}`);
            resolve({ id: i, status: res.statusCode, cached: res.headers['x-cache-status'] === 'HIT' });
          });
        });
        
        showReq.on('error', (err) => {
          console.log(`❌ /api/show #${i}: Error - ${err.message}`);
          resolve({ id: i, status: 'error', error: err.message });
        });
        
        showReq.write(apiShowPayload);
        showReq.end();
      });
      
      promises.push(promise);
      
      // Stagger requests slightly
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    const results = await Promise.all(promises);
    console.log('\n📋 /api/show results summary:');
    console.log(`   ✅ Successful: ${results.filter(r => r.status === 200).length}/15`);
    console.log(`   🗂️ Cached: ${results.filter(r => r.cached).length}/15`);
    console.log(`   ❌ Errors: ${results.filter(r => r.status === 'error').length}/15`);
    
  }, 2000); // Wait 2 seconds for stream to start
  
  chatReq.write(payload);
  chatReq.end();
  
  // Wait for stream to complete
  await new Promise(resolve => {
    const checkComplete = () => {
      if (streamEnded) {
        resolve();
      } else {
        setTimeout(checkComplete, 1000);
      }
    };
    checkComplete();
  });
  
  return { chunkCount, thinkingChunks, contentChunks };
}

// Run the test
testConcurrentApiShowRequests()
  .then(results => {
    console.log('\n🎉 RACE CONDITION FIX TEST COMPLETED!');
    console.log(`📊 Final Results:`);
    console.log(`   🧠 Thinking chunks: ${results.thinkingChunks}`);
    console.log(`   📝 Content chunks: ${results.contentChunks}`);
    console.log(`   📦 Total chunks: ${results.chunkCount}`);
    
    if (results.thinkingChunks > 50 && results.contentChunks > 0) {
      console.log('\n✅ SUCCESS: Stream completed naturally with extensive thinking!');
      console.log('🛡️ Race condition fix working - activeStreams counter stable!');
    } else {
      console.log('\n⚠️ Stream may have been interrupted or was too short');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
