# DeepSeek Thinking Mode Support

This proxy now supports **DeepSeek Thinking Mode** for Qwen3 and other compatible models, allowing Copilot to see the model's internal reasoning process.

## Features

- ✅ **Automatic Thinking Extraction**: Captures `reasoning_content` from llama-server responses
- ✅ **SSE Thinking Events**: Emits thinking content as `event: thinking` in the stream
- ✅ **Copilot Integration**: Compatible with VS Code Copilot for enhanced debugging and reasoning visibility
- ✅ **Real-time Streaming**: Shows thinking content as it's generated, not just the final result

## Setup

1. **Start llama-server with thinking mode enabled**:
   ```bash
   llama-server -hf Qwen/Qwen3-4B-GGUF:Q8_0 --reasoning-format deepseek --port 11433
   ```

2. **Start the proxy**:
   ```bash
   node proxy-server.js
   ```

3. **Configure VS Code Copilot**:
   ```json
   "github.copilot.advanced.debug.overrideEngine": "http://127.0.0.1:11434"
   ```

## How It Works

When a Qwen3 "Thinking" model generates a response with `--reasoning-format deepseek`:

1. **Upstream emits**: `reasoning_content` chunks containing the model's internal reasoning
2. **Proxy captures**: These chunks and emits them as `event: thinking` SSE events
3. **Copilot receives**: Both the thinking process AND the final answer in real-time

## Example Output

```
event: thinking
data: "Okay, the user wants me to explain how to..."

data: {"choices":[{"delta":{"content":"Here's how to do it:"}}]}

event: thinking  
data: "I should provide a clear example..."

data: {"choices":[{"delta":{"content":" First, you need to..."}}]}
```

## Supported Models

- Qwen3-235B-A22B-Thinking-2507
- Any Qwen3 "Thinking" variant
- Models loaded with `--reasoning-format deepseek` or `--reasoning-format qwen3`

## Benefits

- **Debugging**: See exactly how the model reasoned through complex problems
- **Learning**: Understand the model's thought process for educational purposes  
- **Quality**: Assess the depth and quality of the model's reasoning
- **Transparency**: Full visibility into AI decision-making processes
