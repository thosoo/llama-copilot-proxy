#!/usr/bin/env node

// Test to reproduce the exact /api/show interference issue reported

console.log('🚀 Testing /api/show interference during thinking streams');

// Start a thinking stream
const startThinkingStream = () => {
  console.log('\n📡 Starting thinking stream...');
  
  const request = JSON.stringify({
    model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
    messages: [
      {
        role: "user", 
        content: "Think carefully about this math problem step by step: What is 15 * 7? Show your detailed reasoning."
      }
    ],
    stream: true,
    temperature: 0.3,
    max_tokens: 300
  });

  return fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: request
  })
  .then(res => {
    console.log('✅ Thinking stream started, status:', res.status);
    return res;
  });
};

// Make an /api/show request
const makeApiShowRequest = () => {
  console.log('\n🔥 Making /api/show request (simulating VSCode)...');
  
  return fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" 
    })
  })
  .then(res => res.json())
  .then(data => {
    console.log('✅ /api/show response received');
    return data;
  })
  .catch(err => {
    console.error('❌ /api/show failed:', err.message);
  });
};

// Test the interference
async function testInterference() {
  try {
    // Start the thinking stream
    const streamRes = await startThinkingStream();
    
    if (!streamRes.body) {
      console.error('❌ No response body from stream');
      return;
    }

    const reader = streamRes.body.getReader();
    let chunkCount = 0;
    let thinkingDetected = false;
    let apiShowMade = false;
    
    // Process the stream
    const processStream = async () => {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('\n🏁 Stream completed');
          console.log('📊 Final stats:');
          console.log('   Total chunks:', chunkCount);
          console.log('   Thinking detected:', thinkingDetected);
          console.log('   API Show made:', apiShowMade);
          break;
        }

        chunkCount++;
        const chunk = new TextDecoder().decode(value);
        
        // Look for thinking content
        if (chunk.includes('reasoning_content')) {
          if (!thinkingDetected) {
            console.log('\n🧠 THINKING DETECTED! Making /api/show request now...');
            thinkingDetected = true;
            
            // Make the interfering request immediately
            if (!apiShowMade) {
              apiShowMade = true;
              makeApiShowRequest(); // Don't await - let it run concurrently
            }
          }
          process.stdout.write('🧠');
        }
        
        if (chunk.includes('"content"')) {
          process.stdout.write('📝');
        }
      }
    };

    await processStream();
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

// Run the test
testInterference();
