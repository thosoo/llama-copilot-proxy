#!/usr/bin/env node

// Test the new deferred response approach for /api/show during active streams

console.log('🧪 Testing Deferred Response Approach...');

async function testDeferredResponse() {
  console.log('\n📡 Starting a long stream...');
  
  // Start a streaming request
  const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Think step by step: Explain the theory of relativity with detailed reasoning. This should generate a long thinking session."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 300
    })
  });

  // Wait for stream to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making /api/show request during active stream...');
  console.log('⏳ This should be deferred until the stream completes...');
  
  const showStart = Date.now();
  const showPromise = fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      model: "/home/thaison/.cache/llama.cpp/DavidAU_Qwen3-4B-Q8_0-64k-128k-256k-context-GGUF_Qwen3-4B-Q8_0-128k.gguf"
    })
  });
  
  console.log('📺 Processing stream while /api/show is deferred...');
  
  // Process the stream
  const streamRes = await streamPromise;
  let chunks = 0;
  let thinkingChunks = 0;
  
  if (streamRes.body) {
    const reader = streamRes.body.getReader();
    try {
      while (chunks < 100) { // Process some chunks
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks++;
        const chunk = new TextDecoder().decode(value);
        
        // Look for thinking content
        if (chunk.includes('reasoning_content')) {
          thinkingChunks++;
          process.stdout.write('💭');
        } else if (chunk.includes('"content"')) {
          process.stdout.write('📝');
        }
      }
      reader.releaseLock();
    } catch (e) {
      console.log('\nStream ended or error occurred');
    }
  }
  
  console.log(`\n🏁 Stream processed ${chunks} chunks (${thinkingChunks} thinking)`);
  
  // Now check if the /api/show response comes through
  console.log('\n⏳ Waiting for deferred /api/show response...');
  
  try {
    const showRes = await showPromise;
    const showDuration = Date.now() - showStart;
    
    if (showRes.ok) {
      const data = await showRes.json();
      console.log(`✅ /api/show response received after ${showDuration}ms`);
      
      if (data.model_info) {
        console.log(`✅ Response contains valid model info`);
      } else {
        console.log(`⚠️  Response missing model info:`, data);
      }
      
      if (showDuration > 5000) {
        console.log(`✅ GOOD: Response was properly deferred (${showDuration}ms delay)`);
      } else {
        console.log(`⚠️  Response came quickly (${showDuration}ms) - might not have been deferred`);
      }
    } else {
      console.log(`❌ /api/show failed: ${showRes.status}`);
    }
  } catch (error) {
    console.log(`❌ /api/show error: ${error.message}`);
  }
  
  console.log('\n🏁 Test completed');
}

testDeferredResponse().catch(console.error);
