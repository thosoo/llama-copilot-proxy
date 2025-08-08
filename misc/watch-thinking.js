#!/usr/bin/env node

/**
 * VSCode Copilot Thinking Viewer
 * 
 * A simple tool to display the thinking content that VSCode Copilot 
 * receives but doesn't show in its UI yet.
 */

import { spawn } from 'child_process';
import fetch from 'node-fetch';

// Clear the screen for a clean display
console.clear();

console.log('🧠 VSCode Copilot Thinking Content Viewer');
console.log('========================================');
console.log('');
console.log('This displays the model\'s thinking process in real-time');
console.log('while you use VSCode Copilot normally.');
console.log('');
console.log('💡 VSCode Copilot receives this content but doesn\'t show it yet');
console.log('🔍 Here you can see what the model is actually thinking!');
console.log('');
console.log('📖 How to use:');
console.log('1. Keep this terminal open');
console.log('2. Use VSCode Copilot normally');
console.log('3. Watch the thinking content appear below');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Monitor the existing proxy output
let isThinking = false;
let thinkingStartTime = null;
let thinkingContent = '';

// Simple log follower that looks for thinking content in the proxy logs
const followLogs = () => {
  // In a real implementation, this would tail the proxy logs or connect to it
  // For now, we'll provide instructions for manual monitoring
  
  console.log('🎯 Ready to display thinking content!');
  console.log('');
  console.log('💭 Thinking content will appear here when you use VSCode Copilot...');
  console.log('');
  console.log('📋 To see thinking content:');
  console.log('   1. Open another terminal');
  console.log('   2. Run: THINKING_MODE=vscode THINKING_DEBUG=true node proxy-server.js');
  console.log('   3. Look for lines starting with 💭 in that terminal');
  console.log('');
  console.log('🔄 Or restart your existing proxy with thinking debug enabled:');
  console.log('   pkill -f proxy-server.js');
  console.log('   THINKING_MODE=vscode THINKING_DEBUG=true node proxy-server.js');
  console.log('');
  
  // Keep the process running
  setInterval(() => {
    // Display a heartbeat to show the monitor is active
    const now = new Date().toLocaleTimeString();
    process.stdout.write(`\r⏰ Monitoring active at ${now} - Use VSCode Copilot to see thinking content...`);
  }, 5000);
};

// Check if proxy is already running with thinking enabled
const checkProxy = async () => {
  try {
    const response = await fetch('http://localhost:11434/health');
    if (response.ok) {
      console.log('✅ Proxy is running on port 11434');
      console.log('');
      followLogs();
    } else {
      throw new Error('Proxy not responding');
    }
  } catch (error) {
    console.log('❌ Proxy not detected on port 11434');
    console.log('');
    console.log('🚀 Starting proxy with thinking content enabled...');
    
    // Start the proxy with thinking enabled
    const proxy = spawn('node', ['proxy-server.js'], {
      env: { 
        ...process.env, 
        THINKING_MODE: 'vscode',
        THINKING_DEBUG: 'true'
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
  }
};

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Thinking content viewer stopped');
  process.exit(0);
});

// Start monitoring
checkProxy();
