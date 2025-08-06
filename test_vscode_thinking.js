#!/usr/bin/env node

import express from 'express';

const app = express();
app.use(express.json());

// Simple test endpoint that mimics how VSCode Copilot might expect thinking content
app.post('/v1/chat/completions', (req, res) => {
  console.log('🧪 Test request received:', JSON.stringify(req.body, null, 2));
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send different formats to see what VSCode expects
  res.write(': heartbeat\n\n');

  // Format 1: Current implementation (event: thinking)
  res.write('event: thinking\n');
  res.write('data: "This is the model thinking..."\n\n');

  // Format 2: Standard data with reasoning_content in delta
  res.write('data: {"choices":[{"delta":{"reasoning_content":"Let me think through this problem step by step..."}}]}\n\n');

  // Format 3: Try with specific event type that VSCode might recognize
  res.write('event: reasoning\n');
  res.write('data: "More thinking content..."\n\n');

  // Format 4: Regular content
  res.write('data: {"choices":[{"delta":{"content":"Here is my response: 2+2=4"}}]}\n\n');

  // End the stream
  res.write('data: [DONE]\n\n');
  res.end();
});

app.listen(11435, () => {
  console.log('🧪 Test server listening on port 11435');
  console.log('Configure VSCode to use: http://127.0.0.1:11435');
});
