#!/usr/bin/env node

// Simple test to verify /api/show endpoint works independently

console.log('🧪 Testing /api/show endpoint independently...');

async function testApiShow() {
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
    console.log('📋 Response headers:', Object.fromEntries(res.headers));
    
    const data = await res.json();
    console.log('📦 Response data keys:', Object.keys(data));
    
    if (data.modelfile) {
      console.log('🎯 Model info found:', data.modelfile.substring(0, 100) + '...');
    }
    
    console.log('✅ /api/show test completed successfully');
    
  } catch (err) {
    console.error('❌ /api/show test failed:', err.message);
  }
}

testApiShow();
