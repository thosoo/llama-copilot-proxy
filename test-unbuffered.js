#!/usr/bin/env node

/**
 * Simple Unbuffered Thinking Test
 */

import fetch from 'node-fetch';

const testPayload = {
  model: "deepseek-r1:1.5b",
  messages: [
    {
      role: "user", 
      content: "Think step by step: What is 5 + 3?"
    }
  ],
  stream: true,
  temperature: 0.7
};

console.log('🧪 Testing Unbuffered Thinking Content');
console.log('====================================');
console.log('');

try {
  const response = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testPayload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  console.log('📡 Streaming response:');
  console.log('');

  let contentPieces = [];
  
  response.body.on('data', (chunk) => {
    const data = chunk.toString();
    const lines = data.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.choices?.[0]?.delta?.content) {
            const content = json.choices[0].delta.content;
            contentPieces.push(content);
            process.stdout.write(content);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  });

  response.body.on('end', () => {
    console.log('\n\n📝 Analysis:');
    console.log('=============');
    
    const fullContent = contentPieces.join('');
    const thinkingPrefixCount = (fullContent.match(/💭/g) || []).length;
    
    console.log(`💭 Thinking prefixes found: ${thinkingPrefixCount}`);
    console.log(`📊 Total content length: ${fullContent.length} characters`);
    
    if (thinkingPrefixCount === 1) {
      console.log('✅ SUCCESS: Only one 💭 prefix (unbuffered working correctly)');
    } else if (thinkingPrefixCount > 1) {
      console.log('⚠️  ISSUE: Multiple 💭 prefixes found (still choppy)');
    } else {
      console.log('❌ No thinking content found');
    }
    
    process.exit(0);
  });

  response.body.on('error', (err) => {
    console.error('❌ Stream error:', err);
    process.exit(1);
  });

} catch (error) {
  console.error('❌ Request failed:', error.message);
  process.exit(1);
}
