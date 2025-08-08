#!/usr/bin/env node

// Test to verify that the stream interference fix is working correctly

console.log('🧪 Testing Stream Interference Fix...');

let streamActive = false;
let interferenceDetected = false;
let totalApiShowRequests = 0;
let successfulApiShowRequests = 0;

async function testStreamIntereferenceFix() {
  console.log('\n📡 Starting chat completion stream...');
  
  // Start a streaming chat completion
  const chatPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Please think through this step by step: Explain the concept of recursion in programming with detailed examples and reasoning."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 200
    })
  });

  // Process the stream
  chatPromise.then(async res => {
    console.log('✅ Stream response received, status:', res.status);
    
    if (!res.body) {
      console.error('❌ No response body');
      return;
    }

    const reader = res.body.getReader();
    let chunkCount = 0;
    let thinkingChunks = 0;
    streamActive = true;

    console.log('🔄 Processing stream chunks...');

    async function processChunk() {
      try {
        const { done, value } = await reader.read();
        
        if (done) {
          streamActive = false;
          console.log('\n🏁 Stream completed');
          console.log(`📊 Statistics:`);
          console.log(`   Total chunks: ${chunkCount}`);
          console.log(`   Thinking chunks: ${thinkingChunks}`);
          console.log(`   API show requests: ${totalApiShowRequests}`);
          console.log(`   Successful show requests: ${successfulApiShowRequests}`);
          console.log(`   Interference detected: ${interferenceDetected ? 'YES ❌' : 'NO ✅'}`);
          
          if (!interferenceDetected && successfulApiShowRequests > 0) {
            console.log('\n🎉 SUCCESS: Stream interference fix is working!');
          } else if (interferenceDetected) {
            console.log('\n❌ FAILURE: Stream interference still occurring');
          } else {
            console.log('\n⚠️  WARNING: No API show requests were made during the test');
          }
          return;
        }

        chunkCount++;
        const chunk = new TextDecoder().decode(value);
        
        // Parse SSE data  
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.substring(6));
              const delta = data.choices?.[0]?.delta;
              
              if (delta?.reasoning_content) {
                thinkingChunks++;
                if (thinkingChunks === 1) {
                  console.log('🧠 Thinking started - beginning API show requests...');
                  // Start making API show requests during thinking
                  startApiShowRequests();
                }
                process.stdout.write('💭');
              }
              
              if (delta?.content) {
                process.stdout.write('📝');
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
        
        return processChunk();
      } catch (error) {
        streamActive = false;
        console.error('\n❌ Stream error:', error.message);
      }
    }

    return processChunk();
  }).catch(err => {
    streamActive = false;
    console.error('❌ Stream request failed:', err.message);
  });
}

async function startApiShowRequests() {
  console.log('\n🔍 Starting concurrent API show requests...');
  
  for (let i = 1; i <= 10 && streamActive; i++) {
    try {
      totalApiShowRequests++;
      console.log(`\n🔍 Making API show request #${i}...`);
      
      const start = Date.now();
      const showResponse = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" 
        })
      });
      const duration = Date.now() - start;
      
      if (showResponse.ok) {
        successfulApiShowRequests++;
        console.log(`✅ API show request #${i} completed in ${duration}ms`);
        
        // Check if the response was served from cache (fast) or upstream (slower)
        if (duration < 50) {
          console.log(`   📋 Likely served from cache (fast response)`);
        } else {
          console.log(`   🌐 Likely went to upstream (slower response)`);
          if (streamActive && duration > 200) {
            interferenceDetected = true;
            console.log(`   ⚠️  POTENTIAL INTERFERENCE: Slow response during active stream`);
          }
        }
      } else {
        console.log(`❌ API show request #${i} failed: ${showResponse.status}`);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.log(`❌ API show request #${i} error: ${error.message}`);
    }
  }
}

// Start the test
testStreamIntereferenceFix();

// Set a timeout to end the test
setTimeout(() => {
  if (streamActive) {
    console.log('\n⏰ Test timeout reached');
    streamActive = false;
  }
}, 30000); // 30 second timeout
