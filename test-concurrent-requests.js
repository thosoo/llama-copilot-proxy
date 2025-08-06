#!/usr/bin/env node

// Test to demonstrate /api/show interference during thinking streams

console.log('🚀 Testing concurrent /api/show interference during thinking...');

async function testConcurrentRequests() {
  console.log('\n📡 Starting concurrent requests...');
  
  // Request 1: Chat completion with thinking
  const chatRequest = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Think step by step about this complex problem: What are the philosophical implications of artificial intelligence consciousness? Provide detailed reasoning."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 500
    })
  });

  // Request 2: /api/show request (simulating VSCode capability check)
  const showRequest = fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf" 
    })
  });

  try {
    console.log('🔥 Making both requests simultaneously...');
    
    // Start both requests at the same time
    const [chatRes, showRes] = await Promise.all([chatRequest, showRequest]);
    
    console.log('✅ Chat response status:', chatRes.status);
    console.log('✅ Show response status:', showRes.status);
    
    // Process the show response
    const showData = await showRes.json();
    console.log('📊 Show response received, model info available');
    
    // Process the chat stream
    if (chatRes.body) {
      const reader = chatRes.body.getReader();
      let chunkCount = 0;
      let thinkingCount = 0;
      let contentCount = 0;
      
      console.log('\n📖 Processing chat stream...');
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('\n🏁 Stream completed');
          console.log('📊 Final stats:');
          console.log('   Total chunks:', chunkCount);
          console.log('   Thinking chunks:', thinkingCount);
          console.log('   Content chunks:', contentCount);
          break;
        }

        chunkCount++;
        const chunk = new TextDecoder().decode(value);
        
        if (chunk.includes('reasoning_content')) {
          thinkingCount++;
          process.stdout.write('🧠');
        }
        
        if (chunk.includes('"content"') && !chunk.includes('reasoning_content')) {
          contentCount++;
          process.stdout.write('📝');
        }
      }
    }
    
    console.log('\n✅ Test completed successfully');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

// Run the test
testConcurrentRequests();
