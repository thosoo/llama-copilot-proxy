#!/usr/bin/env node

/**
 * Test Tool + Thinking Combination
 * 
 * This script tests if reasoning content works when tools are involved
 */

import http from 'http';

const PROXY_URL = 'http://localhost:11434';

console.log('🧪 Testing tool request with thinking content...\n');

// Test request with tools and thinking
const testRequest = {
  model: "Qwen3-4B",
  messages: [
    {
      role: "user", 
      content: "What is 2+2? Think step by step and show your reasoning. If you need to use tools, use them."
    }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "calculate",
        description: "Perform basic arithmetic calculations",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "The mathematical expression to evaluate"
            }
          },
          required: ["expression"]
        }
      }
    }
  ],
  stream: true,
  temperature: 0.7
};

const postData = JSON.stringify(testRequest);

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

console.log(`📤 Sending tool request...`);
console.log(`   Tools: ${testRequest.tools.length}`);
console.log(`   Message: "${testRequest.messages[0].content}"`);

const req = http.request(options, (res) => {
  console.log(`📥 Response status: ${res.statusCode}`);
  
  let reasoningContentSeen = false;
  let messageContentSeen = false;
  let toolCallsSeen = false;
  let reasoningChunks = [];
  let messageChunks = [];
  let toolCalls = [];
  
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
            
            if (delta.tool_calls) {
              if (!toolCallsSeen) {
                console.log(`   ✅ Tool calls detected!`);
                toolCallsSeen = true;
              }
              toolCalls.push(delta.tool_calls);
            }
          }
        } catch (e) {
          // Ignore JSON parse errors for non-JSON lines
        }
      } else if (line.startsWith('event: thinking')) {
        console.log(`   ✅ Custom thinking event detected!`);
      }
    }
  });
  
  res.on('end', () => {
    console.log(`\n📊 Test Results:`);
    console.log(`   Reasoning chunks: ${reasoningChunks.length}`);
    console.log(`   Message chunks: ${messageChunks.length}`);
    console.log(`   Tool calls: ${toolCalls.length}`);
    
    if (reasoningChunks.length > 0) {
      const fullReasoning = reasoningChunks.join('');
      console.log(`   Reasoning sample: "${fullReasoning.slice(0, 100)}..."`);
    }
    
    if (messageChunks.length > 0) {
      const fullMessage = messageChunks.join('');
      console.log(`   Message sample: "${fullMessage.slice(0, 100)}..."`);
    }
    
    console.log(`\n🎯 Summary:`);
    console.log(`   Reasoning with tools: ${reasoningContentSeen ? '✅ Working' : '❌ Not working'}`);
    console.log(`   Message content: ${messageContentSeen ? '✅ Working' : '❌ Not working'}`);
    console.log(`   Tool calls: ${toolCallsSeen ? '✅ Working' : '❌ Not working'}`);
    
    if (!reasoningContentSeen) {
      console.log(`\n⚠️  Issue: Reasoning content not detected when tools are present`);
    } else {
      console.log(`\n🎉 Success: Reasoning content works with tools!`);
    }
  });
});

req.on('error', (err) => {
  console.log(`❌ Error: ${err.message}`);
});

req.write(postData);
req.end();
