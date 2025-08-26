import os
import json
import time
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from flask import Flask, Response, jsonify, request, stream_with_context


# Application globals and configuration defaults (restore if missing)
app = Flask(__name__)

# Runtime configuration (environment-driven)
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "11434"))
UPSTREAM = os.environ.get("UPSTREAM", "http://10.66.0.7:8080")
THINKING_MODE = os.environ.get("THINKING_MODE", "default")
THINKING_DEBUG = os.environ.get("THINKING_DEBUG", "false").lower() in ("1", "true", "yes")
VERBOSE = os.environ.get("VERBOSE", "false").lower() in ("1", "true", "yes")
VERSION = "dev"
active_streams = 0


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


def process_queued_show_requests():
    # Placeholder for queued processing used in original project; no-op here
    if VERBOSE:
        print("[INFO] process_queued_show_requests invoked (no-op)")



def _stream_chat_completion(upstream_url: str, body: Dict[str, Any]):
    """Stream chat completions from upstream, injecting reasoning_content
    into visible content when THINKING_MODE == 'show_reasoning'. This
    reassembles SSE chunks, parses JSON payloads, and forwards events as
    SSE to the downstream client.
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }

    with requests.post(upstream_url, data=json.dumps(body), headers=headers, stream=True) as r:
        content_type = r.headers.get("content-type", "")
        vlog(f"[POST] Upstream response status: {r.status_code}")
        vlog(f"[POST] Upstream response headers: {dict(r.headers)}")

        # Initial heartbeats
        yield ": heartbeat\n\n"
        yield ": processing-prompt\n\n"

        is_streaming = "text/event-stream" in content_type

        tool_call_buffer: List[str] = []
        is_tool_call = False
        tool_call_detected = False
        done_received = False
        reasoning_prefix_emitted = False
        reasoning_pending_separator = False
        seen_reasoning = False
        pre_reasoning_content_buffer = ""

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
                        if is_tool_call:
                            tool_call_buffer.append(event_raw)
                        else:
                            yield event_raw
                        continue

                    event_payload = "\n".join(data_lines)

                    if event_payload.strip() == "[DONE]":
                        done_received = True
                        if is_tool_call:
                            tool_call_buffer.append("data: [DONE]\n\n")
                        else:
                            yield "data: [DONE]\n\n"
                        continue

                    if ("tool_call" in event_payload) or ("tool_calls" in event_payload):
                        is_tool_call = True
                        tool_call_detected = True
                        tool_call_buffer.append(event_raw)
                        continue

                    try:
                        obj = json.loads(event_payload)
                    except Exception:
                        if is_tool_call:
                            tool_call_buffer.append(event_raw)
                        else:
                            yield event_raw
                        continue

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

                    out_event = f"data: {out_payload}\n\n"
                    if is_tool_call:
                        tool_call_buffer.append(out_event)
                    else:
                        yield out_event

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
                    yield f"data: {json.dumps(flush_obj)}\n\n"
                except Exception:
                    pass
            if not done_received:
                yield "data: [DONE]\n\n"
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
            yield json.dumps(data)


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


@app.route("/v1/chat/completions", methods=["POST"])
@app.route("/chat/completions", methods=["POST"])
def chat_completions():
    print(f"[POST] Proxying chat completion: {request.path}")
    if VERBOSE:
        print("[POST] Headers:", dict(request.headers))
    body = request.get_json(silent=True) or {}

    body = _prepare_chat_body_and_log(body)
    _increment_streams()

    upstream_url = f"{UPSTREAM}{request.path}"
    try:
        generator = _stream_chat_completion(upstream_url, body)

        def _cleanup_generator(gen):
            try:
                for x in gen:
                    yield x
            finally:
                _decrement_streams("stream end")

        return Response(stream_with_context(_cleanup_generator(generator)), mimetype="text/event-stream")
    except Exception as e:
        _decrement_streams("upstream error")
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
    print(f"Proxy listening on http://0.0.0.0:{LISTEN_PORT} (all interfaces)")
    print(f"Upstream target: {UPSTREAM}")
    print(f"Configure VS Code to use: http://127.0.0.1:{LISTEN_PORT}")
    print("Instead of: http://127.0.0.1:11433\n")
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
    app.run(host="0.0.0.0", port=LISTEN_PORT, threaded=True)
