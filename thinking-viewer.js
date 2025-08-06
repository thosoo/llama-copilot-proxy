#!/usr/bin/env node

/**
 * VSCode Thinking Content Viewer
 * 
 * This tool shows the thinking content that VSCode Copilot receives but doesn't display.
 * It monitors HTTP traffic and displays reasoning content in real-time.
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = 11435; // Different port to avoid conflicts

// Store thinking content
let currentThinking = '';
let thinkingStartTime = null;
let requestCount = 0;

console.log('🧠 VSCode Copilot Thinking Viewer');
console.log('================================');
console.log('');
console.log('This monitors VSCode Copilot requests and shows the thinking content');
console.log('that VSCode receives but doesn\'t display in its UI.');
console.log('');
console.log(`🌐 Configure VSCode Copilot to use: http://localhost:${PORT}`);
console.log('');

// Proxy middleware that intercepts and logs thinking content
const proxyMiddleware = createProxyMiddleware({
  target: 'http://localhost:11434', // Your existing proxy
  changeOrigin: true,
  
  onProxyReq: (proxyReq, req, res) => {
    requestCount++;
    console.log(`\n📤 [${requestCount}] ${req.method} ${req.url}`);
    
    if (req.method === 'POST' && req.url.includes('chat/completions')) {
      console.log('🎯 Chat completion request detected');
    }
  },
  
  onProxyRes: (proxyRes, req, res) => {
    console.log(`📥 [${requestCount}] Response: ${proxyRes.statusCode}`);
    
    // Check if this is a streaming response
    if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
      console.log('🌊 Streaming response detected - monitoring for thinking content...');
      
      let buffer = '';
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      
      res.write = function(chunk) {
        const data = chunk.toString();
        buffer += data;
        
        // Look for reasoning content
        if (data.includes('reasoning_content')) {
          if (!thinkingStartTime) {
            thinkingStartTime = new Date();
            console.log('\n🧠 ═══════════════════════════════════════════════════');
            console.log('   💭 MODEL THINKING PROCESS STARTED');
            console.log('   ⏰ Time:', thinkingStartTime.toLocaleTimeString());
            console.log('🧠 ═══════════════════════════════════════════════════');
          }
          
          // Extract reasoning content
          const lines = data.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.slice(6));
                if (json.choices?.[0]?.delta?.reasoning_content) {
                  const thinking = json.choices[0].delta.reasoning_content;
                  console.log('💭', thinking);
                  currentThinking += thinking;
                }
              } catch (e) {
                // Ignore JSON parse errors
              }
            }
          }
        }
        
        // Check for completion
        if (data.includes('[DONE]') || data.includes('"finish_reason":"stop"')) {
          if (thinkingStartTime) {
            const endTime = new Date();
            const duration = endTime - thinkingStartTime;
            
            console.log('🧠 ═══════════════════════════════════════════════════');
            console.log('   ✅ THINKING PROCESS COMPLETED');
            console.log('   ⏱️  Duration:', Math.round(duration / 1000) + 's');
            console.log('   📝 Total content:', currentThinking.length, 'characters');
            console.log('🧠 ═══════════════════════════════════════════════════\n');
            
            thinkingStartTime = null;
            currentThinking = '';
          }
        }
        
        return originalWrite(chunk);
      };
      
      res.end = function(chunk) {
        if (chunk) {
          res.write(chunk);
        }
        return originalEnd();
      };
    }
  },
  
  onError: (err, req, res) => {
    console.error('❌ Proxy error:', err.message);
    res.status(500).send('Proxy Error');
  }
});

// Use the proxy middleware for all requests
app.use('/', proxyMiddleware);

app.listen(PORT, () => {
  console.log(`🚀 Thinking viewer running on port ${PORT}`);
  console.log('');
  console.log('📋 Next steps:');
  console.log('1. In VSCode, open Copilot settings');
  console.log('2. Set the API base URL to: http://localhost:11435');
  console.log('3. Use Copilot normally - thinking content will appear here!');
  console.log('');
  console.log('💡 The thinking content will be displayed in this terminal');
  console.log('   even though VSCode doesn\'t show it in its UI yet.');
  console.log('');
});
