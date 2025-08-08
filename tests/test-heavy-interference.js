#!/usr/bin/env node

// Test to create heavy /api/show interference during thinking streams

console.log('🚀 Testing heavy /api/show interference during thinking...');

async function testHeavyInterference() {
  console.log('\n📡 Starting thinking stream...');
  
  // Start a long thinking stream
  const chatPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        { 
          role: "user", 
          content: "Write a detailed step-by-step analysis of how quantum computers might revolutionize cryptography, including the mathematical principles behind Shor's algorithm, potential timeline for practical quantum computers that could break RSA encryption, and what post-quantum cryptography solutions are being developed. Please think through each aspect carefully and provide extensive reasoning about the implications for cybersecurity."
        }
      ],
      stream: true,
      max_tokens: 2000,
      temperature: 0.7
    })
  });

  // Track thinking and content separately
  let totalChunks = 0;
  let thinkingChunks = 0;
  let contentChunks = 0;
  let showRequestsMade = 0;
  let showRequestsInProgress = new Set();

  // Function to make /api/show requests
  const makeShowRequest = async (index) => {
    try {
      const requestId = `SHOW-${Date.now()}-${index}`;
      showRequestsInProgress.add(requestId);
      
      console.log(`🔍 Making /api/show request #${index} (${requestId})`);
      
      const showResponse = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        }),
      });
      
      if (showResponse.ok) {
        showRequestsMade++;
        console.log(`✅ /api/show request #${index} completed (${requestId})`);
      } else {
        console.log(`❌ /api/show request #${index} failed: ${showResponse.status} (${requestId})`);
      }
      
      showRequestsInProgress.delete(requestId);
    } catch (error) {
      console.log(`❌ /api/show request #${index} error:`, error.message);
    }
  };

  // Process the chat stream
  const chatResponse = await chatPromise;
  
  if (!chatResponse.ok) {
    console.error('❌ Chat request failed:', chatResponse.status);
    return;
  }

  console.log('📺 Processing stream...');
  const reader = chatResponse.body.getReader();
  const decoder = new TextDecoder();
  
  let thinkingDetected = false;
  let showRequestInterval = null;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('🏁 Stream ended');
        break;
      }
      
      const chunk = decoder.decode(value);
      totalChunks++;
      
      // Check for reasoning_content (thinking)
      if (chunk.includes('reasoning_content')) {
        thinkingChunks++;
        
        // Start making /api/show requests when thinking is detected
        if (!thinkingDetected) {
          console.log('🧠 Thinking detected! Starting /api/show interference...');
          thinkingDetected = true;
          
          // Make 10 concurrent /api/show requests with staggered timing
          for (let i = 1; i <= 10; i++) {
            setTimeout(() => makeShowRequest(i), i * 100); // Stagger by 100ms each
          }
        }
      } else if (chunk.includes('"content"')) {
        contentChunks++;
      }
      
      // Log progress every 50 chunks
      if (totalChunks % 50 === 0) {
        console.log(`📊 Progress: ${totalChunks} chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
      }
    }
  } catch (error) {
    console.error('❌ Error reading stream:', error);
  } finally {
    if (showRequestInterval) {
      clearInterval(showRequestInterval);
    }
  }
  
  // Wait for any remaining /api/show requests to complete
  console.log(`⏳ Waiting for ${showRequestsInProgress.size} remaining /api/show requests...`);
  while (showRequestsInProgress.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Final stats
  console.log('\n📊 Final Statistics:');
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Thinking chunks: ${thinkingChunks}`);
  console.log(`Content chunks: ${contentChunks}`);
  console.log(`Show requests made: ${showRequestsMade}`);
  
  if (thinkingChunks === 0) {
    console.log('⚠️  No thinking content detected - may need a different prompt');
  } else {
    console.log('✅ Test completed with thinking content');
  }
}

testHeavyInterference().catch(console.error);
