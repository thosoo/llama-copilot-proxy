#!/bin/bash

# Test script to simulate a large prompt that would cause timeout issues

# Create a large prompt (simulating multiple files/long conversation)
LARGE_PROMPT=""
for i in {1..50}; do
  LARGE_PROMPT="$LARGE_PROMPT This is line $i of a very long conversation context that simulates multiple files being included in a Copilot request. "
done

# Add more context to really stress test
LARGE_PROMPT="$LARGE_PROMPT Here is a massive codebase context: "
for i in {1..100}; do
  LARGE_PROMPT="$LARGE_PROMPT function example${i}() { console.log('This is example function ${i}'); return ${i} * 2; } "
done

LARGE_PROMPT="$LARGE_PROMPT Now please help me debug this code and explain what might be wrong."

echo "Testing large prompt (~$(echo "$LARGE_PROMPT" | wc -c) characters)..."

# Test with timeout to see if proxy handles it better
timeout 30s curl -N -H "Content-Type: application/json" -X POST http://127.0.0.1:11434/v1/chat/completions \
  -d "{\"model\":\"Qwen3-4B\",\"messages\":[{\"role\":\"user\",\"content\":\"$LARGE_PROMPT\"}],\"stream\":true}" \
  | head -10

echo -e "\n\nTest completed."
