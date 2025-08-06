#!/usr/bin/env node

console.log('🚀 Testing /api/show interference during thinking streams...');

async function testInterference() {
  console.log('\n📡 Starting thinking stream...');
  
  try {
    // Start the thinking stream
    const chatResponse = await fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        messages: [
          { 
            role: "user", 
            content: "Explain how machine learning algorithms work, thinking through each step carefully. Consider neural networks, training processes, and optimization methods."
          }
        ],
        stream: true,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!chatResponse.ok) {
      console.error('❌ Chat request failed:', chatResponse.status);
      return;
    }

    console.log('📺 Processing stream and making /api/show requests...');
    
    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    
    let chunks = 0;
    let thinkingChunks = 0;
    let showRequestsMade = 0;
    let thinkingDetected = false;
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('🏁 Stream ended');
        break;
      }
      
      const chunk = decoder.decode(value);
      chunks++;
      
      // Check for reasoning_content (thinking)
      if (chunk.includes('reasoning_content')) {
        thinkingChunks++;
        
        // Make /api/show requests when thinking is detected
        if (!thinkingDetected) {
          console.log('🧠 Thinking detected! Starting /api/show requests...');
          thinkingDetected = true;
        }
        
        // Make an /api/show request every 5 thinking chunks
        if (thinkingChunks % 5 === 0) {
          console.log(`🔍 Making /api/show request #${Math.floor(thinkingChunks/5)}`);
          
          // Make the request without waiting (fire and forget for now)
          fetch('http://localhost:11434/api/show', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
            }),
          }).then(response => {
            if (response.ok) {
              showRequestsMade++;
              console.log(`✅ /api/show request completed (total: ${showRequestsMade})`);
            } else {
              console.log(`❌ /api/show request failed: ${response.status}`);
            }
          }).catch(error => {
            console.log(`❌ /api/show request error:`, error.message);
          });
        }
      }
      
      // Stop after reasonable number of chunks for testing
      if (chunks > 100) {
        console.log('🛑 Stopping after 100 chunks for test');
        break;
      }
    }
    
    // Wait a moment for pending requests
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n📊 Final Statistics:');
    console.log(`Total chunks: ${chunks}`);
    console.log(`Thinking chunks: ${thinkingChunks}`);
    console.log(`Show requests made: ${showRequestsMade}`);
    
    if (thinkingChunks > 0 && showRequestsMade > 0) {
      console.log('✅ Successfully tested /api/show requests during thinking!');
    } else {
      console.log('⚠️  Test conditions not met');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('❌ Stack:', error.stack);
  }
}

testInterference();
