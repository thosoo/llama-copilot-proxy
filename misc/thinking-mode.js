#!/usr/bin/env node

/**
 * VSCode Copilot Thinking Mode Switcher
 * 
 * Easy way to switch between different thinking content display modes
 */

import { spawn } from 'child_process';

const modes = {
  'content': {
    description: '🎯 Route thinking to normal content (VSCode displays it!)',
    env: { THINKING_MODE: 'content', THINKING_DEBUG: 'true' }
  },
  'vscode': {
    description: '📱 Standard reasoning_content for VSCode (hidden in UI)',
    env: { THINKING_MODE: 'vscode', THINKING_DEBUG: 'true' }
  },
  'both': {
    description: '🔄 Both content stream and events',
    env: { THINKING_MODE: 'both', THINKING_DEBUG: 'true' }
  },
  'events': {
    description: '📡 Custom SSE events only',
    env: { THINKING_MODE: 'events', THINKING_DEBUG: 'true' }
  },
  'off': {
    description: '🚫 Disable thinking content entirely',
    env: { THINKING_MODE: 'off', THINKING_DEBUG: 'false' }
  }
};

const args = process.argv.slice(2);
const selectedMode = args[0];

console.log('🧠 VSCode Copilot Thinking Mode Switcher');
console.log('========================================');
console.log('');

if (!selectedMode || !modes[selectedMode]) {
  console.log('Available modes:');
  console.log('');
  for (const [mode, config] of Object.entries(modes)) {
    console.log(`  ${mode}: ${config.description}`);
  }
  console.log('');
  console.log('Usage: node thinking-mode.js <mode>');
  console.log('');
  console.log('Examples:');
  console.log('  node thinking-mode.js content   # 🎯 Best for VSCode display');
  console.log('  node thinking-mode.js vscode    # 📱 Standard mode');
  console.log('  node thinking-mode.js off       # 🚫 Disable thinking');
  console.log('');
  process.exit(1);
}

const modeConfig = modes[selectedMode];
console.log(`🚀 Starting proxy in '${selectedMode}' mode:`);
console.log(`   ${modeConfig.description}`);
console.log('');

// Kill existing proxy
try {
  const { execSync } = await import('child_process');
  execSync('pkill -f proxy-server.js', { stdio: 'ignore' });
  console.log('🛑 Stopped existing proxy');
} catch (e) {
  // No existing proxy to kill
}

// Start proxy with selected mode
const proxy = spawn('node', ['proxy-server.js'], {
  env: { 
    ...process.env, 
    ...modeConfig.env
  },
  stdio: 'inherit'
});

proxy.on('error', (err) => {
  console.error('❌ Failed to start proxy:', err.message);
  process.exit(1);
});

proxy.on('exit', (code) => {
  console.log(`\n🛑 Proxy exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Stopping proxy...');
  proxy.kill('SIGINT');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
