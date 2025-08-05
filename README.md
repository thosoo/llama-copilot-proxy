## Docker Compose Support

You can use Docker Compose to run both the proxy and a llama-server together. This is ideal for local development and testing.

### Quick Start
1. Place your GGUF model file in a `models/` directory at the project root.
2. Build and start both services:
   ```bash
   docker compose up --build
   ```
3. The proxy will be available at `http://localhost:11434` and will forward requests to the llama-server at `http://llama-server:11433`.

### Customizing Model Path
- Edit `docker-compose.yml` to change the model path or llama-server options as needed.
- Example:
  ```yaml
  command: ["llama-server", "--model", "/models/your-model.gguf", "--port", "11433", "--jinja"]
  volumes:
    - ./models:/models
  ```

### Stopping Services
```bash
docker compose down
```

### Healthchecks
- Both services include healthchecks for robust startup and dependency management.

---
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


## Docker Support

You can run the proxy in a Docker container for both development and production. The provided multi-stage Dockerfile supports Node.js 18+ and exposes port 11434 by default.

### Build the Docker image (production)
```bash
docker build -t llama-copilot-proxy:latest .
```

### Run the container (production)
```bash
docker run -d --name llama-copilot-proxy -p 11434:11434 llama-copilot-proxy:latest
```

#### Enable verbose logging
```bash
docker run -d --name llama-copilot-proxy -p 11434:11434 -e VERBOSE=1 llama-copilot-proxy:latest
```

#### Change upstream server or port
```bash
docker run -d --name llama-copilot-proxy -p 11434:11434 -e UPSTREAM=http://host.docker.internal:11433 llama-copilot-proxy:latest
```

### Build the Docker image (development)
```bash
docker build --target dev -t llama-copilot-proxy:dev .
```

### Run tests inside the container
```bash
docker run --rm llama-copilot-proxy:dev npm test
```

### Stopping and removing the container
```bash
docker stop llama-copilot-proxy && docker rm llama-copilot-proxy
```

### Notes
- The container exposes port 11434 by default. You can change this with the `LISTEN_PORT` environment variable.
- For local development, use `host.docker.internal` to connect to services running on your host machine (e.g., llama-server).
- The `.dockerignore` file ensures your image is small and efficient.
- For multi-service setups, consider using Docker Compose.

---
   The repository includes a `.gitignore` file that excludes `node_modules` from version control.

---

# Copilot BYOK → llama.cpp Integration Proxy

A seamless Node.js proxy for bridging VS Code Copilot's BYOK (Bring Your Own Key) feature with local llama.cpp (llama-server) instances. Handles API endpoint translation, tool-calling compatibility, streaming, and error handling for agent mode workflows.

## Quick Start

1. **Start llama-server with tool support:**
   ```bash
   # Install and start llama-server with jinja templates for tool-calling
   llama-server --model /path/to/your/model.gguf --port 11433 --jinja
   ```

2. **Start the proxy:**
   ```bash
   node proxy-server.js
   ```

3. **Configure VS Code Copilot:**
   Add to your VS Code settings.json:
   ```json
   {
     "github.copilot.advanced.debug.overrideEngine": "http://127.0.0.1:11434"
   }
   ```

## Problem Solved

VS Code Copilot's BYOK feature expects Ollama-style API endpoints (`/api/chat`), but llama.cpp (llama-server) uses OpenAI-compatible endpoints (`/v1/chat/completions`). Additionally, tool-calling schemas need specific formatting.

### Key Features

- **Path Rewriting**: `/api/chat` → `/v1/chat/completions`
- **Tool Schema Patching**: Auto-adds missing `parameters` objects to tool definitions
- **Streaming Support**: Maintains proper server-sent events for real-time responses
- **Error Handling**: Graceful handling of connection resets and client disconnects
- **JSON Minification**: Optimizes payload sizes for better performance

## Architecture

```
VS Code Copilot (BYOK) → Proxy (Port 11434) → llama.cpp (llama-server, Port 11433)
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
   node proxy-server.js
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

## Copilot BYOK → llama.cpp Path Rewriting

This proxy automatically rewrites Copilot's hard-coded Ollama-style endpoints to the OpenAI-style endpoints expected by llama.cpp (llama-server):

- `POST /api/chat` → `POST /v1/chat/completions`
- `POST /api/generate` → `POST /v1/completions`

This enables seamless interoperability between Copilot Agent Mode and llama.cpp (llama-server, Qwen-3, etc.) with tool-calling support (when `--jinja` is enabled).

**No changes are needed in Copilot or llama.cpp.** Just run the proxy and it will handle all necessary path rewrites and payload forwarding.

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
VERBOSE=1 LISTEN_PORT=11434 UPSTREAM=http://127.0.0.1:11433 node proxy-server.js
```

---

## Advanced Troubleshooting

### Common Issues & Solutions

