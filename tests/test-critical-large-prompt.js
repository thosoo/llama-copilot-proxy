#!/usr/bin/env node

console.log('🚀 Testing LARGE PROMPT scenario (replicating user issue)...');

async function testLargePromptScenario() {
  console.log('\n📡 Creating large prompt similar to user scenario...');
  
  // Create a very large prompt similar to the user's 13,845 tokens
  const largePrompt = `
Please provide an extremely comprehensive analysis covering:

1. Quantum Computing Fundamentals: Start with the mathematical foundations of quantum mechanics as applied to computation, including superposition, entanglement, and quantum interference. Explain the differences between classical bits and quantum bits (qubits), discussing the Bloch sphere representation and how quantum states are manipulated through quantum gates.

2. Quantum Algorithms in Detail: Analyze Shor's algorithm for integer factorization, breaking down each step including the quantum Fourier transform, period finding, and the classical post-processing. Then examine Grover's algorithm for database search, explaining the amplitude amplification technique and its quadratic speedup over classical algorithms.

3. Quantum Error Correction: Discuss the challenges of quantum decoherence and noise, explain quantum error correction codes such as the Shor code and surface codes, and analyze the threshold theorem for fault-tolerant quantum computation.

4. Current Quantum Supremacy: Analyze recent quantum supremacy demonstrations including Google's Sycamore processor and IBM's quantum advantage claims, discussing the specific problems solved and their classical simulation difficulty.

5. Blockchain Technology Deep Dive: Provide comprehensive coverage of consensus mechanisms including Proof of Work, Proof of Stake, and newer alternatives like Proof of History. Analyze the energy consumption implications and scalability trade-offs.

6. Smart Contract Security: Examine common vulnerabilities in smart contracts, including reentrancy attacks, integer overflow, and front-running. Discuss formal verification methods and best practices for secure contract development.

7. Scalability Solutions: Analyze Layer 2 solutions including state channels, sidechains, and rollups (both optimistic and zero-knowledge). Compare their trade-offs in terms of security, decentralization, and throughput.

8. Interoperability Protocols: Examine cross-chain communication protocols, atomic swaps, and bridge mechanisms. Discuss the challenges of maintaining security across different blockchain networks.

9. Regulatory Landscape: Analyze the evolving regulatory frameworks for cryptocurrencies and blockchain technology across different jurisdictions, including compliance challenges and privacy coin regulations.

10. Future Convergence: Explore how quantum computing might impact blockchain security, particularly regarding cryptographic hash functions and digital signatures. Discuss post-quantum cryptography and its implementation challenges.

Please think through each section methodically with detailed reasoning, mathematical explanations where appropriate, and comprehensive analysis of the implications and interconnections between these technologies.
  `.repeat(10); // Multiply to create very large prompt

  try {
    console.log(`📏 Prompt size: ~${Math.ceil(largePrompt.length / 3)} estimated tokens`);
    
    // Start the large prompt stream
    const streamStartTime = Date.now();
    const chatPromise = fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        messages: [
          { 
            role: "user", 
            content: largePrompt
          }
        ],
        stream: true,
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    console.log('⏳ Waiting for prompt processing to begin...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('🔍 Making /api/show requests during prompt processing (critical test)...');
    
    // Make aggressive /api/show requests during what should be long prompt processing
    const showPromises = [];
    for (let i = 1; i <= 10; i++) {
      const showPromise = fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: "/home/thaison/.cache/llama.cpp/Qwen_Qwen3-4B-GGUF_Qwen3-4B-Q8_0.gguf",
        }),
      }).then(response => {
        const responseTime = Date.now();
        console.log(`✅ /api/show #${i}: ${response.status} (${responseTime - streamStartTime}ms since start)`);
        return response.ok;
      }).catch(error => {
        console.log(`❌ /api/show #${i} error:`, error.message);
        return false;
      });
      
      showPromises.push(showPromise);
      await new Promise(resolve => setTimeout(resolve, 500)); // Space them out during processing
    }
    
    // Process the chat stream - this is the critical test
    console.log('📺 Processing stream (should complete despite /api/show requests)...');
    const chatResponse = await chatPromise;
    
    if (!chatResponse.ok) {
      console.error('❌ Chat request failed:', chatResponse.status);
      console.error('🚨 This indicates the /api/show requests caused interference!');
      return;
    }

    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    
    let chunks = 0;
    let thinkingChunks = 0;
    let contentChunks = 0;
    let firstChunkTime = null;
    let completedNormally = false;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          completedNormally = true;
          console.log('🏁 Stream completed normally - NO INTERFERENCE!');
          break;
        }
        
        const chunk = decoder.decode(value);
        chunks++;
        
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          console.log(`⏱️  First response chunk: ${firstChunkTime - streamStartTime}ms after start`);
        }
        
        if (chunk.includes('reasoning_content')) {
          thinkingChunks++;
        } else if (chunk.includes('"content"')) {
          contentChunks++;
        }
        
        if (chunks % 50 === 0) {
          console.log(`📊 Progress: ${chunks} chunks (${thinkingChunks} thinking, ${contentChunks} content)`);
        }
        
        if (chunks > 400) {
          console.log('🛑 Stopping test after 400 chunks (sufficient for validation)');
          break;
        }
      }
    } catch (error) {
      console.error('❌ Stream error (possible interference):', error.message);
    }
    
    // Wait for all /api/show requests
    const showResults = await Promise.all(showPromises);
    const successfulShows = showResults.filter(result => result).length;
    
    const totalTime = Date.now() - streamStartTime;
    
    console.log('\n📊 CRITICAL TEST RESULTS:');
    console.log(`✅ Stream completion: ${completedNormally ? 'NORMAL' : 'INTERRUPTED'}`);
    console.log(`📈 Total chunks: ${chunks} (${thinkingChunks} thinking, ${contentChunks} content)`);
    console.log(`⏱️  Total time: ${Math.round(totalTime/1000)}s`);
    console.log(`⏱️  Time to first chunk: ${firstChunkTime ? firstChunkTime - streamStartTime : 'N/A'}ms`);
    console.log(`✅ /api/show success: ${successfulShows}/${showResults.length}`);
    
    if (completedNormally && chunks > 100 && successfulShows === showResults.length) {
      console.log('\n🎉 CRITICAL SUCCESS: Large prompt + interference test PASSED!');
      console.log('   ✅ Large prompt processed without interruption');
      console.log('   ✅ /api/show requests handled safely via caching/queuing');
      console.log('   ✅ NO early termination like in user\'s llama.cpp logs');
      console.log('   ✅ System is robust against the reported interference issue');
    } else if (!completedNormally) {
      console.log('\n🚨 CRITICAL FAILURE: Stream was interrupted!');
      console.log('   ❌ This replicates the user\'s issue');
      console.log('   ❌ /api/show requests are still causing interference');
    } else {
      console.log('\n⚠️  PARTIAL SUCCESS: Review results for optimization opportunities');
    }
    
  } catch (error) {
    console.error('❌ Critical test failed:', error.message);
    console.error('🚨 This may indicate interference is still occurring');
  }
}

testLargePromptScenario();
