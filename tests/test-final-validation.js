#!/usr/bin/env node

// Comprehensive test showing that stream interference is fixed and the issue is model behavior

console.log('🔍 STREAM INTERFERENCE FIX - COMPREHENSIVE TEST');
console.log('=====================================================');

async function runTest(description, testFn) {
  console.log(`\n🧪 ${description}`);
  console.log('─'.repeat(50));
  
  try {
    const result = await testFn();
    console.log(`✅ Result: ${result}`);
    return result;
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return 'error';
  }
}

async function testStreamInterference() {
  const response = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.29.1'
    },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Hello! How are you?"
        }
      ],
      stream: true,
      temperature: 0.1,
      max_tokens: 50
    })
  });

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  let chunks = 0;
  let interrupted = false;
  let lastChunkTime = Date.now();
  let apiShowCompleted = false;
  
  // Start /api/show request during stream
  setTimeout(async () => {
    try {
      const start = Date.now();
      const showRes = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
        })
      });
      
      const duration = Date.now() - start;
      apiShowCompleted = showRes.ok;
      console.log(`   📊 /api/show: ${showRes.ok ? 'SUCCESS' : 'FAILED'} (${duration}ms)`);
    } catch (error) {
      console.log(`   📊 /api/show: ERROR - ${error.message}`);
    }
  }, 500);

  try {
    while (chunks < 20) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks++;
      const now = Date.now();
      const gap = now - lastChunkTime;
      
      if (gap > 5000) {
        interrupted = true;
        console.log(`   ❌ INTERRUPTION: ${gap}ms gap detected!`);
        break;
      }
      
      lastChunkTime = now;
      process.stdout.write('📦');
      
      if (chunks >= 20) break;
    }
  } finally {
    reader.releaseLock();
  }
  
  console.log(`\n   📈 Chunks received: ${chunks}`);
  console.log(`   🔍 API show completed: ${apiShowCompleted ? 'YES' : 'NO'}`);
  console.log(`   ⚡ Stream interrupted: ${interrupted ? 'YES' : 'NO'}`);
  
  if (interrupted) {
    return 'INTERRUPTED - ISSUE PRESENT';
  } else if (apiShowCompleted && chunks > 0) {
    return 'SUCCESS - NO INTERFERENCE';
  } else {
    return 'PARTIAL - SOME ISSUES';
  }
}

async function testMultipleApiShowRequests() {
  console.log('   🚀 Starting stream...');
  
  const response = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.29.1'
    },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Tell me about cats"
        }
      ],
      stream: true,
      temperature: 0.1,
      max_tokens: 100
    })
  });

  const reader = response.body.getReader();
  let chunks = 0;
  let interrupted = false;
  let apiShowResults = [];
  
  // Fire multiple /api/show requests during stream
  const apiShowPromises = [];
  for (let i = 0; i < 3; i++) {
    const promise = (async () => {
      await new Promise(resolve => setTimeout(resolve, 300 + i * 200));
      
      try {
        const start = Date.now();
        const showRes = await fetch('http://localhost:11434/api/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
          })
        });
        
        const duration = Date.now() - start;
        return { success: showRes.ok, duration, id: i + 1 };
      } catch (error) {
        return { success: false, duration: 0, id: i + 1, error: error.message };
      }
    })();
    
    apiShowPromises.push(promise);
  }
  
  // Process stream
  let lastChunkTime = Date.now();
  try {
    while (chunks < 30) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks++;
      const now = Date.now();
      const gap = now - lastChunkTime;
      
      if (gap > 5000) {
        interrupted = true;
        break;
      }
      
      lastChunkTime = now;
      if (chunks % 5 === 0) process.stdout.write('📦');
    }
  } finally {
    reader.releaseLock();
  }
  
  // Wait for all API show requests to complete
  apiShowResults = await Promise.all(apiShowPromises);
  
  console.log(`\n   📈 Stream chunks: ${chunks}`);
  console.log(`   ⚡ Interrupted: ${interrupted ? 'YES' : 'NO'}`);
  
  apiShowResults.forEach(result => {
    console.log(`   🔍 API show ${result.id}: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.duration}ms)${result.error ? ` - ${result.error}` : ''}`);
  });
  
  const allSucceeded = apiShowResults.every(r => r.success);
  
  if (interrupted) {
    return 'STREAMS INTERRUPTED';
  } else if (allSucceeded) {
    return 'ALL REQUESTS SUCCESSFUL';
  } else {
    return 'SOME API SHOW FAILURES';
  }
}

async function main() {
  console.log('Testing stream interference fixes...\n');
  
  const test1 = await runTest('Test 1: Basic stream with single /api/show', testStreamInterference);
  const test2 = await runTest('Test 2: Stream with multiple concurrent /api/show', testMultipleApiShowRequests);
  
  console.log('\n🎯 FINAL RESULTS');
  console.log('═'.repeat(50));
  console.log(`Test 1 (Basic): ${test1}`);
  console.log(`Test 2 (Multiple): ${test2}`);
  
  if (test1.includes('SUCCESS') && test2.includes('SUCCESSFUL')) {
    console.log('\n🎉 STREAM INTERFERENCE ISSUE: FULLY RESOLVED');
    console.log('   ✅ Streams complete without interruption');
    console.log('   ✅ /api/show requests work during streams');
    console.log('   ✅ Multiple concurrent requests handled properly');
    console.log('\n💡 NOTE: If you see thinking content instead of regular content,');
    console.log('   this is model behavior - configure THINKING_MODE as needed.');
  } else {
    console.log('\n❌ STREAM INTERFERENCE ISSUE: STILL PRESENT');
    console.log('   Investigation and fixes needed');
  }
}

main().catch(console.error);
