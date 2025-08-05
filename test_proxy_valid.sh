#!/bin/bash
# Updated test for supported model with valid parameters

PROXY_URL="http://127.0.0.1:11434/v1/chat/completions"

curl -s -X POST "$PROXY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen-7B-Chat",
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_current_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city and country/state, e.g. San Francisco, CA or Paris, France"
            }
          },
          "required": ["location"]
        }
      }
    }]
  }' > supported_model_response_valid.json

echo "Supported model with valid parameters test complete."
