#!/usr/bin/env node

/**
 * VSCode Copilot Reasoning Content Format Test
 * 
 * This script tests different formats of reasoning_content to understand
 * what VSCode Copilot requires to display thinking content properly.
 */

import http from 'http';

const PROXY_URL = 'http://localhost:11434';

console.log('🧪 Testing VSCode Copilot reasoning content formats...\n');

// Test different message formats to understand VSCode requirements
const testFormats = [
  {
    name: 'OpenAI o1-like format',
    messages: [{"role": "user", "content": "What is 2+2? Think step by step."}],
    description: 'Standard OpenAI format with reasoning_content in streaming delta'
  },
  {
    name: 'Simple reasoning request',
    messages: [{"role": "user", "content": "Explain why 1+1=2 with your reasoning visible."}],
    description: 'Request that should trigger reasoning display'
  },
  {
    name: 'Complex reasoning request',
    messages: [{"role": "user", "content": "Solve this step by step: If I have 3 apples and give away 1, then buy 2 more, how many do I have? Show your thinking."}],
    description: 'Multi-step problem to test extended reasoning display'
  }
];

async function testReasoningFormat(testCase) {
  return new Promise((resolve, reject) => {
    console.log(`\n📋 Testing: ${testCase.name}`);
    console.log(`   ${testCase.description}`);
    
    const postData = JSON.stringify({
      model: "Qwen3-4B",
      messages: testCase.messages,
      stream: true,
      temperature: 0.7
    });

    const options = {
      hostname: 'localhost',
      port: 11434,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      console.log(`   Status: ${res.statusCode}`);
      
      let reasoningContentSeen = false;
      let messageContentSeen = false;
      let reasoningChunks = [];
      let messageChunks = [];
      
      res.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        const lines = chunkStr.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices && data.choices[0] && data.choices[0].delta) {
                const delta = data.choices[0].delta;
                
                if (delta.reasoning_content) {
                  if (!reasoningContentSeen) {
                    console.log(`   ✅ Reasoning content detected!`);
                    reasoningContentSeen = true;
                  }
                  reasoningChunks.push(delta.reasoning_content);
                }
                
                if (delta.content) {
                  if (!messageContentSeen) {
                    console.log(`   ✅ Message content detected!`);
                    messageContentSeen = true;
                  }
                  messageChunks.push(delta.content);
                }
              }
            } catch (e) {
              // Ignore JSON parse errors for non-JSON lines
            }
          }
        }
      });
      
      res.on('end', () => {
        console.log(`   📊 Results:`);
        console.log(`      Reasoning chunks: ${reasoningChunks.length}`);
        console.log(`      Message chunks: ${messageChunks.length}`);
        
        if (reasoningChunks.length > 0) {
          const fullReasoning = reasoningChunks.join('');
          console.log(`      Reasoning sample: "${fullReasoning.slice(0, 100)}..."`);
        }
        
        if (messageChunks.length > 0) {
          const fullMessage = messageChunks.join('');
          console.log(`      Message sample: "${fullMessage.slice(0, 100)}..."`);
        }
        
        resolve({
          testCase: testCase.name,
          reasoningContentSeen,
          messageContentSeen,
          reasoningChunks: reasoningChunks.length,
          messageChunks: messageChunks.length,
          fullReasoning: reasoningChunks.join(''),
          fullMessage: messageChunks.join('')
        });
      });
    });

    req.on('error', (err) => {
      console.log(`   ❌ Error: ${err.message}`);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

// Run all tests
async function runAllTests() {
  const results = [];
  
  for (const testCase of testFormats) {
    try {
      const result = await testReasoningFormat(testCase);
      results.push(result);
      
      // Wait a bit between tests to avoid overwhelming the proxy
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`   ❌ Test failed: ${error.message}`);
    }
  }
  
  // Summary
  console.log('\n📊 Test Summary:');
  console.log('================');
  
  for (const result of results) {
    console.log(`${result.testCase}:`);
    console.log(`  Reasoning: ${result.reasoningContentSeen ? '✅' : '❌'} (${result.reasoningChunks} chunks)`);
    console.log(`  Message: ${result.messageContentSeen ? '✅' : '❌'} (${result.messageChunks} chunks)`);
  }
  
  // Check if reasoning content format is correct
  const hasReasoning = results.some(r => r.reasoningContentSeen);
  
  if (hasReasoning) {
    console.log('\n🎉 SUCCESS: Reasoning content is being generated in correct format!');
    console.log('💡 If VSCode Copilot still doesn\'t show reasoning, the issue may be:');
    console.log('   1. VSCode needs to be restarted after proxy configuration');
    console.log('   2. VSCode Copilot may not support reasoning content display yet');
    console.log('   3. The model needs specific metadata or headers');
    console.log('   4. VSCode requires a specific API endpoint configuration');
  } else {
    console.log('\n❌ ISSUE: No reasoning content detected in any test');
    console.log('💡 Check proxy configuration and thinking mode settings');
  }
}

// Start the tests
runAllTests().catch(console.error);
