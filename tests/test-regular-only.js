#!/usr/bin/env node

// Test regular content streaming with a prompt that should definitely produce regular content

console.log('🔍 Testing Regular Content Streaming (Forced Regular Content)...');

async function testRegularContentOnly() {
  console.log('\n📡 Starting stream with prompt that should produce regular content...');
  
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
            role: "system",
            content: "You are a helpful assistant. Respond directly without thinking steps or reasoning."
          },
          {
            role: "user", 
            content: "Hello! How are you today?"
          }
        ],
        stream: true,
        temperature: 0.1,
        max_tokens: 100
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
    let streamInterrupted = false;
    let totalContent = '';
    let lastChunkTime = Date.now();

    console.log('📺 Processing stream chunks...');
    
    // Start /api/show request after a delay
    setTimeout(async () => {
      console.log('\n🔍 Making /api/show request during stream...');
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
        
        if (showRes.ok) {
          console.log(`✅ /api/show completed in ${duration}ms`);
        } else {
          console.log(`❌ /api/show failed: ${showRes.status}`);
        }
      } catch (error) {
        console.log(`❌ /api/show error: ${error.message}`);
      }
    }, 1000);

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
        
        // Detect interruptions
        if (timeSinceLastChunk > 10000) {
          console.log(`\n❌ INTERRUPTION DETECTED: ${timeSinceLastChunk}ms gap!`);
          streamInterrupted = true;
        }
        
        lastChunkTime = now;
        
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
        
        // Stop after reasonable number of chunks
        if (chunks > 50) {
          console.log('\n🛑 Stopping test after 50 chunks');
          break;
        }
      }
    } catch (error) {
      console.log(`\n❌ Stream error: ${error.message}`);
      streamInterrupted = true;
    } finally {
      reader.releaseLock();
    }
    
    console.log(`\n\n📊 Stream Results:`);
    console.log(`   Total chunks: ${chunks}`);
    console.log(`   Content chunks: ${contentChunks}`);
    console.log(`   Thinking chunks: ${thinkingChunks}`);
    console.log(`   Stream interrupted: ${streamInterrupted ? 'YES ❌' : 'NO ✅'}`);
    console.log(`   Content received: "${totalContent.substring(0, 50)}${totalContent.length > 50 ? '...' : ''}"`);
    
    if (streamInterrupted) {
      console.log('\n❌ ISSUE CONFIRMED: Stream was interrupted');
      return 'interrupted';
    } else if (contentChunks > 0) {
      console.log('\n✅ SUCCESS: Regular content stream completed without interruption');
      return 'success';
    } else if (thinkingChunks > 0) {
      console.log('\n🤔 INFO: Only thinking content received (model behavior, not interruption)');
      return 'thinking_only';
    } else {
      console.log('\n⚠️  WARNING: No content received at all');
      return 'no_content';
    }
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return 'error';
  }
}

testRegularContentOnly().catch(console.error);
