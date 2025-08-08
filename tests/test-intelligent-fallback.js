#!/usr/bin/env node

// Test the intelligent fallback response approach

console.log('🧪 Testing Intelligent Fallback Response...');

async function testIntelligentFallback() {
  console.log('\n📡 Starting a stream...');
  
  // Start a streaming request (but don't consume it immediately to keep it active)
  const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Think step by step about quantum physics."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 150
    })
  });

  // Wait for stream to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n🔍 Making /api/show request during active stream...');
  console.log('📋 This should get an intelligent fallback response immediately...');
  
  const showStart = Date.now();
  const showResponse = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      model: "/home/thaison/.cache/llama.cpp/DavidAU_Qwen3-4B-Q8_0-64k-128k-256k-context-GGUF_Qwen3-4B-Q8_0-128k.gguf"
    })
  });
  
  const showDuration = Date.now() - showStart;
  
  if (showResponse.ok) {
    const data = await showResponse.json();
    console.log(`✅ /api/show response received in ${showDuration}ms`);
    
    if (showDuration < 100) {
      console.log(`✅ EXCELLENT: Fast response (${showDuration}ms) - fallback working!`);
    } else {
      console.log(`⚠️  Slower response (${showDuration}ms) - might indicate upstream call`);
    }
    
    // Check if the response contains expected model-specific information
    console.log('\n📊 Response analysis:');
    console.log(`Model name: ${data.name || 'missing'}`);
    console.log(`Context length: ${data.model_info?.['llama.context_length'] || 'missing'}`);
    console.log(`Family: ${data.details?.family || 'missing'}`);
    console.log(`Parameter size: ${data.details?.parameter_size || 'missing'}`);
    console.log(`Quantization: ${data.details?.quantization_level || 'missing'}`);
    console.log(`Capabilities: ${data.capabilities?.join(', ') || 'missing'}`);
    
    // Validate that the response looks model-specific
    const modelInName = data.name && data.name.includes('128k');
    const correctContextLength = data.model_info?.['llama.context_length'] === 131072;
    const hasQwen = data.details?.family === 'qwen2';
    const has4B = data.details?.parameter_size === '4.2B';
    
    if (modelInName && correctContextLength && hasQwen && has4B) {
      console.log(`✅ PERFECT: Response is model-specific and accurate!`);
    } else {
      console.log(`⚠️  Response seems generic or inaccurate`);
    }
    
  } else {
    console.log(`❌ /api/show failed: ${showResponse.status}`);
  }
  
  // Let the stream complete
  console.log('\n⏳ Allowing stream to complete...');
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
  
  console.log('\n🎉 Test completed successfully!');
}

testIntelligentFallback().catch(console.error);
