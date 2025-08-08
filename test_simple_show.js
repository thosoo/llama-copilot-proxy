#!/usr/bin/env node

// Simple test to check if /api/show works when no streams are active

console.log('🧪 Testing /api/show when no streams are active...');

async function testApiShowAlone() {
  try {
    console.log('📡 Making /api/show request...');
    
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" 
      })
    });
    
    console.log('✅ Response status:', res.status);
    
    if (res.status === 200) {
      console.log('✅ SUCCESS: /api/show works when no streams are active');
      const data = await res.json();
      console.log('📦 Response has keys:', Object.keys(data));
    } else if (res.status === 503) {
      console.log('❌ FAIL: /api/show incorrectly rejected when no streams are active');
      const errorData = await res.json();
      console.log('📋 Error response:', JSON.stringify(errorData, null, 2));
    } else {
      console.log(`❌ FAIL: Unexpected status ${res.status}`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testApiShowAlone();
