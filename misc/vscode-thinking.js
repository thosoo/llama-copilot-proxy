#!/usr/bin/env node

/**
 * VSCode Thinking Display - Simple Solution
 * 
 * Monitors the proxy server's reasoning content and displays it in real-time
 * in the terminal while you use VSCode Copilot.
 */

import { spawn } from 'child_process';

console.log('🧠 VSCode Copilot Thinking Monitor');
console.log('==================================');
console.log('');
console.log('This tool displays the reasoning content that VSCode Copilot receives');
console.log('but doesn\'t show in its UI yet. Use VSCode Copilot normally and see');
console.log('the thinking process here in real-time.');
console.log('');
console.log('💡 Keep this terminal open while using VSCode Copilot');
console.log('');

// Start the proxy with thinking debug enabled
console.log('🚀 Starting proxy server with thinking display...');
console.log('');

const env = { 
  ...process.env, 
  THINKING_MODE: 'both',
  THINKING_DEBUG: 'true',
  FORCE_COLOR: '1'
};

const proxy = spawn('node', ['proxy-server.js'], {
  env,
  stdio: ['inherit', 'pipe', 'pipe']
});

let currentThinking = '';
let inThinkingBlock = false;
let thinkingStartTime = null;

// Parse proxy output to extract and highlight thinking content
proxy.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Regular proxy output - display normally
  process.stdout.write(output);
  
  // Look for reasoning content in the output
  if (output.includes('"reasoning_content"')) {
    if (!inThinkingBlock) {
      inThinkingBlock = true;
      thinkingStartTime = new Date();
      console.log('\n🧠 ═══════════════════════════════════════════════════');
      console.log('   💭 MODEL THINKING PROCESS STARTED');
      console.log('   ⏰ Time:', thinkingStartTime.toLocaleTimeString());
      console.log('🧠 ═══════════════════════════════════════════════════');
    }
  }
  
  // Extract reasoning content from JSON
  const reasoningMatch = output.match(/"reasoning_content":\s*"([^"\\]*(\\.[^"\\]*)*)"/g);
  if (reasoningMatch) {
    reasoningMatch.forEach(match => {
      const content = match.match(/"reasoning_content":\s*"([^"\\]*(\\.[^"\\]*)*)"/);
      if (content && content[1]) {
        // Decode escaped characters
        const decodedContent = content[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        
        console.log('💭', decodedContent);
        currentThinking += decodedContent;
      }
    });
  }
  
  // Check for end of thinking (when response is complete)
  if (inThinkingBlock && (output.includes('"finish_reason":"stop"') || output.includes('data: [DONE]'))) {
    const endTime = new Date();
    const duration = endTime - thinkingStartTime;
    
    console.log('🧠 ═══════════════════════════════════════════════════');
    console.log('   ✅ THINKING PROCESS COMPLETED');
    console.log('   ⏱️  Duration:', Math.round(duration / 1000) + 's');
    console.log('   📝 Total content:', currentThinking.length, 'characters');
    console.log('🧠 ═══════════════════════════════════════════════════\n');
    
    inThinkingBlock = false;
    currentThinking = '';
    thinkingStartTime = null;
  }
});

proxy.stderr.on('data', (data) => {
  process.stderr.write(data);
});

proxy.on('close', (code) => {
  console.log(`\n🛑 Proxy server exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down thinking monitor...');
  proxy.kill('SIGINT');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

console.log('🎯 Ready! Use VSCode Copilot and watch the thinking process appear below:');
console.log('');
