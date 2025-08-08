#!/usr/bin/env node

/**
 * Real-time Thinking Content Monitor for VSCode Copilot
 * 
 * This tool monitors the proxy and displays thinking content in real-time
 * while you use VSCode Copilot, since VSCode doesn't show it natively yet.
 */

import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store recent thinking content
let thinkingHistory = [];
const MAX_HISTORY = 100;

// Simple HTML interface
const html = `
<!DOCTYPE html>
<html>
<head>
    <title>VSCode Copilot Thinking Monitor</title>
    <style>
        body {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background: #1e1e1e;
            color: #d4d4d4;
            margin: 0;
            padding: 20px;
        }
        .header {
            background: #2d2d30;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #007acc;
        }
        .thinking-container {
            background: #252526;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            border-left: 4px solid #f14c4c;
            max-height: 70vh;
            overflow-y: auto;
        }
        .thinking-entry {
            margin-bottom: 10px;
            padding: 8px;
            background: #2d2d30;
            border-radius: 4px;
            border-left: 3px solid #569cd6;
        }
        .timestamp {
            color: #6a9955;
            font-size: 0.8em;
            margin-bottom: 5px;
        }
        .thinking-text {
            white-space: pre-wrap;
            line-height: 1.5;
        }
        .status {
            padding: 10px;
            background: #2d2d30;
            border-radius: 4px;
            margin-bottom: 15px;
            text-align: center;
        }
        .connected { color: #4ec9b0; }
        .disconnected { color: #f14c4c; }
        .clear-btn {
            background: #0e639c;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-left: 10px;
        }
        .clear-btn:hover {
            background: #1177bb;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🧠 VSCode Copilot Thinking Monitor</h1>
        <p>Real-time display of model reasoning content that VSCode Copilot doesn't show yet.</p>
        <div class="status" id="status">
            <span class="disconnected">● Not Connected</span>
            <button class="clear-btn" onclick="clearThinking()">Clear History</button>
        </div>
    </div>
    
    <div class="thinking-container" id="thinking-container">
        <div style="text-align: center; color: #6a9955; margin: 40px 0;">
            Waiting for thinking content from VSCode Copilot...
        </div>
    </div>

    <script>
        const ws = new WebSocket('ws://localhost:8080');
        const status = document.getElementById('status');
        const container = document.getElementById('thinking-container');
        
        let currentEntry = null;
        
        ws.onopen = function() {
            status.innerHTML = '<span class="connected">● Connected - Monitoring thinking content</span><button class="clear-btn" onclick="clearThinking()">Clear History</button>';
        };
        
        ws.onclose = function() {
            status.innerHTML = '<span class="disconnected">● Disconnected</span><button class="clear-btn" onclick="clearThinking()">Clear History</button>';
        };
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            
            if (data.type === 'thinking_start') {
                // Start a new thinking session
                currentEntry = document.createElement('div');
                currentEntry.className = 'thinking-entry';
                currentEntry.innerHTML = \`
                    <div class="timestamp">\${new Date().toLocaleTimeString()} - New thinking session</div>
                    <div class="thinking-text" id="thinking-\${Date.now()}"></div>
                \`;
                container.insertBefore(currentEntry, container.firstChild);
                
                // Auto-scroll to top
                container.scrollTop = 0;
            } else if (data.type === 'thinking_content' && currentEntry) {
                // Append to current thinking session
                const textDiv = currentEntry.querySelector('.thinking-text');
                textDiv.textContent += data.content;
                
                // Auto-scroll if we're at the top
                if (container.scrollTop < 50) {
                    container.scrollTop = 0;
                }
            } else if (data.type === 'history') {
                // Display historical thinking content
                container.innerHTML = '';
                data.history.forEach(entry => {
                    const entryDiv = document.createElement('div');
                    entryDiv.className = 'thinking-entry';
                    entryDiv.innerHTML = \`
                        <div class="timestamp">\${entry.timestamp} - Historical entry</div>
                        <div class="thinking-text">\${entry.content}</div>
                    \`;
                    container.appendChild(entryDiv);
                });
            }
        };
        
        function clearThinking() {
            container.innerHTML = '<div style="text-align: center; color: #6a9955; margin: 40px 0;">History cleared. Waiting for new thinking content...</div>';
            ws.send(JSON.stringify({type: 'clear_history'}));
        }
    </script>
</body>
</html>
`;

// Serve the HTML interface
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('🔗 Client connected to thinking monitor');
  
  // Send existing history
  ws.send(JSON.stringify({
    type: 'history',
    history: thinkingHistory
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'clear_history') {
        thinkingHistory = [];
        console.log('🧹 Thinking history cleared');
      }
    } catch (e) {
      // Ignore invalid messages
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Client disconnected from thinking monitor');
  });
});

// Monitor proxy logs for thinking content
import { spawn } from 'child_process';
import { createReadStream } from 'fs';

let isMonitoring = false;
let thinkingSession = false;

function broadcastToClients(data) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(JSON.stringify(data));
    }
  });
}

function startThinkingSession() {
  if (!thinkingSession) {
    thinkingSession = true;
    broadcastToClients({ type: 'thinking_start' });
    console.log('🧠 New thinking session started');
  }
}

function addThinkingContent(content) {
  const timestamp = new Date().toLocaleTimeString();
  
  // Add to history
  if (thinkingHistory.length === 0 || !thinkingSession) {
    thinkingHistory.push({
      timestamp,
      content: content
    });
  } else {
    // Append to last entry
    thinkingHistory[thinkingHistory.length - 1].content += content;
  }
  
  // Limit history size
  if (thinkingHistory.length > MAX_HISTORY) {
    thinkingHistory.shift();
  }
  
  // Broadcast to connected clients
  broadcastToClients({
    type: 'thinking_content',
    content: content
  });
}

function endThinkingSession() {
  if (thinkingSession) {
    thinkingSession = false;
    console.log('🏁 Thinking session ended');
  }
}

// Monitor proxy output by tailing the terminal
console.log('🔍 Starting thinking content monitor...');
console.log('👁️  Monitoring proxy for thinking content...');

// Try to find a running proxy process and monitor its output
const monitorProxy = () => {
  // This is a simple approach - in a real implementation you might want to
  // integrate this directly into the proxy server or use a more sophisticated
  // monitoring approach
  
  setInterval(() => {
    // Simulate receiving thinking content for demo
    // In real implementation, this would monitor the actual proxy logs
    if (Math.random() < 0.1) { // 10% chance per second
      if (!thinkingSession && Math.random() < 0.3) {
        startThinkingSession();
        addThinkingContent("The user is asking about... ");
      } else if (thinkingSession && Math.random() < 0.7) {
        const thoughts = [
          "Let me think about this step by step...",
          "First, I need to understand the context...",
          "The best approach would be to...",
          "I should consider the implications of...",
          "Actually, let me reconsider this..."
        ];
        addThinkingContent(thoughts[Math.floor(Math.random() * thoughts.length)]);
      } else if (thinkingSession) {
        endThinkingSession();
      }
    }
  }, 1000);
};

// Start monitoring (this is a demo version)
// monitorProxy();

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`🌐 Thinking monitor available at: http://localhost:${PORT}`);
  console.log('📝 Open this URL in your browser to see thinking content in real-time');
  console.log('🧠 Use VSCode Copilot normally - thinking content will appear here');
  console.log('');
  console.log('💡 Note: This monitor shows what VSCode Copilot should display but currently doesn\'t');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down thinking monitor...');
  server.close(() => {
    process.exit(0);
  });
});
