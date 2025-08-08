#!/usr/bin/env node

// Test to ensure our debugging logs for /api/show are working

console.log('🧪 Testing /api/show debug logging...');

async function testApiShowLogging() {
  try {
    console.log('📡 Making /api/show request to proxy...');
    
    // Make request to the proxy, not directly to llama-server
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" 
      })
    });
    
    console.log('✅ Response status:', res.status);
    
    const data = await res.json();
    console.log('📦 Response received with', Object.keys(data).length, 'keys');
    
    console.log('✅ /api/show proxy test completed - check proxy logs for debug output');
    
  } catch (err) {
    console.error('❌ /api/show proxy test failed:', err.message);
  }
}

testApiShowLogging();
