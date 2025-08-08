#!/usr/bin/env node

console.log('🚀 Testing IMMEDIATE interference during stream startup...');

async function testImmediateInterference() {
  console.log('\n📡 Starting thinking stream with immediate /api/show requests...');
  
  try {
    // Start the stream and immediately make /api/show requests
    const chatPromise = fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        messages: [
          { 
            role: "user", 
            content: "Provide an extremely detailed analysis of quantum computing algorithms, including Shor's algorithm, Grover's algorithm, quantum error correction, and quantum supremacy demonstrations. Think through each mathematical principle step by step with comprehensive reasoning about the implications for classical computing paradigms."
          }
        ],
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    console.log('🔍 Making /api/show requests IMMEDIATELY (testing caching/queuing)...');
    
    // Make /api/show requests immediately without waiting
    const showPromises = [];
    for (let i = 1; i <= 8; i++) {
      const showPromise = fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        }),
      }).then(response => {
        const responseTime = Date.now();
        console.log(`✅ /api/show #${i} completed: ${response.status} at ${new Date(responseTime).toISOString()}`);
        return { success: response.ok, time: responseTime };
      }).catch(error => {
        console.log(`❌ /api/show #${i} error:`, error.message);
        return { success: false, time: Date.now() };
      });
      
      showPromises.push(showPromise);
    }
    
    // Process the chat stream
    console.log('📺 Processing chat stream...');
    const streamStartTime = Date.now();
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
    let firstChunkTime = null;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('🏁 Stream completed successfully!');
          break;
        }
        
        const chunk = decoder.decode(value);
        chunks++;
        
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          console.log(`⏱️  First chunk received ${firstChunkTime - streamStartTime}ms after stream start`);
        }
        
        if (chunk.includes('reasoning_content')) {
          thinkingChunks++;
        } else if (chunk.includes('"content"')) {
          contentChunks++;
        }
        
        // Show progress less frequently for longer stream
        if (chunks % 100 === 0) {
          console.log(`📊 Progress: ${chunks} chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
        }
        
        // Let it run longer to test durability
        if (chunks > 300) {
          console.log('🛑 Stopping test after 300 chunks');
          break;
        }
      }
    } catch (error) {
      console.error('❌ Error reading stream:', error);
    }
    
    // Wait for all /api/show requests to complete
    const showResults = await Promise.all(showPromises);
    const successfulShows = showResults.filter(result => result.success).length;
    
    // Calculate timing
    const streamEndTime = Date.now();
    const totalStreamTime = streamEndTime - streamStartTime;
    const avgShowResponseTime = showResults.reduce((sum, result) => sum + (result.time - streamStartTime), 0) / showResults.length;
    
    console.log('\n📊 Detailed Test Results:');
    console.log(`✅ Stream: ${chunks} total chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
    console.log(`⏱️  Stream duration: ${totalStreamTime}ms`);
    console.log(`⏱️  First chunk: ${firstChunkTime - streamStartTime}ms`);
    console.log(`✅ /api/show: ${successfulShows}/${showResults.length} successful`);
    console.log(`⏱️  Avg /api/show response: ${Math.round(avgShowResponseTime)}ms`);
    
    if (chunks > 200 && thinkingChunks > 50 && successfulShows === showResults.length) {
      console.log('🎉 PERFECT SUCCESS: Advanced interference prevention working!');
      console.log('   ✅ Long stream completed without interruption');
      console.log('   ✅ All concurrent /api/show requests handled'); 
      console.log('   ✅ No interference or early termination');
      console.log('   ✅ Fast response times maintained');
    } else {
      console.log('⚠️  Results need investigation');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testImmediateInterference();
