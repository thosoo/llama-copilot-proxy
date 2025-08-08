#!/usr/bin/env node

// Comprehensive test for /api/show rejection during active streams

console.log('🧪 Comprehensive test for /api/show rejection behavior...');

async function comprehensiveTest() {
  const testResults = [];
  
  // Test 1: /api/show works when no streams are active
  console.log('\n📋 Test 1: /api/show works when no streams are active');
  try {
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    });
    
    if (res.status === 200) {
      console.log('✅ PASS: /api/show works when no streams are active');
      testResults.push({ test: 'No streams', result: 'PASS' });
    } else {
      console.log(`❌ FAIL: Expected 200, got ${res.status}`);
      testResults.push({ test: 'No streams', result: 'FAIL' });
    }
  } catch (e) {
    console.log(`❌ FAIL: Error - ${e.message}`);
    testResults.push({ test: 'No streams', result: 'FAIL' });
  }
  
  // Test 2: /api/show rejected during thinking stream
  console.log('\n📋 Test 2: /api/show rejected during thinking stream');
  const thinkingStreamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [{ role: "user", content: "Think step by step: 2+2" }],
      stream: true,
      temperature: 0.3,
      max_tokens: 50
    })
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    });
    
    if (res.status === 503) {
      console.log('✅ PASS: /api/show rejected during thinking stream');
      testResults.push({ test: 'Thinking stream', result: 'PASS' });
    } else {
      console.log(`❌ FAIL: Expected 503, got ${res.status}`);
      testResults.push({ test: 'Thinking stream', result: 'FAIL' });
    }
  } catch (e) {
    console.log(`❌ FAIL: Error - ${e.message}`);
    testResults.push({ test: 'Thinking stream', result: 'FAIL' });
  }
  
  // Clean up thinking stream
  try {
    const streamRes = await thinkingStreamPromise;
    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      let chunks = 0;
      while (chunks < 10) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
      reader.releaseLock();
    }
  } catch (e) {
    console.log('Thinking stream cleanup error');
  }
  
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Test 3: /api/show rejected during regular stream
  console.log('\n📋 Test 3: /api/show rejected during regular stream');
  const regularStreamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [{ role: "user", content: "Say hello" }],
      stream: true,
      temperature: 0.3,
      max_tokens: 10
    })
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    });
    
    if (res.status === 503) {
      console.log('✅ PASS: /api/show rejected during regular stream');
      testResults.push({ test: 'Regular stream', result: 'PASS' });
    } else {
      console.log(`❌ FAIL: Expected 503, got ${res.status}`);
      testResults.push({ test: 'Regular stream', result: 'FAIL' });
    }
  } catch (e) {
    console.log(`❌ FAIL: Error - ${e.message}`);
    testResults.push({ test: 'Regular stream', result: 'FAIL' });
  }
  
  // Clean up regular stream
  try {
    const streamRes = await regularStreamPromise;
    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      let chunks = 0;
      while (chunks < 10) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
      reader.releaseLock();
    }
  } catch (e) {
    console.log('Regular stream cleanup error');
  }
  
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Test 4: /api/show works after streams complete
  console.log('\n📋 Test 4: /api/show works after streams complete');
  try {
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    });
    
    if (res.status === 200) {
      console.log('✅ PASS: /api/show works after streams complete');
      testResults.push({ test: 'After streams', result: 'PASS' });
    } else {
      console.log(`❌ FAIL: Expected 200, got ${res.status}`);
      testResults.push({ test: 'After streams', result: 'FAIL' });
    }
  } catch (e) {
    console.log(`❌ FAIL: Error - ${e.message}`);
    testResults.push({ test: 'After streams', result: 'FAIL' });
  }
  
  // Test 5: Error response format
  console.log('\n📋 Test 5: Error response format during active stream');
  const formatTestStreamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [{ role: "user", content: "Count to 3" }],
      stream: true,
      temperature: 0.3,
      max_tokens: 15
    })
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    const res = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
    });
    
    if (res.status === 503) {
      const errorData = await res.json();
      
      const requiredFields = ['error', 'message', 'active_streams', 'retry_after'];
      const hasAllFields = requiredFields.every(field => errorData.hasOwnProperty(field));
      
      if (hasAllFields && 
          errorData.error === 'service_temporarily_unavailable' && 
          errorData.active_streams > 0) {
        console.log('✅ PASS: Error response format is correct');
        testResults.push({ test: 'Error format', result: 'PASS' });
      } else {
        console.log('❌ FAIL: Error response format is incorrect');
        console.log('❌ Missing fields or wrong values:', errorData);
        testResults.push({ test: 'Error format', result: 'FAIL' });
      }
    } else {
      console.log(`❌ FAIL: Expected 503, got ${res.status}`);
      testResults.push({ test: 'Error format', result: 'FAIL' });
    }
  } catch (e) {
    console.log(`❌ FAIL: Error - ${e.message}`);
    testResults.push({ test: 'Error format', result: 'FAIL' });
  }
  
  // Clean up format test stream
  try {
    const streamRes = await formatTestStreamPromise;
    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      let chunks = 0;
      while (chunks < 10) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
      reader.releaseLock();
    }
  } catch (e) {
    console.log('Format test stream cleanup error');
  }
  
  // Summary
  console.log('\n🏁 Test Summary:');
  console.log('================');
  
  let passCount = 0;
  testResults.forEach(({ test, result }) => {
    console.log(`${result === 'PASS' ? '✅' : '❌'} ${test}: ${result}`);
    if (result === 'PASS') passCount++;
  });
  
  console.log(`\n📊 Results: ${passCount}/${testResults.length} tests passed`);
  
  if (passCount === testResults.length) {
    console.log('🎉 ALL TESTS PASSED! /api/show rejection feature working correctly.');
  } else {
    console.log('❌ Some tests failed. Please check the implementation.');
  }
}

comprehensiveTest().catch(console.error);
