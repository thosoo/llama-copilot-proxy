#!/usr/bin/env node

// Test /api/show rejection with stream that might fail or error

console.log('🧪 Testing /api/show rejection with potentially failing streams...');

async function testStreamErrors() {
  console.log('\n📡 Starting a stream that might error...');
  
  // Try to start a stream with invalid model to test error handling
  const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "nonexistent-model",  // This should cause an error
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      temperature: 0.3,
      max_tokens: 20
    })
  });

  // Wait a moment to see if the stream starts
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making /api/show request (checking if activeStreams tracked correctly)...');
  
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
    console.log(`ℹ️  Request rejected with ${errorData.active_streams} active streams`);
  } else if (showResponse.status === 200) {
    console.log(`ℹ️  Request succeeded - either no active streams or stream failed quickly`);
  } else {
    console.log(`❌ Unexpected status: ${showResponse.status}`);
  }
  
  // Check what happened with the stream
  try {
    const streamRes = await streamPromise;
    console.log(`📊 Stream response status: ${streamRes.status}`);
    
    if (streamRes.status === 200 && streamRes.body) {
      console.log('⚠️  Stream appears to have started successfully despite invalid model');
      const reader = streamRes.body.getReader();
      let chunks = 0;
      try {
        while (chunks < 5) {
          const { done } = await reader.read();
          if (done) break;
          chunks++;
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      console.log(`ℹ️  Stream failed as expected with status ${streamRes.status}`);
    }
  } catch (e) {
    console.log(`ℹ️  Stream failed with error: ${e.message}`);
  }
  
  // Wait for cleanup
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test final state
  console.log('\n🔍 Final test - /api/show should work now...');
  
  const finalShowResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  if (finalShowResponse.status === 200) {
    console.log(`✅ SUCCESS: /api/show works normally after stream error/completion`);
  } else {
    console.log(`❌ FAIL: /api/show still not working (status: ${finalShowResponse.status})`);
  }
  
  console.log('🏁 Stream error test completed');
}

testStreamErrors().catch(console.error);
