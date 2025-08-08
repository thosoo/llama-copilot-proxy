#!/usr/bin/env node

console.log('🚀 EXTREME stress test for /api/show interference...');

async function extremeStressTest() {
  console.log('\n📡 Starting multiple concurrent thinking streams + heavy /api/show load...');
  
  try {
    // Start 3 concurrent thinking streams
    const streamPromises = [];
    
    for (let streamId = 1; streamId <= 3; streamId++) {
      const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
          messages: [
            { 
              role: "user", 
              content: `Stream ${streamId}: Analyze the complexity of distributed systems architecture, considering microservices, load balancing, database sharding, event-driven architectures, and fault tolerance patterns. Think through each component carefully with detailed reasoning.`
            }
          ],
          stream: true,
          max_tokens: 300,
          temperature: 0.7
        })
      });
      
      streamPromises.push({ id: streamId, promise: streamPromise });
    }
    
    // Make aggressive /api/show requests every 50ms for 10 seconds
    let showRequestCount = 0;
    const showRequestInterval = setInterval(() => {
      showRequestCount++;
      
      fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        }),
      }).then(response => {
        if (!response.ok) {
          console.log(`❌ /api/show #${showRequestCount} failed: ${response.status}`);
        }
      }).catch(error => {
        console.log(`❌ /api/show #${showRequestCount} error:`, error.message);
      });
      
      if (showRequestCount >= 200) { // Stop after 200 requests
        clearInterval(showRequestInterval);
        console.log(`🛑 Stopped /api/show requests after ${showRequestCount} attempts`);
      }
    }, 50); // Every 50ms = 20 requests per second
    
    console.log('📺 Processing concurrent streams...');
    
    // Process all streams concurrently
    await Promise.all(streamPromises.map(async ({ id, promise }) => {
      const response = await promise;
      
      if (!response.ok) {
        console.error(`❌ Stream ${id} failed:`, response.status);
        return;
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let thinkingChunks = 0;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log(`🏁 Stream ${id} ended: ${chunks} chunks (${thinkingChunks} thinking)`);
            break;
          }
          
          const chunk = decoder.decode(value);
          chunks++;
          
          if (chunk.includes('reasoning_content')) {
            thinkingChunks++;
          }
          
          // Stop after reasonable number of chunks
          if (chunks > 150) {
            console.log(`🛑 Stream ${id} stopped after ${chunks} chunks`);
            break;
          }
        }
      } catch (error) {
        console.error(`❌ Stream ${id} read error:`, error.message);
      }
    }));
    
    // Wait for /api/show requests to finish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n📊 Extreme stress test completed!');
    console.log(`✅ Successfully tested concurrent streams with ${showRequestCount} /api/show requests`);
    
  } catch (error) {
    console.error('❌ Extreme stress test failed:', error.message);
  }
}

extremeStressTest();
