#!/bin/bash
# Test proxy with supported and unsupported models

set -e

PROXY_URL="http://127.0.0.1:11434/v1/chat/completions"

# Supported model (Qwen)
curl -s -X POST "$PROXY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen-7B-Chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "tools": [{"type": "function", "function": {"name": "getWeather", "description": "Get weather info"}}]
  }' > supported_model_response.json

echo "Supported model test complete."

# Unsupported model (Llama)
curl -s -X POST "$PROXY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Llama-2-7B",
    "messages": [{"role": "user", "content": "Hello"}],
    "tools": [{"type": "function", "function": {"name": "getWeather", "description": "Get weather info"}}]
  }' > unsupported_model_response.json

echo "Unsupported model test complete."

# Edge case: Empty tools array
curl -s -X POST "$PROXY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Llama-2-7B",
    "messages": [{"role": "user", "content": "Hello"}],
    "tools": []
  }' > empty_tools_response.json

echo "Empty tools array test complete."

# Edge case: Malformed tools property
curl -s -X POST "$PROXY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Llama-2-7B",
    "messages": [{"role": "user", "content": "Hello"}],
    "tools": "not-an-array"
  }' > malformed_tools_response.json

echo "Malformed tools property test complete."
