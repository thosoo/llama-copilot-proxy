#!/usr/bin/env node

// Simple configuration helper for thinking modes
const modes = {
  'vscode': {
    description: 'Standard reasoning_content for VSCode Copilot (recommended)',
    env: 'THINKING_MODE=vscode'
  },
  'events': {
    description: 'Custom "event: thinking" SSE events only',
    env: 'THINKING_MODE=events'
  },
  'both': {
    description: 'Both standard reasoning_content and custom events',
    env: 'THINKING_MODE=both'
  },
  'off': {
    description: 'Disable thinking content entirely',
    env: 'THINKING_MODE=off'
  }
};

const mode = process.argv[2];

if (!mode || !modes[mode]) {
  console.log('🧠 Thinking Mode Configuration Helper');
  console.log('═'.repeat(50));
  console.log('\nUsage: node configure_thinking.js <mode>');
  console.log('\nAvailable modes:');
  
  Object.entries(modes).forEach(([key, config]) => {
    console.log(`\n  ${key}:`);
    console.log(`    ${config.description}`);
    console.log(`    Command: ${config.env} node proxy-server.js`);
  });
  
  console.log('\nFor debugging, add THINKING_DEBUG=true:');
  console.log('  THINKING_MODE=vscode THINKING_DEBUG=true node proxy-server.js');
  
  process.exit(1);
}

const config = modes[mode];
console.log(`🧠 Configuring thinking mode: ${mode}`);
console.log(`📝 Description: ${config.description}`);
console.log(`🚀 Command to run:`);
console.log(`   ${config.env} node proxy-server.js`);
console.log('\n💡 For debugging output, add THINKING_DEBUG=true');
