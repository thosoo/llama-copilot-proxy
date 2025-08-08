#!/usr/bin/env node

// Test multiple concurrent streams and /api/show rejection

console.log('🧪 Testing /api/show rejection with multiple concurrent streams...');

async function testMultipleStreams() {
  console.log('\n📡 Starting multiple concurrent streams...');
  
  // Start 3 concurrent streams
  const stream1Promise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [{ role: "user", content: "Count to 5." }],
      stream: true,
      temperature: 0.3,
      max_tokens: 20
    })
  });
  
  const stream2Promise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [{ role: "user", content: "Say hello." }],
      stream: true,
      temperature: 0.3,
      max_tokens: 10
    })
  });

  // Wait for streams to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making /api/show request during multiple active streams...');
  
  const showResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  console.log(`📊 Response status: ${showResponse.status}`);
  
  if (showResponse.status === 503) {
    const errorData = await showResponse.json();
    console.log(`✅ SUCCESS: Correctly rejected with ${errorData.active_streams} active streams`);
    
    if (errorData.active_streams >= 2) {
      console.log(`✅ SUCCESS: Multiple streams properly tracked`);
    } else {
      console.log(`⚠️  Only ${errorData.active_streams} streams tracked, expected >= 2`);
    }
  } else {
    console.log(`❌ FAIL: Expected 503, got ${showResponse.status}`);
  }
  
  // Test multiple /api/show requests
  console.log('\n🔍 Making multiple /api/show requests during active streams...');
  
  const multipleShowPromises = [
    fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    }),
    fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    }),
    fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    })
  ];
  
  const multipleShowResults = await Promise.all(multipleShowPromises);
  
  let allRejected = true;
  for (let i = 0; i < multipleShowResults.length; i++) {
    if (multipleShowResults[i].status !== 503) {
      allRejected = false;
      console.log(`❌ FAIL: Request ${i+1} was not rejected (status: ${multipleShowResults[i].status})`);
    }
  }
  
  if (allRejected) {
    console.log(`✅ SUCCESS: All ${multipleShowResults.length} /api/show requests were rejected`);
  }
  
  // Clean up streams
  console.log('\n⏳ Cleaning up streams...');
  
  try {
    const [stream1Res, stream2Res] = await Promise.all([stream1Promise, stream2Promise]);
    
    // Consume streams to completion
    const cleanupPromises = [stream1Res, stream2Res].map(async (streamRes, index) => {
      if (streamRes.body) {
        const reader = streamRes.body.getReader();
        let chunks = 0;
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
            chunks++;
          }
          console.log(`✅ Stream ${index + 1} completed (${chunks} chunks)`);
        } finally {
          reader.releaseLock();
        }
      }
    });
    
    await Promise.all(cleanupPromises);
    
  } catch (e) {
    console.log('Stream cleanup error:', e.message);
  }
  
  // Wait for cleanup
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test that /api/show works after all streams end
  console.log('\n🔍 Testing /api/show after all streams end...');
  
  const finalShowResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  if (finalShowResponse.status === 200) {
    console.log(`✅ SUCCESS: /api/show works normally after all streams end`);
  } else {
    console.log(`❌ FAIL: /api/show still not working (status: ${finalShowResponse.status})`);
  }
  
  console.log('🏁 Multiple streams test completed');
}

testMultipleStreams().catch(console.error);
