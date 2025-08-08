#!/usr/bin/env node

// Test regular content streaming to identify interruption issues

console.log('🔍 Testing Regular Content Streaming...');

async function testRegularContentStreaming() {
  console.log('\n📡 Starting regular content stream (no thinking)...');
  
  try {
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
            content: "Write a simple Python function to calculate factorial. Just give me the code directly without thinking through it step by step."
          }
        ],
        stream: true,
        temperature: 0.1,
        max_tokens: 150
      })
    });

    console.log(`✅ Response received, status: ${response.status}`);
    
    if (!response.body) {
      console.error('❌ No response body');
      return;
    }

    const reader = response.body.getReader();
    let chunks = 0;
    let contentChunks = 0;
    let thinkingChunks = 0;
    let lastChunkTime = Date.now();
    let streamInterrupted = false;
    let totalContent = '';

    console.log('📺 Processing stream chunks...');
    
    // Simulate /api/show requests during regular content streaming
    setTimeout(async () => {
      console.log('\n🔍 Making /api/show request during regular content stream...');
      try {
        const showRes = await fetch('http://localhost:11434/api/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf"
          })
        });
        
        if (showRes.ok) {
          console.log('✅ /api/show request completed successfully');
        } else {
          console.log(`❌ /api/show request failed: ${showRes.status}`);
        }
      } catch (error) {
        console.log(`❌ /api/show error: ${error.message}`);
      }
    }, 2000); // Make request after 2 seconds

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('\n🏁 Stream completed naturally');
          break;
        }
        
        chunks++;
        const now = Date.now();
        const timeSinceLastChunk = now - lastChunkTime;
        lastChunkTime = now;
        
        // Check for long gaps that might indicate interruption
        if (timeSinceLastChunk > 5000 && chunks > 5) {
          console.log(`\n⚠️  Long gap detected: ${timeSinceLastChunk}ms between chunks`);
          streamInterrupted = true;
        }
        
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
                process.stdout.write('💭');
              } else if (delta?.content) {
                contentChunks++;
                totalContent += delta.content;
                process.stdout.write('📝');
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
        
        // Stop after reasonable number of chunks for testing
        if (chunks > 100) {
          console.log('\n🛑 Stopping test after 100 chunks');
          break;
        }
      }
    } catch (error) {
      console.log(`\n❌ Stream error: ${error.message}`);
      streamInterrupted = true;
    } finally {
      reader.releaseLock();
    }
    
    console.log(`\n\n📊 Regular Content Stream Results:`);
    console.log(`   Total chunks: ${chunks}`);
    console.log(`   Content chunks: ${contentChunks}`);
    console.log(`   Thinking chunks: ${thinkingChunks}`);
    console.log(`   Stream interrupted: ${streamInterrupted ? 'YES ❌' : 'NO ✅'}`);
    console.log(`   Content received: ${totalContent.length} characters`);
    
    if (streamInterrupted) {
      console.log('\n❌ ISSUE CONFIRMED: Regular content stream was interrupted');
    } else if (contentChunks > 0) {
      console.log('\n✅ SUCCESS: Regular content stream completed without interruption');
    } else {
      console.log('\n⚠️  WARNING: No content received - possible stream issue');
    }
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
  }
}

testRegularContentStreaming().catch(console.error);
