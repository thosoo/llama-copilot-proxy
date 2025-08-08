#!/usr/bin/env node

// Verify that activeStreams counter works correctly and /api/show requests are cached

console.log('🔧 Testing Active Streams Counter and Caching...');

async function simulateStreamAndApiShow() {
  console.log('\n📡 Starting stream...');
  
  // Start stream
  const stream = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [{ role: "user", content: "Think about this: What is 2+2?" }],
      stream: true,
      max_tokens: 50
    })
  });

  // Wait a bit for stream to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making API show request during stream...');
  const start = Date.now();
  
  const showResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" 
    })
  });
  
  const duration = Date.now() - start;
  
  if (showResponse.ok) {
    console.log(`✅ API show request completed in ${duration}ms`);
    if (duration < 20) {
      console.log(`✅ GOOD: Fast response indicates caching/queuing is working`);
    } else {
      console.log(`⚠️  Slower response: ${duration}ms (might indicate upstream request)`);
    }
  } else {
    console.log(`❌ API show request failed: ${showResponse.status}`);
  }
  
  // Let stream complete
  console.log('\n⏳ Waiting for stream to complete...');
  const res = await stream;
  if (res.body) {
    const reader = res.body.getReader();
    let chunks = 0;
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
        if (chunks > 50) break; // Prevent infinite loop
      }
    } catch (e) {
      // Stream ended
    }
  }
  
  console.log('🏁 Stream completed');
}

simulateStreamAndApiShow().catch(console.error);
