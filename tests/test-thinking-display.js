#!/usr/bin/env node

/**
 * Test VSCode Thinking Content Display
 * 
 * This script tests the thinking content display by sending a request
 * that should trigger reasoning output from the model.
 */

import fetch from 'node-fetch';

const TEST_URL = 'http://localhost:11434/v1/chat/completions';

console.log('🧪 Testing VSCode Thinking Content Display');
console.log('==========================================');
console.log('');
console.log('This test will send a prompt that should trigger thinking');
console.log('and demonstrate that the content appears in the proxy logs');
console.log('even though VSCode doesn\'t show it.');
console.log('');

const testPayload = {
  model: "deepseek-r1:1.5b",
  messages: [
    {
      role: "user", 
      content: "Think step by step: What is the capital of France and why is it important? Please reason through this carefully."
    }
  ],
  stream: true,
  temperature: 0.7
};

console.log('📤 Sending test request...');
console.log('🎯 Look for thinking content in the proxy logs below:');
console.log('');

try {
  const response = await fetch(TEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(testPayload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  console.log('✅ Request sent successfully');
  console.log('📡 Streaming response...');
  console.log('');
  console.log('💭 Thinking content (if any) should appear in the proxy logs above');
  console.log('');

  let thinkingFound = false;
  let responseContent = '';

  const reader = response.body;
  reader.on('data', (chunk) => {
    const data = chunk.toString();
    
    // Check for reasoning content
    if (data.includes('reasoning_content')) {
      thinkingFound = true;
      console.log('🧠 THINKING CONTENT DETECTED in response!');
    }
    
    // Extract actual content
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.choices?.[0]?.delta?.content) {
            responseContent += json.choices[0].delta.content;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  });

  reader.on('end', () => {
    console.log('');
    console.log('📝 Response completed');
    console.log('💬 Final response:', responseContent.slice(0, 100) + '...');
    console.log('');
    
    if (thinkingFound) {
      console.log('🎉 SUCCESS: Thinking content was detected!');
      console.log('💡 Check the proxy logs above to see the thinking process');
    } else {
      console.log('⚠️  No thinking content detected in this response');
      console.log('   Try a more complex question or check model configuration');
    }
    
    process.exit(0);
  });

  reader.on('error', (err) => {
    console.error('❌ Stream error:', err);
    process.exit(1);
  });

} catch (error) {
  console.error('❌ Request failed:', error.message);
  console.log('');
  console.log('🔍 Troubleshooting:');
  console.log('- Make sure the proxy is running on port 11434');
  console.log('- Check that deepseek-r1:1.5b model is available');
  console.log('- Verify the llama-server is running on port 11433');
  process.exit(1);
}
