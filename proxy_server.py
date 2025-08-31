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
UPSTREAM = os.environ.get("UPSTREAM", "http://10.66.0.7:8080")
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

    - Default to SSE for OpenAI-compatible clients.
    - Switch to NDJSON only if the client explicitly requests application/x-ndjson.
    """
    a = (accept_header or "").lower()
    if "application/x-ndjson" in a:
        return "ndjson"
    # If client explicitly says text/event-stream, keep SSE (default anyway)
    return "sse"


def process_queued_show_requests():
    # Placeholder for queued processing used in original project; no-op here
    if VERBOSE:
        print("[INFO] process_queued_show_requests invoked (no-op)")



def _stream_chat_completion(
    upstream_url: str,
    body: Dict[str, Any],
    output_mode: str = "sse",
    ndjson_schema: str = "openai",
):
    """Stream chat completions from upstream, injecting reasoning_content
    into visible content when THINKING_MODE == 'show_reasoning'. This
    reassembles SSE chunks, parses JSON payloads, and forwards events as
    SSE to the downstream client.
    """
    # This generator handles streaming SSE-style responses from upstream.
    # Heartbeat/event prefixes are only emitted when the client explicitly
    # requested a streaming response via body.get("stream") == True.
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }

    with requests.post(upstream_url, data=json.dumps(body), headers=headers, stream=True) as r:
        content_type = r.headers.get("content-type", "")
        vlog(f"[POST] Upstream response status: {r.status_code}")
        vlog(f"[POST] Upstream response headers: {dict(r.headers)}")
        if THINKING_DEBUG:
            print(f"🔧 [STREAM] generator start: output_mode={output_mode!r} upstream_content_type={content_type!r}")

        # Determine whether upstream is sending SSE and proceed with streaming
        is_streaming = "text/event-stream" in content_type

        tool_call_buffer: List[str] = []
        is_tool_call = False
        tool_call_detected = False
        done_received = False
        reasoning_prefix_emitted = False
        reasoning_pending_separator = False
        seen_reasoning = False
        pre_reasoning_content_buffer = ""

        # Initial heartbeats: for SSE only. For NDJSON (especially Ollama schema),
        # do not emit non-message control lines to avoid client cast errors.
        if output_mode == "sse":
            yield ": heartbeat\n\n"
            yield ": processing-prompt\n\n"

        if is_streaming:
            buffer = ""
            for chunk in r.iter_content(chunk_size=1024):
                if not chunk:
                    continue
                s = chunk.decode("utf-8", errors="ignore")
                buffer += s

                parts = buffer.split("\n\n")
                buffer = parts.pop() if parts else ""

                for part in parts:
                    if not part.strip():
                        continue

                    event_raw = part + "\n\n"

                    data_lines: List[str] = []
                    for line in part.splitlines():
                        if line.startswith("data:"):
                            data_lines.append(line[len("data:"):].lstrip())
                    if not data_lines:
                        # No 'data:' lines in this part — these may be SSE comments
                        # (e.g., ': heartbeat') or other control lines. For SSE
                        # clients we forward raw. For NDJSON clients:
                        #  - If ndjson_schema == 'ollama', skip comment-only parts entirely
                        #    to avoid emitting non-message rows that break strict parsers.
                        #  - Otherwise, convert comments to benign heartbeat JSON entries.
                        if is_tool_call:
                            # Store raw form but adapt for ndjson if requested
                            if output_mode == "sse":
                                tool_call_buffer.append(event_raw)
                            else:
                                if ndjson_schema != "ollama":
                                    # convert comment lines to benign JSON heartbeat entries
                                    lines = [l for l in part.splitlines() if l.strip()]
                                    for ln in lines:
                                        if ln.startswith(":"):
                                            tool_call_buffer.append(json.dumps({"type": "heartbeat", "comment": ln[1:].strip()}) + "\n")
                                    # ignore other control lines for NDJSON
                        else:
                            if output_mode == "sse":
                                yield event_raw
                            else:
                                if ndjson_schema != "ollama":
                                    # For NDJSON clients (OpenAI-style), convert comment-only parts
                                    # to JSON heartbeat lines.
                                    lines = [l for l in part.splitlines() if l.strip()]
                                    for ln in lines:
                                        if ln.startswith(":"):
                                            yield json.dumps({"type": "heartbeat", "comment": ln[1:].strip()}) + "\n"
                                    # ignore other control lines
                        continue

                    event_payload = "\n".join(data_lines)

                    if event_payload.strip() == "[DONE]":
                        done_received = True
                        if is_tool_call:
                            # Append a done sentinel in the requested output mode
                            if output_mode == "sse":
                                tool_call_buffer.append("data: [DONE]\n\n")
                            else:
                                if ndjson_schema == "ollama":
                                    tool_call_buffer.append(json.dumps({"model": body.get("model"), "done": True}) + "\n")
                                else:
                                    tool_call_buffer.append(json.dumps({"done": True}) + "\n")
                        else:
                            if output_mode == "sse":
                                yield "data: [DONE]\n\n"
                            else:
                                if ndjson_schema == "ollama":
                                    yield json.dumps({"model": body.get("model"), "done": True}) + "\n"
                                else:
                                    yield json.dumps({"done": True}) + "\n"
                        continue

                    if ("tool_call" in event_payload) or ("tool_calls" in event_payload):
                        # Enter tool-call buffering mode, but don't append raw SSE.
                        # We'll buffer the parsed JSON in the selected output format below.
                        is_tool_call = True
                        tool_call_detected = True

                    try:
                        obj = json.loads(event_payload)
                    except Exception:
                        # If parsing fails, avoid emitting raw SSE to NDJSON clients.
                        if output_mode == "ndjson":
                            if event_payload.strip():
                                line = json.dumps({"value": event_payload}) + "\n"
                                if is_tool_call:
                                    tool_call_buffer.append(line)
                                else:
                                    yield line
                            # empty payload -> skip
                        else:
                            if is_tool_call:
                                tool_call_buffer.append(event_raw)
                            else:
                                yield event_raw
                        continue

                    # Ensure NDJSON clients always receive a JSON object (map).
                    # If upstream provided a non-dict (null, string, list), wrap it
                    # so client-side casts to Map<String, dynamic> succeed.
                    try:
                        if output_mode == "ndjson" and not isinstance(obj, dict):
                            obj = {"value": obj}
                    except Exception:
                        pass

                    if THINKING_MODE == "show_reasoning":
                        try:
                            choices = obj.get("choices") if isinstance(obj, dict) else None
                            if isinstance(choices, list) and len(choices) > 0:
                                SEP = "\n\n---\n\n"
                                # Snapshot whether each choice.delta had upstream 'content' BEFORE modifications
                                had_original_delta_content = []
                                for choice in choices:
                                    if isinstance(choice, dict) and isinstance(choice.get("delta"), dict):
                                        up_cont = choice["delta"].get("content")
                                        had_original_delta_content.append(isinstance(up_cont, str) and len(up_cont) > 0)
                                    else:
                                        had_original_delta_content.append(False)
                                for choice in choices:
                                    if not isinstance(choice, dict):
                                        continue

                                    if choice.get("message") and isinstance(choice.get("message"), dict):
                                        msg = choice["message"]
                                        if isinstance(msg.get("reasoning_content"), str):
                                            rc = msg.pop("reasoning_content")
                                            rc = rc.replace("\r\n", "\n")
                                            original = msg.get("content") or ""
                                            seen_reasoning = True
                                            if pre_reasoning_content_buffer or original:
                                                # If we buffered content before reasoning or have original alongside, flush buffer after HR
                                                combined = "💭 " + rc + SEP + (pre_reasoning_content_buffer if pre_reasoning_content_buffer else "")
                                                if original:
                                                    combined += original
                                                msg["content"] = combined
                                                pre_reasoning_content_buffer = ""
                                                reasoning_pending_separator = False
                                            else:
                                                # Emit reasoning now, and mark that the next normal content
                                                # should be prefixed with a visible separator.
                                                msg["content"] = "💭 " + rc
                                                reasoning_pending_separator = True

                                    if choice.get("delta") and isinstance(choice.get("delta"), dict):
                                        d = choice["delta"]
                                        if isinstance(d.get("reasoning_content"), str):
                                            rc = d.pop("reasoning_content")
                                            rc = rc.replace("\r\n", "\n")
                                            original = d.get("content") or ""
                                            seen_reasoning = True
                                            if not reasoning_prefix_emitted:
                                                if pre_reasoning_content_buffer or original:
                                                    # Flush any buffered pre-reasoning content, plus any original content, after HR
                                                    combined_tail = (pre_reasoning_content_buffer if pre_reasoning_content_buffer else "")
                                                    if original:
                                                        combined_tail += original
                                                    d["content"] = "💭 " + rc + SEP + combined_tail
                                                    pre_reasoning_content_buffer = ""
                                                    reasoning_pending_separator = False
                                                else:
                                                    # Start reasoning block; next normal content gets prefixed with SEP.
                                                    d["content"] = "💭 " + rc
                                                    reasoning_pending_separator = True
                                                reasoning_prefix_emitted = True
                                            else:
                                                if original:
                                                    d["content"] = _join_with_space(rc, original)
                                                else:
                                                    d["content"] = rc
                                        else:
                                            # No reasoning in this delta; if we haven't seen reasoning yet, buffer content
                                            cont_piece = d.get("content")
                                            if isinstance(cont_piece, str) and cont_piece and not seen_reasoning:
                                                pre_reasoning_content_buffer += cont_piece
                                                # Remove content from this event so we can emit it later in order
                                                d["content"] = ""

                                if reasoning_pending_separator and isinstance(obj, dict):
                                    try:
                                        for idx, ch in enumerate(obj.get("choices", [])):
                                            if not isinstance(ch, dict):
                                                continue
                                            if ch.get("delta") and isinstance(ch.get("delta"), dict):
                                                delta_obj = ch["delta"]
                                                cont = delta_obj.get("content")
                                                # Only inject separator when upstream originally provided content in this delta
                                                if had_original_delta_content[idx] and isinstance(cont, str) and cont:
                                                    # Prefix the first visible content with a Markdown HR separator
                                                    if not cont.startswith("\n---\n") and not cont.startswith("---\n"):
                                                        delta_obj["content"] = SEP + cont
                                                    reasoning_pending_separator = False
                                                    break
                                    except Exception:
                                        pass
                        except Exception:
                            pass

                    try:
                        out_payload = json.dumps(obj)
                    except Exception:
                        out_payload = event_payload

                    if output_mode == "sse":
                        out_event = f"data: {out_payload}\n\n"
                        if is_tool_call:
                            tool_call_buffer.append(out_event)
                        else:
                            yield out_event
                    else:
                        # NDJSON output; optionally map to Ollama-like schema for /api/chat consumers
                        if ndjson_schema == "ollama":
                            try:
                                # Extract assistant content from OpenAI-style chunk
                                content_fragments: List[str] = []
                                if isinstance(obj, dict) and isinstance(obj.get("choices"), list):
                                    for ch in obj["choices"]:
                                        if isinstance(ch, dict):
                                            d = ch.get("delta") or {}
                                            if isinstance(d, dict):
                                                frag = d.get("content")
                                                if isinstance(frag, str) and frag:
                                                    content_fragments.append(frag)
                                            # Some upstreams may use message{} in non-stream events; handle defensively
                                            m = ch.get("message") or {}
                                            if not content_fragments and isinstance(m, dict):
                                                frag2 = m.get("content")
                                                if isinstance(frag2, str) and frag2:
                                                    content_fragments.append(frag2)
                                content_text = "".join(content_fragments)
                                if content_text:
                                    out_line = json.dumps({
                                        "model": body.get("model"),
                                        "created_at": datetime.now(timezone.utc).isoformat(),
                                        "message": {"role": "assistant", "content": content_text},
                                        "done": False,
                                    }) + "\n"
                                    if is_tool_call:
                                        tool_call_buffer.append(out_line)
                                    else:
                                        yield out_line
                                # If no content, skip emitting a line to avoid null-cast errors downstream
                            except Exception:
                                # As a fallback, skip emitting malformed chunks in Ollama NDJSON mode
                                pass
                        else:
                            # OpenAI-style NDJSON line (object-per-line)
                            line = out_payload + "\n"
                            if is_tool_call:
                                tool_call_buffer.append(line)
                            else:
                                yield line

            if tool_call_detected:
                yield "".join(tool_call_buffer)
            # If no reasoning ever appeared but we buffered content, flush it before [DONE]
            if (not seen_reasoning) and pre_reasoning_content_buffer:
                try:
                    flush_obj = {
                        "choices": [
                            {"delta": {"content": pre_reasoning_content_buffer}}
                        ]
                    }
                    if output_mode == "sse":
                        yield f"data: {json.dumps(flush_obj)}\n\n"
                    else:
                        if ndjson_schema == "ollama":
                            # Map buffered content to Ollama chunk
                            yield json.dumps({
                                "model": body.get("model"),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                                "message": {"role": "assistant", "content": pre_reasoning_content_buffer},
                                "done": False,
                            }) + "\n"
                        else:
                            yield json.dumps(flush_obj) + "\n"
                except Exception:
                    pass
            if not done_received:
                if output_mode == "sse":
                    yield "data: [DONE]\n\n"
                else:
                    if ndjson_schema == "ollama":
                        yield json.dumps({"model": body.get("model"), "done": True}) + "\n"
                    else:
                        yield json.dumps({"done": True}) + "\n"
        else:
            raw = r.content
            try:
                data = json.loads(raw)
            except Exception:
                data = raw.decode("utf-8", errors="ignore")

            if (
                isinstance(data, dict)
                and data.get("choices")
                and data["choices"][0].get("message")
                and data["choices"][0]["message"].get("reasoning_content")
            ):
                reasoning_content = data["choices"][0]["message"]["reasoning_content"]
                if THINKING_MODE == "show_reasoning":
                    modified = dict(data)
                    msg = dict(modified["choices"][0]["message"])  # shallow copy
                    rc = str(reasoning_content).replace("\r\n", "\n")
                    original = msg.get("content") or ""
                    SEP = "\n\n---\n\n"
                    if original:
                        msg["content"] = "💭 " + rc + SEP + original
                    else:
                        msg["content"] = "💭 " + rc
                    msg.pop("reasoning_content", None)
                    modified["choices"][0]["message"] = msg
                    data = modified
            # Emit a single, well-formed payload depending on requested output_mode.
            try:
                if output_mode == "ndjson":
                    if ndjson_schema == "ollama":
                        # Convert a full, non-streaming response to a single Ollama-like message followed by done
                        content_text = ""
                        if isinstance(data, dict) and isinstance(data.get("choices"), list):
                            for ch in data["choices"]:
                                if isinstance(ch, dict) and isinstance(ch.get("message"), dict):
                                    frag = ch["message"].get("content")
                                    if isinstance(frag, str) and frag:
                                        content_text += frag
                        if content_text:
                            yield json.dumps({
                                "model": body.get("model"),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                                "message": {"role": "assistant", "content": content_text},
                                "done": False,
                            }) + "\n"
                        yield json.dumps({"model": body.get("model"), "done": True}) + "\n"
                    else:
                        if not isinstance(data, dict):
                            out = {"value": data}
                        else:
                            out = data
                        yield json.dumps(out) + "\n"
                else:
                    # SSE-like: send as a single data: event (no NDJSON wrapping)
                    yield f"data: {json.dumps(data)}\n\n"
            except Exception:
                # Fallback: emit raw JSON string
                try:
                    yield json.dumps(data) + ("\n" if output_mode == "ndjson" else "\n\n")
                except Exception:
                    # As a last resort emit a null placeholder
                    if output_mode == "ndjson":
                        yield json.dumps({"value": None}) + "\n"
                    else:
                        yield "data: null\n\n"


def _client_wants_stream(body: Dict[str, Any]) -> bool:
    """Interpret various client-provided stream flags strictly.

    Return True only for explicit true-like values (True, 'true', '1', 1, 'yes').
    Treat 'false' or any non-true-like value as False.
    """
    if body is None:
        return False
    s = body.get("stream")
    if isinstance(s, bool):
        return s
    if isinstance(s, (int, float)):
        return bool(s)
    if isinstance(s, str):
        return s.strip().lower() in ("1", "true", "yes")
    return False


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
        if THINKING_DEBUG:
            print("🔧 [TOOLS] Original tools:", json.dumps(body["tools"], indent=2))
        body["tools"] = patch_tools_array(body["tools"]) 
        if THINKING_DEBUG:
            print("🔧 [TOOLS] Patched tools:", json.dumps(body["tools"], indent=2))
    if VERBOSE:
        print("📤 [PAYLOAD] Full request payload:", json.dumps(body, indent=2))
    return body


# --- Lightweight request/response logging (enable with VERBOSE=1) ---
@app.before_request
def _dbg_before_request():
    if VERBOSE:
        g.__dict__["_start_ts"] = time.time()
        ua = request.headers.get("user-agent", "-")
        print(f"➡️  [REQ] {request.method} {request.path} UA={ua}")


@app.after_request
def _dbg_after_request(resp):
    if VERBOSE:
        try:
            start = g.__dict__.get("_start_ts")
            dur_ms = int((time.time() - start) * 1000) if start else -1
        except Exception:
            dur_ms = -1
        print(f"⬅️  [RESP] {request.method} {request.path} -> {resp.status_code} in {dur_ms}ms")
    return resp


# --- Ollama compatibility endpoints expected by Copilot ---

@app.route("/api/version", methods=["GET", "HEAD"])  # HEAD used by some clients
def api_version():
    # Return a simple OK + version so Copilot detects the provider
    # Keep shape compatible with Ollama's /api/version
    if VERBOSE:
        print("🔎 [/api/version] responding with status ok and version:", VERSION)
    return jsonify({"status": "ok", "version": VERSION or "0.0.0"})


@app.post("/api/chat")
def api_chat_compat():
    # Map Ollama-style /api/chat to OpenAI /v1/chat/completions with thinking support
    print(f"[POST] Proxying Copilot /api/chat -> /v1/chat/completions")
    if VERBOSE:
        print("[POST] Headers:", dict(request.headers))
    body = request.get_json(silent=True) or {}
    if isinstance(body.get("model"), str):
        original = body["model"]
        body["model"] = _resolve_model_id(original)
        if VERBOSE and body["model"] != original:
            print(f"🔁 [/api/chat] Resolved model alias '{original}' -> '{body['model']}'")
    body = _prepare_chat_body_and_log(body)

    upstream_url = f"{UPSTREAM}/v1/chat/completions"
    # If client requested streaming, use SSE generator path; otherwise proxy as JSON
    if _client_wants_stream(body):
        _increment_streams()
        try:
            accept = request.headers.get("Accept", "")
            ua = request.headers.get("User-Agent", "")
            output_mode = _select_output_mode(accept)
            if THINKING_DEBUG or VERBOSE:
                print(f"🔧 [STREAM] /api/chat selected output_mode={output_mode!r} Accept={accept!r} UA={ua!r} stream={body.get('stream')!r}")
            ndjson_schema = "ollama" if output_mode == "ndjson" else "openai"
            generator = _stream_chat_completion(upstream_url, body, output_mode=output_mode, ndjson_schema=ndjson_schema)

            def _cleanup_generator(gen):
                try:
                    for x in gen:
                        yield x
                finally:
                    _decrement_streams("stream end")

            mimetype = "application/x-ndjson" if output_mode == "ndjson" else "text/event-stream"
            resp = Response(stream_with_context(_cleanup_generator(generator)), mimetype=mimetype)
            # Advise caches that representation varies by Accept
            resp.headers["Vary"] = "Accept"
            # SSE-specific headers
            if output_mode == "sse":
                resp.headers["Cache-Control"] = "no-cache"
                resp.headers["X-Accel-Buffering"] = "no"
                resp.headers["Connection"] = "keep-alive"
            return resp
        except Exception as e:
            _decrement_streams("upstream error")
            print(f"[POST] Upstream request error for /api/chat:", e)
            return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502
    else:
        # Non-streaming: simply forward as JSON and return application/json without heartbeat lines
        if THINKING_DEBUG or VERBOSE:
            print(f"🔧 [STREAM] /api/chat non-streaming path (stream={body.get('stream')!r}) Accept={request.headers.get('Accept','')!r}")
        try:
            resp = requests.post(upstream_url, json=body, timeout=120)
            resp.raise_for_status()
            try:
                data = resp.json()
                return Response(json.dumps(data), status=resp.status_code, mimetype="application/json")
            except Exception:
                # If upstream returned non-JSON, return raw text
                return Response(resp.content, status=resp.status_code, mimetype="application/json")
        except Exception as e:
            print(f"[POST] Upstream request error for /api/chat:", e)
            return jsonify({"error": "upstream_connection_error", "message": str(e)}), 502


def _oai_models_to_ollama_tags(oai_models: Dict[str, Any]) -> Dict[str, Any]:
    """Adapt OpenAI-style /v1/models list to Ollama /api/tags shape minimally."""
    models_in = []
    if isinstance(oai_models, dict) and isinstance(oai_models.get("data"), list):
        models_in = oai_models["data"]
    out = {"models": []}
    def _add_caps(entry: Dict[str, Any]) -> Dict[str, Any]:
        caps = set(entry.get("capabilities") or [])
        # Expand capabilities to satisfy Copilot Ask/Agent checks
        caps.update(["completion", "chat", "embeddings", "tools", "planAndExecute"])  # help Copilot feature detection
        entry["capabilities"] = sorted(caps)
        return entry
    for m in models_in:
        mid = m.get("id") if isinstance(m, dict) else None
        created = m.get("created") if isinstance(m, dict) else None
        try:
            # created is seconds-epoch in OAI; convert to ISO8601 if present
            modified_at = (
                datetime.fromtimestamp(created, tz=timezone.utc).isoformat()
                if isinstance(created, (int, float)) else datetime.now(timezone.utc).isoformat()
            )
        except Exception:
            modified_at = datetime.now(timezone.utc).isoformat()
        alias = _friendly_model_name(mid or "unknown")
        _register_model_alias(alias, mid or "unknown")
        entry = {
            "name": alias,
            "model": mid or "unknown",
            "modified_at": modified_at,
            "size": 0,
            "digest": "",
            "details": {
                "parent_model": "",
                "format": "gguf",
                "family": "",
                "families": [],
                "parameter_size": "",
                "quantization_level": ""
            }
        }
        out["models"].append(_add_caps(entry))
    return out


@app.get("/api/tags")
def api_tags():
    # List local models; if upstream is llama.cpp (OpenAI), adapt /v1/models
    try:
        if VERBOSE:
            print(f"🔎 [/api/tags] Fetching upstream models from {UPSTREAM}/v1/models ...")
        r = requests.get(f"{UPSTREAM}/v1/models", timeout=15)
        r.raise_for_status()
        data = r.json()
        # Normalize into Ollama tags shape with friendly aliases and consistent capabilities
        MODEL_ALIASES.clear()
        models_out: List[Dict[str, Any]] = []
        if isinstance(data, dict) and isinstance(data.get("models"), list):
            src_models = data["models"]
            for e in src_models:
                if not isinstance(e, dict):
                    continue
                mid = e.get("id") or e.get("model") or e.get("name")
                if not isinstance(mid, str):
                    continue
                alias = _friendly_model_name(mid)
                _register_model_alias(alias, mid)
                modified_at = e.get("modified_at") or e.get("created")
                try:
                    if isinstance(modified_at, (int, float)):
                        modified_at = datetime.fromtimestamp(modified_at, tz=timezone.utc).isoformat()
                    elif not isinstance(modified_at, str):
                        modified_at = datetime.now(timezone.utc).isoformat()
                except Exception:
                    modified_at = datetime.now(timezone.utc).isoformat()
                details = e.get("details") or {}
                entry = {
                    "name": alias,
                    "model": mid,
                    "modified_at": modified_at,
                    "size": e.get("size", 0),
                    "digest": e.get("digest", ""),
                    "details": {
                        "parent_model": details.get("parent_model", ""),
                        "format": details.get("format", "gguf"),
                        "family": details.get("family", ""),
                        "families": details.get("families", []),
                        "parameter_size": details.get("parameter_size", ""),
                        "quantization_level": details.get("quantization_level", ""),
                    },
                }
                caps = set(e.get("capabilities") or [])
                caps.update(["completion", "chat", "embeddings", "tools", "planAndExecute"])  # inject
                entry["capabilities"] = sorted(caps)
                models_out.append(entry)
        else:
            adapted = _oai_models_to_ollama_tags(data)
            models_out = adapted.get("models", [])
        count = len(models_out)
        if VERBOSE:
            print(f"🔎 [/api/tags] Normalized models (models={count}) with aliases; capabilities injected")
        return jsonify({"models": models_out})
    except Exception as e:
        if VERBOSE:
            print("[GET] /api/tags upstream error:", e)
        return jsonify({"models": []}), 200


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


if __name__ == "__main__":
    _print_banner()
    # threaded=True to allow background timer and queued processing
    app.run(host=LISTEN_HOST, port=LISTEN_PORT, threaded=True)
