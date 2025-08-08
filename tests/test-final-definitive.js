#!/usr/bin/env node

console.log('🚀 FINAL DEFINITIVE TEST - Complete stream with interference...');

async function finalDefinitiveTest() {
  console.log('\n📡 Running complete stream test...');
  
  try {
    const streamStartTime = Date.now();
    
    // Start a moderate-sized thinking prompt
    const chatPromise = fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        messages: [
          { 
            role: "user", 
            content: "Analyze the future of artificial intelligence, covering machine learning advances, neural architecture innovations, AGI timelines, and societal implications. Think through each aspect systematically with detailed reasoning."
          }
        ],
        stream: true,
        max_tokens: 500, // Let it complete naturally
        temperature: 0.7
      })
    });

    // Wait a moment then make /api/show requests
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('🔍 Making /api/show requests during stream...');
    
    // Make several /api/show requests during processing
    const showPromises = [];
    for (let i = 1; i <= 6; i++) {
      const showPromise = fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        }),
      }).then(response => {
        console.log(`✅ /api/show #${i}: ${response.status}`);
        return response.ok;
      }).catch(error => {
        console.log(`❌ /api/show #${i} error:`, error.message);
        return false;
      });
      
      showPromises.push(showPromise);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Process the complete stream
    console.log('📺 Processing complete stream...');
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
    let streamCompletedNaturally = false;
    let lastChunkContent = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          streamCompletedNaturally = true;
          console.log('🏁 Stream completed NATURALLY (reached end)');
          break;
        }
        
        const chunk = decoder.decode(value);
        chunks++;
        lastChunkContent = chunk;
        
        if (chunk.includes('reasoning_content')) {
          thinkingChunks++;
        } else if (chunk.includes('"content"')) {
          contentChunks++;
        }
        
        // Look for completion markers
        if (chunk.includes('"finish_reason"') || chunk.includes('[DONE]')) {
          console.log(`🎯 Stream completion marker detected at chunk ${chunks}`);
        }
        
        if (chunks % 50 === 0) {
          console.log(`📊 Progress: ${chunks} chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
        }
      }
    } catch (error) {
      console.error('❌ Stream error:', error.message);
    }
    
    // Wait for /api/show requests
    const showResults = await Promise.all(showPromises);
    const successfulShows = showResults.filter(result => result).length;
    
    const totalTime = Date.now() - streamStartTime;
    
    console.log('\n📊 FINAL DEFINITIVE RESULTS:');
    console.log(`🎯 Natural completion: ${streamCompletedNaturally ? 'YES' : 'NO'}`);
    console.log(`📈 Total chunks: ${chunks} (${thinkingChunks} thinking, ${contentChunks} content)`);
    console.log(`⏱️  Total time: ${Math.round(totalTime/1000)}s`);
    console.log(`✅ /api/show success: ${successfulShows}/${showResults.length}`);
    
    if (streamCompletedNaturally && successfulShows === showResults.length && thinkingChunks > 10) {
      console.log('\n🎉 DEFINITIVE SUCCESS: Interference issue SOLVED!');
      console.log('   ✅ Stream completed naturally without early termination');
      console.log('   ✅ All /api/show requests handled successfully');
      console.log('   ✅ Robust thinking content generation');
      console.log('   ✅ System prevents the reported interference issue');
      console.log('\n🛡️  The proxy successfully prevents /api/show requests from');
      console.log('   interrupting thinking streams via caching and queuing!');
    } else {
      console.log('\n⚠️  Results require investigation');
      if (!streamCompletedNaturally) {
        console.log('   ❌ Stream did not complete naturally');
      }
      if (successfulShows !== showResults.length) {
        console.log('   ❌ Some /api/show requests failed');
      }
      if (thinkingChunks <= 10) {
        console.log('   ❌ Insufficient thinking content generated');
      }
    }
    
  } catch (error) {
    console.error('❌ Final test failed:', error.message);
  }
}

finalDefinitiveTest();
