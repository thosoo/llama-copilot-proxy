#!/usr/bin/env node

// Better test to verify /api/show rejection during active streams with proper stream handling

console.log('🧪 Testing /api/show rejection with proper stream handling...');

async function testApiShowRejectionProper() {
  console.log('\n📡 Starting a stream to make activeStreams > 0...');
  
  // Start a streaming request
  const streamRes = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Say hello briefly."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 20
    })
  });

  console.log('✅ Stream response status:', streamRes.status);

  if (!streamRes.ok) {
    console.log('❌ Stream failed to start:', streamRes.status);
    return;
  }

  // Wait a moment for the stream to register as active
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('\n🔍 Making /api/show request during active stream (should be REJECTED)...');
  
  const showResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  console.log(`📊 Response status: ${showResponse.status}`);
  
  if (showResponse.status === 503) {
    console.log(`✅ SUCCESS: Request properly rejected with 503 status`);
    
    const errorData = await showResponse.json();
    console.log(`📋 Active streams reported: ${errorData.active_streams}`);
    
  } else {
    console.log(`❌ FAIL: Expected 503, got ${showResponse.status}`);
  }
  
  // Properly consume the stream to completion
  console.log('\n⏳ Properly consuming stream to completion...');
  
  if (streamRes.body) {
    const reader = streamRes.body.getReader();
    let chunkCount = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`✅ Stream completed after ${chunkCount} chunks`);
          break;
        }
        chunkCount++;
        
        // Decode and log the chunk content for debugging
        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line === 'data: [DONE]') {
            console.log('🏁 Received [DONE] signal');
          }
        }
      }
    } catch (e) {
      console.log('Stream reading error:', e.message);
    } finally {
      reader.releaseLock();
    }
  }
  
  // Wait a bit longer for cleanup to complete
  console.log('⏳ Waiting for cleanup...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n🔍 Testing /api/show after stream ends (should work normally)...');
  
  const postStreamResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
    })
  });
  
  console.log(`📊 Post-stream response status: ${postStreamResponse.status}`);
  
  if (postStreamResponse.status === 200) {
    console.log(`✅ SUCCESS: /api/show works normally after stream ends`);
  } else if (postStreamResponse.status === 503) {
    console.log(`❌ FAIL: /api/show still being rejected after stream ends`);
    const errorData = await postStreamResponse.json();
    console.log(`📋 Still active streams: ${errorData.active_streams}`);
  } else {
    console.log(`❌ FAIL: Unexpected status ${postStreamResponse.status}`);
  }
  
  console.log('🏁 Test completed');
}

testApiShowRejectionProper().catch(console.error);
