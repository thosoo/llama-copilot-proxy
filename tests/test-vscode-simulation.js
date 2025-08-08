#!/usr/bin/env node

// Test the complete fix - simulating real VS Code behavior

console.log('🎯 Simulating Real VS Code Behavior...');

async function simulateVSCodeScenario() {
  console.log('\n📡 Starting chat completion stream (like VS Code Copilot)...');
  
  // Start a streaming request that will generate thinking content
  const streamPromise = fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.29.1'  // Simulate VS Code
    },
    body: JSON.stringify({
      model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
      messages: [
        {
          role: "user", 
          content: "Explain how neural networks work, thinking through each step carefully."
        }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 200
    })
  });

  // Process the stream like VS Code would
  const streamRes = await streamPromise;
  console.log('✅ Stream started, processing chunks...');
  
  if (streamRes.body) {
    const reader = streamRes.body.getReader();
    let chunks = 0;
    let thinkingChunks = 0;
    let contentChunks = 0;
    let streamBroken = false;
    
    // Simulate VS Code making /api/show requests during the stream
    setTimeout(async () => {
      for (let i = 1; i <= 3; i++) {
        try {
          console.log(`\n🔍 VS Code making /api/show request #${i}...`);
          const start = Date.now();
          
          const showRes = await fetch('http://localhost:11434/api/show', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'User-Agent': 'GitHubCopilotChat/0.29.1'  // Same as VS Code
            },
            body: JSON.stringify({ 
              model: "/home/thaison/.cache/llama.cpp/DavidAU_Qwen3-4B-Q8_0-64k-128k-256k-context-GGUF_Qwen3-4B-Q8_0-128k.gguf"
            })
          });
          
          const duration = Date.now() - start;
          
          if (showRes.ok) {
            const data = await showRes.json();
            console.log(`✅ /api/show #${i}: ${duration}ms, model: ${data.name ? 'present' : 'missing'}`);
            
            if (duration < 50) {
              console.log(`  📋 Fast response - no interference!`);
            }
          } else {
            console.log(`❌ /api/show #${i} failed: ${showRes.status}`);
          }
          
        } catch (error) {
          console.log(`❌ /api/show #${i} error: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between requests
      }
    }, 1000); // Start /api/show requests after 1 second
    
    try {
      while (chunks < 100) { // Process chunks like VS Code would
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('\n🏁 Stream completed naturally');
          break;
        }
        
        chunks++;
        const chunk = new TextDecoder().decode(value);
        
        // Parse for thinking and content like VS Code would
        if (chunk.includes('reasoning_content')) {
          thinkingChunks++;
          process.stdout.write('💭');
        } else if (chunk.includes('"content"')) {
          contentChunks++;
          process.stdout.write('📝');
        }
        
        // Check if stream is still healthy
        if (chunks % 20 === 0) {
          // Simulate VS Code checking stream health
          if (value.length === 0) {
            console.log('\n❌ Stream appears to be broken (empty chunks)');
            streamBroken = true;
            break;
          }
        }
      }
    } catch (error) {
      console.log(`\n❌ Stream error: ${error.message}`);
      streamBroken = true;
    }
    
    reader.releaseLock();
    
    console.log(`\n\n📊 Final Results:`);
    console.log(`   Total chunks: ${chunks}`);
    console.log(`   Thinking chunks: ${thinkingChunks}`);
    console.log(`   Content chunks: ${contentChunks}`);
    console.log(`   Stream broken: ${streamBroken ? 'YES ❌' : 'NO ✅'}`);
    
    if (!streamBroken && thinkingChunks > 0) {
      console.log('\n🎉 SUCCESS: Stream interference fix is working!');
      console.log('✅ VS Code can now receive thinking content without interruption');
    } else if (streamBroken) {
      console.log('\n❌ FAILURE: Stream was still interrupted');
    } else {
      console.log('\n⚠️  WARNING: No thinking content received');
    }
  }
}

simulateVSCodeScenario().catch(console.error);
