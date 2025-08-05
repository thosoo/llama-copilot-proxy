---
## Version

Current version: **1.0.0**

---
## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/thosoo/llama-copilot-proxy.git
   cd llama-copilot-proxy
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Ignore node_modules in git:**
   The repository includes a `.gitignore` file that excludes `node_modules` from version control.

---

# Copilot BYOK → Ollama → llama-server Integration Proxy

This proxy bridges VS Code Copilot's BYOK (Bring Your Own Key) feature with local llama-server instances, handling API endpoint translation and tool-calling compatibility.

## Quick Start

1. **Start llama-server with tool support:**
   ```bash
   # Install and start llama-server with jinja templates for tool-calling
   llama-server --model /path/to/your/model.gguf --port 11433 --jinja
   ```

2. **Start the proxy:**
   ```bash
   node inject-capabilities.js
   ```

3. **Configure VS Code Copilot:**
   Add to your VS Code settings.json:
   ```json
   {
     "github.copilot.advanced.debug.overrideEngine": "http://127.0.0.1:11434"
   }
   ```

## Problem Solved

VS Code Copilot's BYOK feature expects Ollama-style API endpoints (`/api/chat`), but llama-server uses OpenAI-compatible endpoints (`/v1/chat/completions`). Additionally, tool-calling schemas need specific formatting.

### Key Features

- **Path Rewriting**: `/api/chat` → `/v1/chat/completions`
- **Tool Schema Patching**: Auto-adds missing `parameters` objects to tool definitions
- **Streaming Support**: Maintains proper server-sent events for real-time responses
- **Error Handling**: Graceful handling of connection resets and client disconnects
- **JSON Minification**: Optimizes payload sizes for better performance

## Architecture

```
VS Code Copilot (BYOK) → Proxy (Port 11434) → llama-server (Port 11433)
    /api/chat                                      /v1/chat/completions
```

## Error Handling Improvements

The proxy now gracefully handles:
- Client disconnections (`ECONNRESET`)
- Connection timeouts (`ETIMEDOUT`)
- Broken pipes (`EPIPE`)
- Connection aborts (`ECONNABORTED`)

These are logged as informational messages rather than errors, since they're normal in streaming scenarios.

### Why?
This proxy makes it possible to use local LLM models with VS Code Copilot in agent mode, unlocking advanced automation, tool use, and planning capabilities for your development workflow.


## Quick Start

1. **Start llama.cpp server** (with tools support):
   ```bash
   llama-server --model your-model.gguf --port 11433 --jinja
   ```

2. **Start the proxy**:
   ```bash
   node inject-capabilities.js
   ```
   The proxy will listen on `http://127.0.0.1:11434` and forward to llama.cpp on `http://127.0.0.1:11433`.

3. **Configure VS Code Copilot** to use the proxy:
   
   **Option A: VS Code Settings (Recommended)**
   
   Add to your VS Code `settings.json`:
   ```json
   {
     "github.copilot.advanced": {
       "debug.overrideEngine": "http://127.0.0.1:11434"
     }
   }
   ```
   
   **Option B: Environment Variable**
   
   Set before starting VS Code:
   ```bash
   export COPILOT_OVERRIDE_URL="http://127.0.0.1:11434"
   code
   ```

4. **Verify setup**: Check that VS Code Copilot requests appear in the proxy logs when you use tools.

---

## Copilot BYOK → llama-server Path Rewriting

This proxy automatically rewrites Copilot's hard-coded Ollama-style endpoints to the OpenAI-style endpoints expected by llama-server:

- `POST /api/chat` → `POST /v1/chat/completions`
- `POST /api/generate` → `POST /v1/completions`

This enables seamless interoperability between Copilot Agent Mode and llama-server (Qwen-3, etc.) with tool-calling support (when `--jinja` is enabled).

**No changes are needed in Copilot or llama-server.** Just run the proxy and it will handle all necessary path rewrites and payload forwarding.

---

## Why the Proxy is Required

llama.cpp requires **minified JSON** (no line breaks or extra whitespace) for tool parsing. VS Code Copilot sends **pretty-printed JSON** by default, which causes llama.cpp to fail with errors like:

```
Failed to parse tools: [json.exception.out_of_range.403] key 'parameters' not found
```

Our proxy:
- ✅ Minifies all upstream JSON payloads  
- ✅ Passes through OpenAI function calling schema unchanged
- ✅ Adds tool capabilities to model listings
- ✅ Preserves streaming responses

## Schematic: What VS Code Copilot Sends Into the Proxy

When VS Code Copilot (in agent mode) sends a request to the proxy, the payload typically looks like this (OpenAI function calling schema):

```json
{
  "model": "<model-id>",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "create_file",
        "description": "Create a file in the workspace.",
        "parameters": {
          "type": "object",
          "properties": {
            "filePath": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["filePath", "content"]
        }
      }
    }
    // ...more tools...
  ]
}
```

### Proxy Transformation
The proxy passes through VS Code Copilot's OpenAI function calling schema unchanged to llama.cpp:

```json
{
  "model": "<model-id>",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "create_file",
        "description": "Create a file in the workspace.",
        "parameters": {
          "type": "object",
          "properties": {
            "filePath": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["filePath", "content"]
        }
      }
    }
    // ...more tools...
  ]
}
```

- The original OpenAI-format payload is forwarded directly to llama.cpp's `llama-server` for processing.

**Important:**
- The llama.cpp server must be started with the `--jinja` flag and a compatible chat template for agent mode and tool use. For some models, you may need to specify `--chat-template chatml` or provide a custom template file.
- llama.cpp expects tools in **OpenAI function calling format**: each tool must have `type: "function"` and a nested `function` object containing `name`, `description`, and `parameters`.
- No transformation is performed on the tools - they are passed through exactly as VS Code Copilot sends them.

**References:**
- [llama.cpp Function Calling Documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)
- [Supported Chat Templates](https://github.com/ggml-org/llama.cpp/wiki/Templates-supported-by-llama_chat_apply_template)
- [llama-server API Changelog](https://github.com/ggml-org/llama.cpp/issues/9291)

## Testing

A comprehensive test suite is available to verify JSON minification behavior:

```bash
node test/inject-capabilities.test.js
```

The test suite includes 5 test cases:
- Simple object minification
- Complex tools array minification  
- Nested arrays and objects minification
- Multi-line string payload minification
- Real upstream payload from VS Code minification

All tests verify that upstream JSON payloads are properly minified (no line breaks or extra whitespace) as required by llama.cpp.

---

## Usage Examples

### Chat Completion
Send a POST request to `/api/chat` (rewritten to `/v1/chat/completions`):
```bash
curl -X POST http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model": "your-model", "messages": [{"role": "user", "content": "Hello!"}]}'
```

### Tool-Calling Example
Send a POST request with tools:
```bash
curl -X POST http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model",
    "messages": [{"role": "user", "content": "Call a tool!"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "getWeather",
        "description": "Get weather info",
        "parameters": {"location": {"type": "string"}}
      }
    }]
  }'
```

---

## Environment Variables

- `VERBOSE=1` — Enable verbose logging (shows proxied JSONs and debug info)
- `LISTEN_PORT` — Change the proxy listening port (default: 11434)
- `UPSTREAM` — Change the upstream llama-server URL (default: http://127.0.0.1:11433)

Set environment variables before starting the proxy:
```bash
VERBOSE=1 LISTEN_PORT=11434 UPSTREAM=http://127.0.0.1:11433 node inject-capabilities.js
```

---

For more details, see the source code and comments in `inject-capabilities.js`. Contributions and feedback are welcome!
