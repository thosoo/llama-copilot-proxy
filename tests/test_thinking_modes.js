#!/usr/bin/env node

import http from 'http';

const MODES = ['vscode', 'events', 'both', 'off'];
const testPrompt = "What is 2+2? Please think step by step about this calculation.";

async function testThinkingMode(mode) {
  return new Promise((resolve, reject) => {
    console.log(`\n🧪 Testing THINKING_MODE=${mode}`);
    console.log('═'.repeat(50));
    
    const requestBody = JSON.stringify({
      model: "Qwen3-4B",
      messages: [{ role: "user", content: testPrompt }],
      stream: true
    });

    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'X-Thinking-Mode': mode // Custom header to potentially set mode per request
      }
    };

    const req = http.request(options, (res) => {
      let thinkingEvents = 0;
      let reasoningContentChunks = 0;
      let messageContentChunks = 0;
      let totalData = '';
      
      res.on('data', (chunk) => {
        const data = chunk.toString();
        totalData += data;
        
        // Count different types of content
        if (data.includes('event: thinking')) {
          thinkingEvents++;
        }
        if (data.includes('"reasoning_content"')) {
          reasoningContentChunks++;
        }
        if (data.includes('"content"') && !data.includes('"reasoning_content"')) {
          messageContentChunks++;
        }
      });
      
      res.on('end', () => {
        console.log(`✅ Results for ${mode} mode:`);
        console.log(`   - Thinking events: ${thinkingEvents}`);
        console.log(`   - Reasoning content chunks: ${reasoningContentChunks}`);
        console.log(`   - Message content chunks: ${messageContentChunks}`);
        console.log(`   - Total response size: ${totalData.length} chars`);
        
        resolve({
          mode,
          thinkingEvents,
          reasoningContentChunks,
          messageContentChunks,
          totalSize: totalData.length
        });
      });
      
      res.on('error', (err) => {
        console.error(`❌ Error in ${mode} mode:`, err.message);
        reject(err);
      });
    });
    
    req.on('error', (err) => {
      console.error(`❌ Request error in ${mode} mode:`, err.message);
      reject(err);
    });
    
    req.setTimeout(30000, () => {
      console.log(`⏰ Timeout in ${mode} mode`);
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}

async function runAllTests() {
  console.log('🧠 Testing Different Thinking Modes');
  console.log('═'.repeat(60));
  console.log(`Prompt: "${testPrompt}"`);
  
  const results = [];
  
  for (const mode of MODES) {
    try {
      const result = await testThinkingMode(mode);
      results.push(result);
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to test ${mode} mode:`, error.message);
    }
  }
  
  // Summary
  console.log('\n📊 SUMMARY OF ALL MODES');
  console.log('═'.repeat(60));
  console.log('Mode      | Thinking | Reasoning | Message | Size');
  console.log('----------|----------|-----------|---------|--------');
  
  results.forEach(result => {
    const { mode, thinkingEvents, reasoningContentChunks, messageContentChunks, totalSize } = result;
    console.log(`${mode.padEnd(9)} | ${String(thinkingEvents).padStart(8)} | ${String(reasoningContentChunks).padStart(9)} | ${String(messageContentChunks).padStart(7)} | ${String(totalSize).padStart(6)}`);
  });
  
  console.log('\n💡 Recommendations:');
  console.log('- Use "vscode" mode for VSCode Copilot (preserves standard reasoning_content)');
  console.log('- Use "events" mode for custom clients that handle thinking events');
  console.log('- Use "both" mode for debugging or clients that need both formats');
  console.log('- Use "off" mode to disable thinking content entirely');
}

runAllTests().catch(console.error);
