#!/usr/bin/env node

// Test script to reproduce /api/show interference during thinking streams

const request = JSON.stringify({
  model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
  messages: [
    {
      role: "user",
      content: "Please think step by step about solving 2+2. Show your reasoning process."
    }
  ],
  stream: true,
  temperature: 0.7,
  max_tokens: 150
});

console.log('🚀 Starting thinking stream with /api/show interference test');
console.log('📝 Request:', JSON.stringify(JSON.parse(request), null, 2));

fetch('http://localhost:11434/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: request
})
.then(res => {
  console.log('\n✅ Response received, status:', res.status);
  
  if (!res.body) {
    console.error('❌ No response body');
    return;
  }

  const reader = res.body.getReader();
  let chunkCount = 0;
  let thinkingStarted = false;
  let thinkingEnded = false;
  let allContent = '';

  function processChunk() {
    return reader.read().then(({ done, value }) => {
      if (done) {
        console.log('\n🏁 Stream completed');
        console.log('📊 Final stats:');
        console.log('   Total chunks:', chunkCount);
        console.log('   Thinking started:', thinkingStarted);
        console.log('   Thinking ended:', thinkingEnded);
        console.log('   Total content length:', allContent.length);
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
              if (!thinkingStarted) {
                console.log('\n🧠 Thinking started...');
                thinkingStarted = true;
                
                // Simulate VSCode making /api/show request during thinking
                setTimeout(() => {
                  console.log('\n🔥 SIMULATING /api/show REQUEST DURING THINKING...');
                  fetch('http://localhost:11434/api/show', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" })
                  })
                  .then(res => res.json())
                  .then(data => {
                    console.log('🔍 /api/show response received');
                  })
                  .catch(err => {
                    console.error('❌ /api/show error:', err.message);
                  });
                }, 100); // Small delay to let thinking start
              }
              
              allContent += delta.reasoning_content;
              process.stdout.write('🧠');
            }
            
            if (delta?.content) {
              if (thinkingStarted && !thinkingEnded) {
                console.log('\n💭 Thinking -> Content transition detected');
                thinkingEnded = true;
              }
              allContent += delta.content;
              process.stdout.write('📝');
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
      
      return processChunk();
    });
  }

  return processChunk();
})
.catch(err => {
  console.error('❌ Request failed:', err.message);
});
