import os
import json
import time
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from flask import Flask, Response, jsonify, request, stream_with_context, g


# Application globals and configuration defaults (restore if missing)
app = Flask(__name__)

# Runtime configuration (environment-driven)
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "11434"))
LISTEN_HOST = os.environ.get("LISTEN_HOST", "0.0.0.0")
UPSTREAM = os.environ.get("UPSTREAM", "http://10.66.0.5:8080")
THINKING_MODE = os.environ.get("THINKING_MODE", "default")
THINKING_DEBUG = os.environ.get("THINKING_DEBUG", "false").lower() in ("1", "true", "yes")
VERBOSE = os.environ.get("VERBOSE", "false").lower() in ("1", "true", "yes")
VERSION = "1.0.0"
active_streams = 0
MODEL_ALIASES: Dict[str, str] = {}


def estimate_tokens_from_messages(messages: Optional[List[Dict[str, Any]]]) -> int:
    """Rudimentary token estimate used for warnings. Counts approximate tokens by
    character length / 4. This is a safe heuristic for local testing.
    """
    if not messages:
        return 0
    total_chars = 0
    for m in messages:
        if isinstance(m, dict):
            for v in m.values():
                if isinstance(v, str):
                    total_chars += len(v)
    return max(0, total_chars // 4)


def vlog(*args, **kwargs):
    """Verbose log helper; respects VERBOSE flag."""
    if VERBOSE:
        print("[VLOG]", *args, **kwargs)


def _join_with_space(a: str, b: str) -> str:
    # Join two fragments ensuring a single space between them when appropriate
    if not a:
        return b
    if not b:
        return a
    if a.endswith(" ") or b.startswith(" "):
        return a + b
    return a + " " + b


def _join_with_newline(a: str, b: str) -> str:
    # Join two fragments ensuring at least one newline separation
    if not a:
        return b
    if not b:
        return a
    if a.endswith("\n") or b.startswith("\n"):
        return a + b
    return a + "\n" + b


def patch_tools_array(arr: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Minimal pass-through for tools; preserve existing entries
    return arr


def _friendly_model_name(mid: str) -> str:
    """Derive a human-friendly alias from a model id or file path."""
    try:
        base = os.path.basename(mid)
        # strip common extensions
        for ext in (".gguf", ".bin", ".pt", ".pth"):
            if base.endswith(ext):
                base = base[: -len(ext)]
        # collapse whitespace
        base = " ".join(base.split())
        return base or mid
    except Exception:
        return str(mid)


def _register_model_alias(alias: str, real_id: str):
    if not alias or not real_id:
        return
    key = alias
    idx = 2
    # Ensure uniqueness if multiple models collapse to the same alias
    while key in MODEL_ALIASES and MODEL_ALIASES.get(key) != real_id:
        key = f"{alias} ({idx})"
        idx += 1
    MODEL_ALIASES[key] = real_id
    if VERBOSE:
        print(f"🔗 [ALIASES] {key} -> {real_id}")


def _resolve_model_id(maybe_alias: Optional[str]) -> Optional[str]:
    if not maybe_alias:
        return maybe_alias
    return MODEL_ALIASES.get(maybe_alias, maybe_alias)


def _select_output_mode(accept_header: Optional[str]) -> str:
    """Choose streaming output mode from Accept header.

    - If client requests text/event-stream, use SSE.
    - If client requests application/json or application/x-ndjson, use NDJSON.
    - Otherwise, default to NDJSON (safer for ollama-js/LibreChat).
    """
    a = (accept_header or "").lower()
    if "text/event-stream" in a:
        return "sse"
    if "application/x-ndjson" in a or "application/json" in a:
        return "ndjson"
    # Generic default
    return "ndjson"


def process_queued_show_requests():
    # Placeholder for queued processing used in original project; no-op here
    if VERBOSE:
        print("[INFO] process_queued_show_requests invoked (no-op)")


def _client_wants_stream(body: Dict[str, Any]) -> bool:
    """Return True if the request body asks for streaming.

    Accepts typical boolean forms (True/"true"/"1" etc.). Defaults to False.
    """
    if not isinstance(body, dict):
        return False
    val = body.get("stream")
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return False


def _stream_chat_completion(upstream_url: str, body: Dict[str, Any], output_mode: str, ndjson_schema: str):
    """Stream from upstream and emit either SSE or NDJSON with a final 'done' marker.

    - Parses upstream as SSE or NDJSON automatically based on Content-Type and payloads.
    - Adds role="assistant" to deltas when content is present.
    - Ensures a terminal event is emitted: [DONE] for SSE or {"done": true} for NDJSON.
    """
    if VERBOSE:
        print(f"[STREAM] Proxying to {upstream_url} with output_mode={output_mode}")
    done_emitted = False
    try:
        r = requests.post(upstream_url, json=body, stream=True, timeout=120)
        r.raise_for_status()
        upstream_ct = (r.headers.get("Content-Type") or "").lower()
        if VERBOSE:
            print("[VLOG] [POST] Upstream response status:", r.status_code)
            print("[VLOG] [POST] Upstream response headers:", dict(r.headers))
            print(f"🔧 [STREAM] generator start: output_mode={output_mode!r} upstream_content_type={upstream_ct!r}")

        buffer = ""

        def emit_sse_json(obj: Dict[str, Any]):
            payload = json.dumps(obj, ensure_ascii=False)
            return f"data: {payload}\n\n"

        def handle_obj(obj: Any):
            nonlocal done_emitted
            # Normalize OpenAI-like streaming objects
            try:
                if isinstance(obj, dict):
                    # Mark role on assistant deltas
                    choices = obj.get("choices")
                    if isinstance(choices, list) and choices:
                        delta = choices[0].get("delta")
                        if isinstance(delta, dict):
                            content = delta.get("content")
                            if isinstance(content, str) and content.strip():
                                delta["role"] = "assistant"
                        # Treat OpenAI-style finish_reason as a terminal marker, too
                        finish_reason = choices[0].get("finish_reason")
                        if finish_reason is not None:
                            done_emitted = True
                    # Detect completion markers in various shapes
                    if obj.get("done") is True:
                        done_emitted = True
                elif isinstance(obj, str) and obj.strip() == "[DONE]":
                    done_emitted = True
            except Exception:
                pass

            # Emit in requested format
            if output_mode == "sse":
                if isinstance(obj, str) and obj.strip() == "[DONE]":
                    return emit_sse_json({"done": True})
                if isinstance(obj, dict):
                    return emit_sse_json(obj)
                # Fallback
                return emit_sse_json({"message": str(obj)})
            else:
                # NDJSON mode
                # Ollama schema translation for LibreChat/ollama-js
                if ndjson_schema == "ollama":
                    ts = datetime.now(timezone.utc).isoformat()
                    if isinstance(obj, str) and obj.strip() == "[DONE]":
                        return json.dumps({
                            "model": body.get("model"),
                            "created_at": ts,
                            "message": {"role": "assistant", "content": ""},
                            "done": True
                        }, ensure_ascii=False) + "\n"
                    if isinstance(obj, dict):
                        # Try to extract content delta from OpenAI-like chunk
                        content = None
                        finish_reason = None
                        try:
                            choices = obj.get("choices")
                            if isinstance(choices, list) and choices:
                                delta = choices[0].get("delta")
                                if isinstance(delta, dict):
                                    content = delta.get("content")
                                finish_reason = choices[0].get("finish_reason")
                        except Exception:
                            content = None
                            finish_reason = None
                        if isinstance(content, str) and content != "":
                            return json.dumps({
                                "model": body.get("model") or obj.get("model"),
                                "created_at": ts,
                                "message": {"role": "assistant", "content": content},
                                "done": False
                            }, ensure_ascii=False) + "\n"
                        # If not a delta with content, pass through only if it already looks like ollama
                        if obj.get("done") is True or finish_reason is not None:
                            final_obj = {
                                "model": body.get("model") or obj.get("model"),
                                "created_at": ts,
                                "message": {"role": "assistant", "content": ""},
                                "done": True
                            }
                            if finish_reason:
                                final_obj["done_reason"] = finish_reason
                            return json.dumps(final_obj, ensure_ascii=False) + "\n"
                        # Drop non-content noise to avoid confusing clients
                        return None
                # Default NDJSON passthrough
                if isinstance(obj, str) and obj.strip() == "[DONE]":
                    return json.dumps({"done": True}, ensure_ascii=False) + "\n"
                return json.dumps(obj, ensure_ascii=False) + "\n"

        # Decide how to parse incoming chunks
        upstream_is_sse = "text/event-stream" in upstream_ct

        for chunk in r.iter_content(chunk_size=1024):
            if not chunk:
                continue
            s = chunk.decode("utf-8", errors="ignore")
            buffer += s
            if upstream_is_sse:
                parts = buffer.split("\n\n")
                buffer = parts.pop() if parts else ""
                for part in parts:
                    if not part.strip():
                        continue
                    data_lines = []
                    for line in part.splitlines():
                        if line.startswith("data:"):
                            data_lines.append(line[len("data:"):].lstrip())
                    if not data_lines:
                        continue
                    payload = "\n".join(data_lines)
                    try:
                        if payload.strip() == "[DONE]":
                            out = handle_obj("[DONE]")
                            if out:
                                yield out
                            continue
                        obj = json.loads(payload)
                    except Exception:
                        obj = {"message": payload}
                    out = handle_obj(obj)
                    if out:
                        yield out
            else:
                # NDJSON or chunked JSON
                lines = buffer.split("\n")
                buffer = lines.pop() if lines else ""
                for line in lines:
                    if not line.strip():
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        if line.strip() == "[DONE]":
                            obj = "[DONE]"
                        else:
                            obj = {"message": line}
                    out = handle_obj(obj)
                    if out:
                        yield out

        # Ensure a terminal marker for clients expecting it
        if not done_emitted:
            if output_mode == "sse":
                yield emit_sse_json({"done": True, "model": body.get("model")})
            else:
                if ndjson_schema == "ollama":
                    ts = datetime.now(timezone.utc).isoformat()
                    final_obj = {
                        "model": body.get("model"),
                        "created_at": ts,
                        "message": {"role": "assistant", "content": ""},
                        "done": True
                    }
                    yield json.dumps(final_obj, ensure_ascii=False) + "\n"
                else:
                    yield json.dumps({"done": True, "model": body.get("model")}, ensure_ascii=False) + "\n"
    except Exception as e:
        if VERBOSE:
            print(f"[STREAM] Upstream error: {e}")
        # Yield a minimal error event and done marker
        err_obj = {"model": body.get("model"), "error": str(e)}
        if output_mode == "sse":
            # Avoid f-string with inline dict to prevent brace parsing issues
            yield "data: " + json.dumps(err_obj) + "\n\n"
            yield "data: " + json.dumps({"done": True}) + "\n\n"
        else:
            yield json.dumps(err_obj) + "\n"
            if ndjson_schema == "ollama":
                ts = datetime.now(timezone.utc).isoformat()
                yield json.dumps({
                    "model": body.get("model"),
                    "created_at": ts,
                    "message": {"role": "assistant", "content": ""},
                    "done": True
                }) + "\n"
            else:
                yield json.dumps({"done": True}) + "\n"


def _increment_streams():
    global active_streams
    active_streams += 1
    print(f"🔒 [STREAM-TRACKING] Stream started (active: {active_streams})")


def _decrement_streams(reason: str):
    global active_streams
    active_streams -= 1
    print(f"🔓 [STREAM-TRACKING] Stream ended: {reason} (active: {active_streams})")
    if active_streams == 0:
        # Slight delay then process queued /api/show
        threading.Timer(0.1, process_queued_show_requests).start()


def _prepare_chat_body_and_log(body: Dict[str, Any]) -> Dict[str, Any]:
    if THINKING_DEBUG:
        print("🧠 [THINKING] Mode:", THINKING_MODE)
        print("   Available modes:")
        print("   - 'vscode': Standard reasoning_content for VSCode Copilot (default)")
        print("   - 'events': Custom 'event: thinking' SSE events only")
        print("   - 'both': Both standard and custom events")
        print("   - 'show_reasoning': Route thinking to normal content stream (VSCode will display it!)")
        print("   - 'off': Disable thinking content entirely\n")
        print("   Configure with: THINKING_MODE=show_reasoning THINKING_DEBUG=true python proxy_server.py")

    # Estimate tokens
    est_tokens = estimate_tokens_from_messages(body.get("messages"))
    if est_tokens > 2000:
        print(f"⚠️  [WARNING] Large prompt detected (~{est_tokens} tokens). This may cause timeout issues.")
        print("⚠️  [TIP] Consider reducing context size or increasing timeout settings.")

        if isinstance(body.get("tools"), list):
            print(f"🔧 [TOOLS] Tool request detected with {len(body['tools'])} tools")
            vlog("[POST] Full tool-calling request body:", json.dumps(body, indent=2))

    # Always return the (possibly inspected) body; callers rely on it
    return body


@app.post("/api/show")
def api_show():
    # Show model information; map to /v1/models/{model} when Ollama endpoint is unavailable
    body = request.get_json(silent=True) or {}
    model = _resolve_model_id(body.get("model"))
    if not isinstance(model, str) or not model:
        return jsonify({"error": "bad_request", "message": "Missing 'model' in body"}), 400
    # Try llama.cpp OpenAI-compatible endpoint
    try:
        if VERBOSE:
            print(f"🔎 [/api/show] Request for model='{model}' -> querying {UPSTREAM}/v1/models/{model}")
        # URL-encode model id in case it contains slashes or spaces
        try:
            from requests.utils import quote
            model_enc = quote(model, safe="")
        except Exception:
            model_enc = model
        r = requests.get(f"{UPSTREAM}/v1/models/{model_enc}", timeout=15)
        if r.status_code == 200:
            info = r.json()
            # Provide a minimal Ollama-like show payload
            resp = {
                "modelfile": "",
                "parameters": "",
                "template": "",
                "details": {
                    "parent_model": "",
                    "format": "gguf",
                    "family": info.get("owned_by", ""),
                    "families": [info.get("owned_by")] if info.get("owned_by") else [],
                    "parameter_size": "",
                    "quantization_level": ""
                },
                "model_info": {},
                # Keep capabilities consistent with /api/tags for selection in Ask/Agent
                "capabilities": ["completion", "chat", "embeddings", "tools", "planAndExecute"],
            }
            if VERBOSE:
                print("🔎 [/api/show] Returning minimal Ollama-like info with capabilities",
                      resp.get("capabilities"))
            return jsonify(resp)
    except Exception as e:
        if VERBOSE:
            print("[POST] /api/show upstream (v1/models/{id}) error:", e)
    # Fallback: try native Ollama if upstream provides it
    try:
        if VERBOSE:
            print(f"🔎 [/api/show] Falling back to upstream {UPSTREAM}/api/show")
        r2 = requests.post(f"{UPSTREAM}/api/show", json={"model": model}, timeout=15)
        if r2.status_code == 200:
            # Try to inject capabilities into fallback JSON
            try:
                obj = r2.json()
                if isinstance(obj, dict):
                    caps = set((obj.get("capabilities") or []))
                    caps.update(["completion", "chat", "embeddings", "tools", "planAndExecute"])
                    obj["capabilities"] = sorted(caps)
                    return jsonify(obj), 200
            except Exception:
                pass
            return Response(r2.content, status=200, headers={k: v for k, v in r2.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "content-length", "connection"}})
    except Exception:
        pass
    # Last resort: return minimal stub so Copilot doesn't error out
    return jsonify({
        "details": {"format": "gguf", "family": "", "families": []},
        "capabilities": ["completion", "chat", "embeddings", "tools", "planAndExecute"],
    }), 200


@app.post("/api/embed")
def api_embed():
    # Map Ollama /api/embed to OpenAI /v1/embeddings when using llama.cpp
    try:
        body = request.get_json(silent=True) or {}
        if isinstance(body.get("model"), str):
            original = body["model"]
            body["model"] = _resolve_model_id(original)
            if VERBOSE and body["model"] != original:
                print(f"🔁 [/api/embed] Resolved model alias '{original}' -> '{body['model']}'")
        if VERBOSE:
            shape = {
                "has_model": isinstance(body, dict) and bool(body.get("model")),
                "input_type": type((body or {}).get("input")).__name__ if isinstance(body, dict) else None,
            }
            print("🔎 [/api/embed] Proxying to /v1/embeddings with shape:", shape)
        r = requests.post(f"{UPSTREAM}/v1/embeddings", json=body, timeout=60)
        # Try to convert OpenAI response to Ollama shape for better client compatibility
        try:
            obj = r.json()
            embeddings = None
            if isinstance(obj, dict) and isinstance(obj.get("data"), list):
                data_list = obj["data"]
                if len(data_list) == 1:
                    embeddings = data_list[0].get("embedding")
                else:
                    embeddings = [d.get("embedding") for d in data_list]
            if embeddings is not None:
                if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
                    return jsonify({"embeddings": embeddings})
                else:
                    return jsonify({"embedding": embeddings})
        except Exception:
            pass
        return Response(r.content, status=r.status_code, headers={k: v for k, v in r.headers.items() if k.lower() not in {"content-encoding", "transfer-encoding", "content-length", "connection"}})
    except Exception as e:
        if VERBOSE:
            print("[POST] /api/embed upstream error:", e)
        return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502


# Alias to match Ollama's embeddings endpoint expected by some clients
@app.post("/api/embeddings")
def api_embeddings():
    # Delegate to the same handler as /api/embed
    return api_embed()


@app.route("/v1/chat/completions", methods=["POST"])
@app.route("/chat/completions", methods=["POST"])
def chat_completions():
    print(f"[POST] Proxying chat completion: {request.path}")
    if VERBOSE:
        print("[POST] Headers:", dict(request.headers))
    body = request.get_json(silent=True) or {}

    body = _prepare_chat_body_and_log(body)

    upstream_url = f"{UPSTREAM}{request.path}"
    if _client_wants_stream(body):
        _increment_streams()
        try:
            accept = request.headers.get("Accept", "")
            ua = request.headers.get("User-Agent", "")
            output_mode = _select_output_mode(accept)
            if THINKING_DEBUG or VERBOSE:
                print(f"🔧 [STREAM] {request.path} selected output_mode={output_mode!r} Accept={accept!r} UA={ua!r} stream={body.get('stream')!r}")
            ndjson_schema = "openai"  # keep OpenAI shape for /v1 paths
            generator = _stream_chat_completion(upstream_url, body, output_mode=output_mode, ndjson_schema=ndjson_schema)

            def _cleanup_generator(gen):
                try:
                    for x in gen:
                        yield x
                finally:
                    _decrement_streams("stream end")

            mimetype = "application/x-ndjson" if output_mode == "ndjson" else "text/event-stream"
            resp = Response(stream_with_context(_cleanup_generator(generator)), mimetype=mimetype)
            resp.headers["Vary"] = "Accept"
            if output_mode == "sse":
                resp.headers["Cache-Control"] = "no-cache"
                resp.headers["X-Accel-Buffering"] = "no"
                resp.headers["Connection"] = "keep-alive"
            return resp
        except Exception as e:
            _decrement_streams("upstream error")
            print(f"[POST] Upstream request error for {request.path}:", e)
            return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502
    else:
        # Non-streaming: forward as a normal JSON request and return application/json (no heartbeats)
        if THINKING_DEBUG or VERBOSE:
            print(f"🔧 [STREAM] {request.path} non-streaming path (stream={body.get('stream')!r}) Accept={request.headers.get('Accept','')!r}")
        try:
            resp = requests.post(upstream_url, json=body, timeout=120)
            resp.raise_for_status()
            try:
                data = resp.json()
                return Response(json.dumps(data), status=resp.status_code, mimetype="application/json")
            except Exception:
                return Response(resp.content, status=resp.status_code, mimetype="application/json")
        except Exception as e:
            print(f"[POST] Upstream request error for {request.path}:", e)
            return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502


@app.post("/api/chat")
def api_chat():
    """Ollama-compatible chat endpoint for clients like librechat/ollama-js.

    Maps to upstream OpenAI-compatible /v1/chat/completions and normalizes the stream:
    - If client Accepts application/json, emit NDJSON with {"done": true} at the end.
    - If client Accepts text/event-stream, emit SSE with a final done event.
    """
    print("➡️  [REQ] POST /api/chat UA=", request.headers.get("User-Agent", ""))
    body = request.get_json(silent=True) or {}
    if VERBOSE:
        print("[POST] Proxying Copilot /api/chat -> /v1/chat/completions")
        print("[POST] Headers:", dict(request.headers))
    body = _prepare_chat_body_and_log(body)

    upstream_url = f"{UPSTREAM}/v1/chat/completions"
    if _client_wants_stream(body):
        _increment_streams()
        try:
            accept = request.headers.get("Accept", "")
            ua = request.headers.get("User-Agent", "")
            # Force NDJSON for Ollama-compatible /api/chat to satisfy ollama-js/LibreChat
            output_mode = "ndjson"
            if THINKING_DEBUG or VERBOSE:
                print(f"🔧 [STREAM] /api/chat forcing NDJSON streaming (output_mode={output_mode!r}) Accept={accept!r} UA={ua!r} stream={body.get('stream')!r}")
            ndjson_schema = "ollama"  # NDJSON expected by ollama-js
            generator = _stream_chat_completion(upstream_url, body, output_mode=output_mode, ndjson_schema=ndjson_schema)

            def _cleanup_generator(gen):
                try:
                    for x in gen:
                        yield x
                finally:
                    _decrement_streams("stream end")

            mimetype = "application/x-ndjson" if output_mode == "ndjson" else "text/event-stream"
            resp = Response(stream_with_context(_cleanup_generator(generator)), mimetype=mimetype)
            resp.headers["Vary"] = "Accept"
            # For NDJSON, also disable buffering to ensure timely delivery of lines
            if output_mode == "ndjson":
                resp.headers["Cache-Control"] = "no-cache"
                resp.headers["X-Accel-Buffering"] = "no"
                resp.headers["Connection"] = "keep-alive"
            if output_mode == "sse":
                resp.headers["Cache-Control"] = "no-cache"
                resp.headers["X-Accel-Buffering"] = "no"
                resp.headers["Connection"] = "keep-alive"
            return resp
        except Exception as e:
            _decrement_streams("upstream error")
            if VERBOSE:
                print("[POST] Upstream request error for /api/chat:", e)
            return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502
    else:
        try:
            resp = requests.post(upstream_url, json=body, timeout=120)
            resp.raise_for_status()
            try:
                data = resp.json()
                # Ollama-compatible: convert OpenAI response to Ollama final object shape
                ts = datetime.now(timezone.utc).isoformat()
                content = None
                finish_reason = None
                try:
                    choices = data.get("choices")
                    if isinstance(choices, list) and choices:
                        ch0 = choices[0]
                        finish_reason = ch0.get("finish_reason")
                        msg = ch0.get("message")
                        if isinstance(msg, dict):
                            content = msg.get("content")
                except Exception:
                    pass
                final_obj = {
                    "model": body.get("model") or data.get("model"),
                    "created_at": ts,
                    "message": {"role": "assistant", "content": content or ""},
                    "done": True,
                }
                if finish_reason:
                    final_obj["done_reason"] = finish_reason
                return Response(json.dumps(final_obj), status=resp.status_code, mimetype="application/json")
            except Exception:
                return Response(resp.content, status=resp.status_code, mimetype="application/json")
        except Exception as e:
            if VERBOSE:
                print("[POST] Upstream request error for /api/chat:", e)
            return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502


@app.route("/debug/json", methods=["POST"])
def debug_json():
    body = request.get_json(silent=True) or {}
    return jsonify({"minified": json.dumps(body)})


# Generic pass-through proxy as a last resort (minimalist)
@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def fallback_proxy(path: str):
    target_url = f"{UPSTREAM}/{path}"
    print(f"🚨 [{request.method}] FALLBACK proxy for /{path} -> {target_url}")

    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    data = None
    json_body = None
    if request.is_json:
        body = request.get_json(silent=True)
        if isinstance(body, dict) and isinstance(body.get("tools"), list):
            if VERBOSE:
                print("🚨 FALLBACK detected tools - MINIFYING & PATCHING!")
            body["tools"] = patch_tools_array(body["tools"])  # patch tool parameters
        json_body = body
    else:
        data = request.get_data()

    try:
        resp = requests.request(
            request.method,
            target_url,
            headers=headers,
            json=json_body,
            data=data if json_body is None else None,
            stream=True,
            timeout=60,
        )

        def generate():
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk

        # Build response
        excluded = {"content-encoding", "transfer-encoding", "content-length", "connection"}
        response_headers = [(k, v) for k, v in resp.headers.items() if k.lower() not in excluded]
        return Response(generate(), status=resp.status_code, headers=response_headers)
    except Exception as e:
        if VERBOSE:
            print("🚨 FALLBACK upstream request error:", e)
        return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502


def _print_banner():
    startup_time = datetime.now(timezone.utc).isoformat()
    print("\n===========================================")
    print("🚀 Copilot BYOK → llama.cpp Integration Proxy 🚀")
    print(f"Version: {VERSION} (Python, with DeepSeek Thinking Mode support)")
    print("A seamless bridge for VS Code Copilot and local llama.cpp (llama-server) with tool support.")
    print(f"🕐 Started at: {startup_time} (PID: {os.getpid()})")
    print("===========================================\n")
    print(f"Proxy listening on http://{LISTEN_HOST}:{LISTEN_PORT} (all interfaces if 0.0.0.0)")
    print(f"Upstream target: {UPSTREAM}")
    print("🧠 Thinking Mode Configuration:")
    print(f"   Mode: {THINKING_MODE}")
    print(f"   Debug: {'enabled' if THINKING_DEBUG else 'disabled'}")
    print("\n   Available modes:")
    print("   - 'default': Standard reasoning_content for Copilot protocol (reasoning hidden in VS Code GUI)")
    print("   - 'events': Custom 'event: thinking' SSE events only")
    print("   - 'both': Both standard and custom events")
    print("   - 'show_reasoning': Route thinking to normal content stream (VSCode will display it!)")
    print("   - 'off': Disable thinking content entirely")
    print("\n   Configure with: THINKING_MODE=show_reasoning THINKING_DEBUG=true python proxy_server.py")


@app.get("/api/version")
def api_version():
    # Lightweight health/version endpoint for docker healthcheck
    return jsonify({"version": VERSION, "status": "ok"}), 200


if __name__ == "__main__":
    _print_banner()
    # threaded=True to allow background timer and queued processing
    app.run(host=LISTEN_HOST, port=LISTEN_PORT, threaded=True)
