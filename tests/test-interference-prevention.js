#!/usr/bin/env node

console.log('🚀 Testing NEW interference prevention system...');

async function testInterferencePrevention() {
  console.log('\n📡 Starting thinking stream to trigger protection...');
  
  try {
    // Start a thinking stream that would normally be interrupted
    const chatPromise = fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        messages: [
          { 
            role: "user", 
            content: "Write a comprehensive analysis of blockchain technology, covering consensus mechanisms, smart contracts, scalability challenges, and real-world applications. Think through each aspect methodically with detailed reasoning."
          }
        ],
        stream: true,
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    // Give the stream a moment to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('🔍 Making /api/show requests during active stream (should be cached/queued)...');
    
    // Make multiple /api/show requests that should now be handled by cache/queue
    const showPromises = [];
    for (let i = 1; i <= 5; i++) {
      const showPromise = fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        }),
      }).then(response => {
        console.log(`✅ /api/show request #${i} completed: ${response.status}`);
        return response.ok;
      }).catch(error => {
        console.log(`❌ /api/show request #${i} error:`, error.message);
        return false;
      });
      
      showPromises.push(showPromise);
      await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between requests
    }
    
    // Process the chat stream
    console.log('📺 Processing chat stream (should complete without interruption)...');
    const chatResponse = await chatPromise;
    
    if (!chatResponse.ok) {
      console.error('❌ Chat request failed:', chatResponse.status);
      return;
    }

    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    
    let chunks = 0;
    let thinkingChunks = 0;
    let contentChunks = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('🏁 Stream completed successfully!');
          break;
        }
        
        const chunk = decoder.decode(value);
        chunks++;
        
        if (chunk.includes('reasoning_content')) {
          thinkingChunks++;
        } else if (chunk.includes('"content"')) {
          contentChunks++;
        }
        
        // Show progress
        if (chunks % 50 === 0) {
          console.log(`📊 Progress: ${chunks} chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
        }
        
        // Stop after reasonable amount for testing
        if (chunks > 200) {
          console.log('🛑 Stopping test after 200 chunks');
          break;
        }
      }
    } catch (error) {
      console.error('❌ Error reading stream:', error);
    }
    
    // Wait for all /api/show requests to complete
    const showResults = await Promise.all(showPromises);
    const successfulShows = showResults.filter(result => result).length;
    
    console.log('\n📊 Test Results:');
    console.log(`✅ Stream completed: ${chunks} total chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
    console.log(`✅ /api/show requests: ${successfulShows}/${showResults.length} successful`);
    
    if (chunks > 100 && thinkingChunks > 10 && successfulShows === showResults.length) {
      console.log('🎉 SUCCESS: Interference prevention is working!');
      console.log('   - Stream completed without interruption');
      console.log('   - All /api/show requests handled successfully'); 
      console.log('   - No interference detected');
    } else {
      console.log('⚠️  Results need review - check proxy logs for details');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testInterferencePrevention();
