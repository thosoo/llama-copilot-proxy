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
      max_tokens: 50
    })
  });

  // Wait for stream to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making /api/show request during active stream (should be REJECTED)...');
  
  const start = Date.now();
  const showResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/DavidAU_Qwen3-4B-Q8_0-64k-128k-256k-context-GGUF_Qwen3-4B-Q8_0-128k.gguf"
    })
  });
  
  const duration = Date.now() - start;
  
  console.log(`📊 Response status: ${showResponse.status}`);
  console.log(`📊 Response time: ${duration}ms`);
  
  if (showResponse.status === 503) {
    console.log(`✅ SUCCESS: Request properly rejected with 503 status`);
    
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
      while (chunks < 5) { // Just read a few chunks
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
      reader.releaseLock();
    }
  } catch (e) {
    console.log('Stream ended or error occurred:', e.message);
  }
  
  // Wait a bit for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Testing /api/show after stream ends (should work normally)...');
  
  const postStreamResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  if (postStreamResponse.status === 200) {
    console.log(`✅ SUCCESS: /api/show works normally after stream ends`);
  } else {
    console.log(`❌ FAIL: /api/show still not working after stream ends (status: ${postStreamResponse.status})`);
  }
  
  console.log('🏁 Test completed');
}

testApiShowRejection().catch(console.error);
