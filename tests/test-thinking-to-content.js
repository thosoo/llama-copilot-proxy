#!/usr/bin/env node

/**
 * Test Thinking Content Routing to Normal Output
 * 
 * This script tests the new 'content' mode that routes thinking content
 * to the normal content stream so VSCode Copilot will display it.
 */

import fetch from 'node-fetch';

const TEST_URL = 'http://localhost:11434/v1/chat/completions';

console.log('🧪 Testing Thinking Content → Normal Output Routing');
console.log('==================================================');
console.log('');
console.log('This test verifies that thinking content can be routed to the normal');
console.log('content stream so VSCode Copilot will display it directly in the UI.');
console.log('');

const testPayload = {
  model: "deepseek-r1:1.5b",
  messages: [
    {
      role: "user", 
      content: "Think step by step: How do you make a peanut butter sandwich? Please reason through each step carefully."
    }
  ],
  stream: true,
  temperature: 0.7
};

console.log('📤 Sending test request with thinking → content routing...');
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

  let thinkingInContent = false;
  let regularContent = false;
  let responseContent = '';
  let thinkingContent = '';

  const reader = response.body;
  reader.on('data', (chunk) => {
    const data = chunk.toString();
    
    // Parse each SSE data line
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          
          // Check for content (which now includes thinking in 'content' mode)
          if (json.choices?.[0]?.delta?.content) {
            const content = json.choices[0].delta.content;
            responseContent += content;
            
            // Check if this content contains thinking (💭 prefix)
            if (content.includes('💭')) {
              thinkingInContent = true;
              thinkingContent += content;
              console.log('🧠 THINKING ROUTED TO CONTENT:', content.trim());
            } else {
              regularContent = true;
              console.log('💬 REGULAR CONTENT:', content.trim());
            }
          }
          
          // Check for reasoning_content (should be absent in 'content' mode)
          if (json.choices?.[0]?.delta?.reasoning_content) {
            console.log('⚠️  UNEXPECTED: Still found reasoning_content field!');
          }
          
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  });

  reader.on('end', () => {
    console.log('');
    console.log('📝 Response Analysis:');
    console.log('====================');
    console.log(`💭 Thinking content found in content stream: ${thinkingInContent ? '✅ YES' : '❌ NO'}`);
    console.log(`💬 Regular content found: ${regularContent ? '✅ YES' : '❌ NO'}`);
    console.log(`📊 Total content length: ${responseContent.length} characters`);
    console.log(`🧠 Thinking content length: ${thinkingContent.length} characters`);
    console.log('');
    
    if (thinkingInContent) {
      console.log('🎉 SUCCESS: Thinking content is now routed to normal content stream!');
      console.log('💡 This means VSCode Copilot will display the thinking process directly in the UI');
      console.log('');
      console.log('🔧 To use this mode with VSCode Copilot:');
      console.log('   1. Restart proxy: THINKING_MODE=content node proxy-server.js');
      console.log('   2. Use VSCode Copilot normally');
      console.log('   3. See thinking content appear directly in VSCode!');
    } else {
      console.log('❌ No thinking content found in content stream');
      console.log('💡 Make sure the proxy is running with THINKING_MODE=content');
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
  console.log('- Make sure the proxy is running: THINKING_MODE=content node proxy-server.js');
  console.log('- Check that deepseek-r1:1.5b model is available');
  console.log('- Verify the llama-server is running on port 11433');
  process.exit(1);
}
