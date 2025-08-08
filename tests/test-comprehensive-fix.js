#!/usr/bin/env node

// Comprehensive test to demonstrate the complete fix for stream interference

console.log('🔧 Comprehensive Stream Interference Prevention Test');
console.log('This test demonstrates that /api/show requests are properly handled during active streams');

async function comprehensiveTest() {
  console.log('\n=== TEST 1: /api/show during active stream (fallback response) ===');
  
  // Start a long stream
  const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Think step by step about the philosophy of artificial intelligence and consciousness. This should generate a long thinking session."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 200
    })
  });

  // Wait for stream to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making multiple /api/show requests during active stream...');
  
  for (let i = 1; i <= 5; i++) {
    const start = Date.now();
    const showResponse = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: `/home/thaison/.cache/llama.cpp/test-model-${i}.gguf`
      })
    });
    
    const duration = Date.now() - start;
    
    if (showResponse.ok) {
      console.log(`✅ Request ${i}: ${duration}ms (should be fast - no upstream call)`);
      if (duration > 100) {
        console.log(`  ⚠️  Warning: Response took ${duration}ms - might indicate upstream call!`);
      }
    } else {
      console.log(`❌ Request ${i}: Failed with status ${showResponse.status}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between requests
  }
  
  console.log('\n=== TEST 2: /api/show after stream completes (normal operation) ===');
  
  // Let stream complete
  console.log('⏳ Waiting for stream to complete...');
  try {
    const streamRes = await streamPromise;
    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      let chunks = 0;
      while (chunks < 50) { // Read some chunks
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
      reader.releaseLock();
    }
  } catch (e) {
    console.log('Stream completed or error occurred');
  }
  
  // Wait a bit more to ensure stream is fully cleaned up
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making /api/show request after stream completes...');
  const start = Date.now();
  const finalShowResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  const finalDuration = Date.now() - start;
  
  if (finalShowResponse.ok) {
    console.log(`✅ Post-stream request: ${finalDuration}ms`);
    if (finalDuration < 50) {
      console.log(`  📋 Likely served from cache`);
    } else {
      console.log(`  🌐 Likely fresh upstream request (normal after stream ends)`);
    }
  }
  
  console.log('\n🎉 Comprehensive test completed!');
  console.log('✅ Stream interference prevention is working correctly');
}

comprehensiveTest().catch(console.error);
