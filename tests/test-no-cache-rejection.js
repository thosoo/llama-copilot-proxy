#!/usr/bin/env node

// Test to verify that /api/show requests are properly rejected during active streams

console.log('🧪 Testing /api/show rejection during active streams...');

async function testApiShowRejection() {
  console.log('\n📡 Starting a stream to make activeStreams > 0...');
  
  // Start a streaming request (but don't consume it immediately)
  const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Think step by step: What is the meaning of life?"
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 100
    })
  });

  // Wait for stream to start
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('\n🔍 Making /api/show request during active stream (should be REJECTED)...');
  
  const start = Date.now();
  const showResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      model: "/home/thaison/.cache/llama.cpp/DavidAU_Qwen3-4B-Q8_0-64k-128k-256k-context-GGUF_Qwen3-4B-Q8_0-128k.gguf"
    })
  });
  
  const duration = Date.now() - start;
  
  if (showResponse.status === 503) {
    console.log(`✅ SUCCESS: Request properly rejected with 503 status in ${duration}ms`);
    
    try {
      const errorData = await showResponse.json();
      console.log(`📋 Error response:`, JSON.stringify(errorData, null, 2));
      
      if (errorData.error === 'service_temporarily_unavailable') {
        console.log(`✅ SUCCESS: Correct error type returned`);
      } else {
        console.log(`❌ FAIL: Wrong error type, expected 'service_temporarily_unavailable'`);
      }
      
      if (errorData.active_streams > 0) {
        console.log(`✅ SUCCESS: Active streams count reported: ${errorData.active_streams}`);
      } else {
        console.log(`❌ FAIL: Active streams not properly reported`);
      }
      
    } catch (e) {
      console.log(`❌ FAIL: Could not parse error response JSON`);
    }
    
    if (duration < 50) {
      console.log(`✅ EXCELLENT: Very fast rejection (${duration}ms) - immediate response without upstream call!`);
    } else {
      console.log(`⚠️  Slower rejection (${duration}ms) - still good but could be faster`);
    }
    
  } else if (showResponse.status === 200) {
    console.log(`❌ FAIL: Request was not rejected (status 200), should have been rejected with 503`);
    
  } else {
    console.log(`❌ FAIL: Unexpected status code ${showResponse.status}, expected 503`);
  }
  
  // Let the stream complete
  console.log('\n⏳ Allowing stream to complete...');
  try {
    const streamRes = await streamPromise;
    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      let chunks = 0;
      while (chunks < 10) { // Just read a few chunks
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
      reader.releaseLock();
    }
  } catch (e) {
    console.log('Stream ended or error occurred');
  }
  
  console.log('🏁 Test completed');
}

testApiShowRejection().catch(console.error);
