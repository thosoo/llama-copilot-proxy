#!/usr/bin/env node

console.log('🚀 Simple test starting...');

// Test basic connectivity first
async function testConnectivity() {
  try {
    console.log('📡 Testing basic connectivity...');
    
    const healthResponse = await fetch('http://localhost:11434/health');
    console.log('✅ Health check:', healthResponse.status);
    
    const showResponse = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "test" })
    });
    console.log('✅ /api/show test:', showResponse.status);
    
    console.log('🎯 Starting thinking test...');
    
    const chatResponse = await fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        messages: [{ role: "user", content: "Explain quantum computing briefly but think step by step." }],
        stream: true,
        max_tokens: 100
      })
    });
    
    console.log('📺 Chat response status:', chatResponse.status);
    
    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('❌ Chat error:', errorText);
      return;
    }
    
    console.log('📖 Reading stream...');
    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    
    let chunks = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      chunks++;
      
      if (chunk.includes('reasoning_content')) {
        console.log('🧠 Found reasoning_content in chunk', chunks);
      }
      
      if (chunks % 10 === 0) {
        console.log(`📊 Processed ${chunks} chunks`);
      }
      
      if (chunks > 50) {
        console.log('🛑 Stopping after 50 chunks for test');
        break;
      }
    }
    
    console.log(`✅ Test completed. Total chunks: ${chunks}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('❌ Stack:', error.stack);
  }
}

testConnectivity();