**Copilot disconnects immediately (`ECONNRESET`)**
- Ensure the proxy is running and listening on the correct port (`11434`).
- Check that the llama-server is started with the correct flags (`--jinja`, and a compatible chat template).
- Verify that VS Code Copilot is configured to use the proxy URL (`http://127.0.0.1:11434`).
- Try enabling verbose logging (`VERBOSE=1`) to see detailed request/response logs.
- If using Windows, check for firewall or antivirus interference.
- If using WSL, ensure ports are forwarded correctly.

**Copilot requests not appearing in proxy logs**
- Double-check VS Code settings for Copilot override engine.
- Restart VS Code after changing settings.
- Make sure no other service is using port `11434`.

**Tool-calling fails with `key 'parameters' not found`**
- Confirm that your model and server support OpenAI function calling format.
- Ensure all tools in the payload have a `parameters` object (the proxy auto-patches this, but malformed requests may still fail).
- Use the test suite (`node test/inject-capabilities.test.js`) to verify JSON minification and tool schema patching.

**Streaming responses are not received**
- Check that the proxy sets `text/event-stream` headers and flushes them immediately.
- Try with `curl` to verify streaming works outside VS Code.
- If using nginx or another reverse proxy, disable buffering (`proxy_buffering off;`).

**Proxy returns 502 errors**
- Check upstream llama-server logs for errors.
- Ensure the model is loaded and ready to accept requests.
- Try restarting both the proxy and llama-server.

**Performance is slow**
- Use models with lower quantization for faster inference.
- Run both proxy and llama-server on the same machine for minimal latency.
- Monitor system resources (CPU, RAM) and optimize model size as needed.

---

## Security Considerations

- **Environment Variables:** Never commit sensitive environment variables (API keys, secrets) to version control. Use a `.env` file and add it to `.gitignore`.
- **Proxy Exposure:** Run the proxy on localhost or a secure internal network. Avoid exposing it to the public internet unless protected by authentication and HTTPS.
- **Upstream Server:** Ensure the upstream llama-server is also protected and not exposed to unauthorized access.
- **Logging:** If verbose logging is enabled, be aware that request/response bodies may contain sensitive information. Use with caution in production.
- **Dependencies:** Keep dependencies up to date to avoid known vulnerabilities. Run `npm audit` regularly.
- **CORS:** The proxy sets permissive CORS headers for development. For production, restrict origins as needed.

---

## Performance Tips

- **Model Selection:** Use quantized models (e.g., Q4_K_M) for faster inference and lower memory usage.
- **Hardware:** Run both proxy and llama-server on machines with sufficient CPU and RAM. For large models, consider using machines with AVX2/AVX512 support.
- **Local Networking:** Keep proxy and llama-server on the same host or LAN to minimize latency.
- **Streaming:** Use streaming mode for chat completions to improve responsiveness in VS Code Copilot.
- **Resource Monitoring:** Monitor system load and memory usage. Use tools like `htop` or `top` to identify bottlenecks.
- **Node.js Tuning:** For heavy loads, consider running the proxy with Node.js process managers (e.g., PM2) and tuning Node.js memory limits (`--max-old-space-size`).
- **Upstream Optimization:** Ensure llama-server is started with optimal flags for your model and workload (see llama.cpp docs for details).

---

## FAQ

**Q: Can I use this proxy with any LLM model?**
A: The proxy works with llama.cpp-compatible models that support OpenAI function calling format and chat templates. For best results, use models with tool support and start llama-server with `--jinja`.

**Q: Does this proxy support streaming responses?**
A: Yes, it maintains server-sent events for real-time streaming, compatible with VS Code Copilot.

**Q: How do I add custom tools?**
A: Define tools in your Copilot payload using OpenAI function calling schema. The proxy auto-patches missing `parameters` objects.

**Q: What ports does the proxy use?**
A: By default, the proxy listens on `11434` and forwards to llama-server on `11433`. You can change these with environment variables.

**Q: How do I debug issues?**
A: Enable verbose logging (`VERBOSE=1`) and check both proxy and llama-server logs. See the Advanced Troubleshooting section for more tips.

**Q: Is this production-ready?**
A: The proxy is designed for local development and experimentation. For production, review security, performance, and reliability considerations.

---

## References & Further Reading

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [llama.cpp Function Calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)
- [llama.cpp Supported Chat Templates](https://github.com/ggml-org/llama.cpp/wiki/Templates-supported-by-llama_chat_apply_template)
- [llama.cpp Main Repository](https://github.com/ggml-org/llama.cpp)
- [Node.js http-proxy](https://github.com/http-party/node-http-proxy)
- [Express.js Middleware Guide](https://expressjs.com/en/guide/using-middleware.html)
- [VS Code Copilot Settings](https://docs.github.com/en/copilot/configuring-copilot)

---
