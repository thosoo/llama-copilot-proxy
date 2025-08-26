

# Copilot BYOK → llama.cpp Integration Proxy

A seamless Python (Flask) proxy for bridging VS Code Copilot's BYOK (Bring Your Own Key) feature with local llama.cpp (llama-server) instances. Handles API endpoint translation, tool-calling compatibility, streaming, and error handling for agent mode workflows.

## Abstract / Overview

This project enables VS Code Copilot Agent Mode to work with local llama.cpp models via a Python/Flask proxy. It rewrites API paths, minifies JSON, and ensures tool-calling compatibility, unlocking advanced automation and planning capabilities for your development workflow.

## Key Features

- **Path Rewriting**: `/api/chat` → `/v1/chat/completions`
- **Tool Schema Patching**: Auto-adds missing `parameters` objects to tool definitions
- **Streaming Support**: Maintains proper server-sent events for real-time responses
- **Error Handling**: Graceful handling of connection resets, client disconnects, and new error codes (see [llama-server changelog](https://github.com/ggml-org/llama.cpp/issues/9291))
- **JSON Minification**: Optimizes payload sizes for better performance
- **Multimodal Support**: Passes through image/text payloads when enabled (see [llama.cpp multimodal docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md))
- **GGUF Format**: Ensure your model is in GGUF format ([GGUF guide](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md))
- **Chat Templates**: For agent mode and tool use, specify a compatible chat template (e.g., `--chat-template chatml`). See [supported templates](https://github.com/ggml-org/llama.cpp/wiki/Templates-supported-by-llama_chat_apply_template).


## Copilot vs llama.cpp API/Schema Differences

VS Code Copilot Agent Mode expects Ollama-style endpoints and OpenAI function calling schemas:

- **Copilot expects:**
  - Endpoint: `/api/chat` (Ollama-style)
  - Payload: OpenAI function calling schema, e.g.:
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

- **llama.cpp (llama-server) provides:**
  - Endpoint: `/v1/chat/completions` (OpenAI-compatible)
  - Requires minified JSON (no line breaks or extra whitespace)
  - Expects tools in OpenAI function calling format (each tool must have `type: "function"` and a nested `function` object with `name`, `description`, and `parameters`)

- **Proxy transformation:**
  - Rewrites `/api/chat` → `/v1/chat/completions`
  - Minifies JSON payloads
  - Auto-patches missing `parameters` objects in tool definitions
  - Passes through OpenAI-format payloads unchanged to llama.cpp

**References:**
- [llama.cpp Function Calling Documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)
- [Supported Chat Templates](https://github.com/ggml-org/llama.cpp/wiki/Templates-supported-by-llama_chat_apply_template)
- [llama-server API Changelog](https://github.com/ggml-org/llama.cpp/issues/9291)

## Architecture

```
VS Code Copilot (BYOK) → Python Proxy (Port 11434) → llama.cpp (llama-server, Port 8080)
  /api/chat                                      /v1/chat/completions
```

## Quick Start

1. **Start llama-server with tool support:**
  ```bash
  llama-server --model /path/to/your/model.gguf --port 8080 --jinja
  ```

2. **Set up Python environment and install dependencies:**
  ```bash
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  ```

3. **Start the proxy:**
  ```bash
  LISTEN_PORT=11434 UPSTREAM=http://127.0.0.1:8080 THINKING_MODE=show_reasoning THINKING_DEBUG=false python3 proxy_server.py
  ```

4. **Configure VS Code Copilot:**
  Add to your VS Code settings.json:
  ```json
  {
    "github.copilot.advanced.debug.overrideEngine": "http://127.0.0.1:11434"
  }
  ```

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/thosoo/llama-copilot-proxy.git
   cd llama-copilot-proxy
   ```

2. **Install dependencies:**
  See step 2 above for Python instructions.

## Docker Support

You can run the proxy in a Docker container for both development and production. The provided Dockerfile supports Python 3.8+ and exposes port 11434 by default.

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
docker run -d --name llama-copilot-proxy -p 11434:11434 -e UPSTREAM=http://host.docker.internal:8080 llama-copilot-proxy:latest
```

### Stopping and removing the container
```bash
docker stop llama-copilot-proxy && docker rm llama-copilot-proxy
```

### Docker Compose Support

You can use Docker Compose to run both the proxy and a llama-server together. This is ideal for local development and testing. The Docker Compose file will use the Python proxy.

#### Quick Start
1. Place your GGUF model file in a `models/` directory at the project root.
2. (Optional) For multimodal support (image/text), use a model and template compatible with [llama.cpp multimodal](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md). Edit your `docker-compose.yml` to add the `--mm` flag:
   ```yaml
   command: ["llama-server", "--model", "/models/your-model.gguf", "--port", "8080", "--jinja", "--mm"]
   volumes:
     - ./models:/models
   ```
3. (Optional) For agent mode and tool use, specify a compatible chat template (e.g., `--chat-template chatml`). See [supported templates](https://github.com/ggml-org/llama.cpp/wiki/Templates-supported-by-llama_chat_apply_template).
4. Build and start both services:
   ```bash
   docker compose up --build
   ```
5. The proxy will be available at `http://localhost:11434` and will forward requests to the llama-server at `http://llama-server:8080`.

#### Customizing Model Path
- Edit `docker-compose.yml` to change the model path or llama-server options as needed.
- Example:
  ```yaml
  command: ["llama-server", "--model", "/models/your-model.gguf", "--port", "8080", "--jinja"]
  volumes:
    - ./models:/models
  ```

#### Stopping Services
```bash
docker compose down
```

#### Healthchecks
- Both services include healthchecks for robust startup and dependency management.

#### Docker Usage & Networking

- `UPSTREAM`: Sets the upstream server for proxying requests. Default: `http://127.0.0.1:8080`
- `THINKING_MODE`: Controls the proxy's reasoning mode (e.g., `default`, `show_reasoning`, `events`, `both`, `off`).
- `THINKING_DEBUG`: Enables debug output if set to `true`.

#### Example: Run with custom upstream and debug mode
```bash
docker run -e UPSTREAM=http://10.66.0.7:8080 -e THINKING_MODE=show_reasoning -e THINKING_DEBUG=true --add-host=host.docker.internal:host-gateway -p 11434:11434 llama-copilot-proxy:latest
```

#### Podman Compatibility
You can also run the same command with Podman:
```bash
podman run -e UPSTREAM=http://10.66.0.7:8080 -e THINKING_MODE=content -e THINKING_DEBUG=true --add-host=host.docker.internal:host-gateway -p 11434:11434 llama-copilot-proxy:latest
```
If you encounter issues with `host.docker.internal`, use Podman's host networking mode:
```bash
podman run --network=host -e UPSTREAM=http://10.66.0.7:8080 -e THINKING_MODE=content -e THINKING_DEBUG=true llama-copilot-proxy:latest
```
Podman supports most Docker CLI flags, but host networking and `host.docker.internal` may require Podman v3.4+ and additional configuration on some systems.

#### Networking
- For Linux, use `--add-host=host.docker.internal:host-gateway` to allow the container to reach services running on the host.
- In your Node.js code, use `host.docker.internal` to connect to host services.
- Ensure your firewall allows traffic and DNS is configured correctly for outbound connectivity.

#### Build for development or production
- Development: `docker build --target dev -t llama-copilot-proxy:dev .`
- Production: `docker build -t llama-copilot-proxy:latest .`

The `.dockerignore` file ensures your image is small and efficient.
- For multi-service setups, consider using Docker Compose.

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

## Environment Variables

### THINKING_MODE Details

`default`: Standard Copilot protocol. Reasoning content is sent in the response, but **will NOT be displayed in the VS Code GUI**. This is the safest, most compatible mode for Copilot.

`show_reasoning`: Routes reasoning content into the main content field, so VS Code Copilot displays the model's step-by-step thinking directly in the UI.

`events`/`both`/`off`: See comments in `proxy-server.js` for details.

- `VERBOSE=1` — Enable verbose logging (shows proxied JSONs and debug info)
- `LISTEN_PORT` — Change the proxy listening port (default: 11434)
- `LLAMA_SERVER_PORT` — Change the llama-server port (default: 8080)
- `UPSTREAM` — Change the upstream llama-server URL (default: http://127.0.0.1:${LLAMA_SERVER_PORT})
- `THINKING_MODE` — Control how "thinking" events are routed. Options:
    - `default` (default): Standard reasoning_content for Copilot protocol (**reasoning hidden in VS Code GUI**)
    - `events`: Custom 'event: thinking' SSE events only
    - `both`: Both content and event streams
    - `off`: Disable thinking events
    - `show_reasoning`: Route thinking to normal content stream (VSCode will display it!)
- `THINKING_DEBUG` — Enable debug mode for thinking events (`true` or `false`).

Set environment variables before starting the proxy:
```bash
VERBOSE=1 LISTEN_PORT=11434 UPSTREAM=http://127.0.0.1:8080 THINKING_MODE=show_reasoning THINKING_DEBUG=true python3 proxy_server.py
```

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

## Security Considerations

- **Environment Variables:** Never commit sensitive environment variables (API keys, secrets) to version control. Use a `.env` file and add it to `.gitignore`.
- **Proxy Exposure:** Run the proxy on localhost or a secure internal network. Avoid exposing it to the public internet unless protected by authentication and HTTPS.
- **Upstream Server:** Ensure the upstream llama-server is also protected and not exposed to unauthorized access.
- **Logging:** If verbose logging is enabled, be aware that request/response bodies may contain sensitive information. Use with caution in production.
- **Dependencies:** Keep dependencies up to date to avoid known vulnerabilities. Run `pip audit` regularly.
- **CORS:** The proxy sets permissive CORS headers for development. For production, restrict origins as needed.

## Performance Tips

- **Model Selection:** Use quantized models (e.g., Q4_K_M) for faster inference and lower memory usage.
- **Hardware:** Run both proxy and llama-server on machines with sufficient CPU and RAM. For large models, consider using machines with AVX2/AVX512 support.
- **Local Networking:** Keep proxy and llama-server on the same host or LAN to minimize latency.
- **Streaming:** Use streaming mode for chat completions to improve responsiveness in VS Code Copilot.
- **Resource Monitoring:** Monitor system load and memory usage. Use tools like `htop` or `top` to identify bottlenecks.
- **Python Tuning:** For heavy loads, consider running the proxy with process managers (e.g., gunicorn, supervisor) and tuning Python memory limits.
- **Upstream Optimization:** Ensure llama-server is started with optimal flags for your model and workload (see llama.cpp docs for details).

## FAQ

**Q: Can I use this proxy with any LLM model?**
A: The proxy works with llama.cpp-compatible models that support OpenAI function calling format, GGUF format, and chat templates. For best results, use models with tool and multimodal support and start llama-server with `--jinja` and `--mm` if needed.

**Q: Does this proxy support streaming responses?**
A: Yes, it maintains server-sent events for real-time streaming, compatible with VS Code Copilot.

**Q: How do I add custom tools?**
A: Define tools in your Copilot payload using OpenAI function calling schema. The proxy auto-patches missing `parameters` objects.

**Q: What ports does the proxy use?**
A: By default, the proxy listens on `11434` and forwards to llama-server on `8080`. You can change these with environment variables.

**Q: How do I debug issues?**
A: Enable verbose logging (`VERBOSE=1`) and check both proxy and llama-server logs. See the Advanced Troubleshooting section for more tips.

**Q: Is this production-ready?**
A: The proxy is designed for local development and experimentation. For production, review security, performance, and reliability considerations.

## References & Further Reading

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [llama.cpp Function Calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)
- [llama.cpp Supported Chat Templates](https://github.com/ggml-org/llama.cpp/wiki/Templates-supported-by-llama_chat_apply_template)
- [llama.cpp Multimodal Documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)
- [GGUF Format Guide](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md)
- [llama-server API Changelog](https://github.com/ggml-org/llama.cpp/issues/9291)
- [llama.cpp Main Repository](https://github.com/ggml-org/llama.cpp)
- [Flask Documentation](https://flask.palletsprojects.com/)
## Python Endpoints

### `/v1/chat/completions` and `/chat/completions`
POST endpoint for chat completions, supports streaming and tool-calling. Accepts OpenAI-style payloads and proxies to upstream llama-server.

### `/debug/json`
POST endpoint for debugging JSON payloads (minifies and returns input).

### Fallback Proxy
All other paths are proxied to the upstream server, preserving method and payload.

See `proxy_server.py` for implementation details and advanced configuration.
- [VS Code Copilot Settings](https://docs.github.com/en/copilot/configuring-copilot)
