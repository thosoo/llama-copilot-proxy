#!/usr/bin/env node

// Test with unique identifier to track in logs

console.log('🧪 Testing /api/show with unique identifier...');

async function testApiShowWithId() {
  try {
    const uniqueId = `TEST-${Date.now()}`;
    console.log(`📡 Making /api/show request with ID: ${uniqueId}`);
    
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Test-ID': uniqueId 
      },
      body: JSON.stringify({ 
        name: uniqueId, // Use unique ID as model name to track in logs
      })
    });
    
    console.log('✅ Response status:', res.status);
    
    if (res.status === 200) {
      const data = await res.json();
      console.log('📦 Response received');
    } else {
      const text = await res.text();
      console.log('❌ Error response:', text);
    }
    
    console.log(`✅ Test completed with ID: ${uniqueId}`);
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

testApiShowWithId();
