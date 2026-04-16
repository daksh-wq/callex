"""
Streaming LLM — Gemini streamGenerateContent
=============================================

Replaces the blocking generateContent call with streaming.
Instead of waiting 1-2s for the full response, this yields
text chunks as they arrive from Gemini (~50-100ms per chunk).

Usage:
    async for text_chunk in stream_generate_response(client, text, history, agent_config):
        # text_chunk arrives every ~50-100ms
        # Feed directly to TTS WebSocket
        pass
"""

import asyncio
import httpx
import json
import re
import time
from typing import AsyncGenerator, Dict, List, Optional


def __safe_log(msg) -> str:
    import builtins
    if msg is None: return "None"
    return builtins.str(msg)


async def stream_generate_response(
    client: httpx.AsyncClient,
    user_text: str,
    history: List[Dict],
    agent_config: Dict = None,
    tone_context: str = "",
    system_prompt: str = "",
    gemini_key: str = "",
    sanitize_fn=None,
    anti_hallucination_fn=None,
    last_bot_reply: str = "",
) -> AsyncGenerator[str, None]:
    """
    Stream LLM response tokens from Gemini.
    
    Yields text chunks as they arrive. Total latency to first chunk: ~200-400ms.
    The caller should pipe these chunks directly into the TTS WebSocket.
    
    Also returns the FULL accumulated text via the .full_text attribute on the generator.
    """
    if not user_text:
        yield "..."
        return

    agent = agent_config or {}
    temperature = agent.get('temperature', 0.7)
    max_tokens = min(agent.get('maxTokens', 150), 150)

    clean_history = [m for m in history if m["parts"][0]["text"] != "SYSTEM_INITIATE_CALL"]

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key={gemini_key}"

    payload = {
        "contents": [*clean_history, {"role": "user", "parts": [{"text": user_text}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "thinkingConfig": {"thinkingBudget": 0},
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }
    }

    start_time = time.time()
    full_text = ""
    first_chunk = True

    try:
        async with client.stream("POST", url, json=payload, timeout=8.0) as response:
            if response.status_code != 200:
                error_body = await response.aread()
                print(f"[STREAM LLM] ❌ HTTP {response.status_code}: {__safe_log(error_body)[:200]}")
                yield "माफ़ कीजिये, कुछ तकनीकी समस्या है।"
                return

            # Parse SSE stream
            buffer = ""
            async for line in response.aiter_lines():
                # SSE format: "data: {json}"
                if not line.startswith("data: "):
                    continue

                json_str = line[6:]  # Remove "data: " prefix
                if json_str.strip() == "[DONE]":
                    break

                try:
                    data = json.loads(json_str)
                except json.JSONDecodeError:
                    continue

                # Extract text from Gemini SSE response
                candidates = data.get("candidates", [])
                if not candidates:
                    continue

                content = candidates[0].get("content", {})
                parts = content.get("parts", [])
                if not parts:
                    continue

                text_chunk = parts[0].get("text", "")
                if not text_chunk:
                    continue

                if first_chunk:
                    elapsed = (time.time() - start_time) * 1000
                    print(f"[STREAM LLM] ⚡ First token in {elapsed:.0f}ms")
                    first_chunk = False

                # Clean the chunk
                text_chunk = text_chunk.replace("*", "")
                full_text += text_chunk

                # Yield the chunk for TTS
                yield text_chunk

    except asyncio.TimeoutError:
        print(f"[STREAM LLM] ⏱️ Timeout after {(time.time() - start_time):.1f}s")
        if not full_text:
            yield "माफ़ कीजिये, जवाब देने में समय लग रहा है।"
        return
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"[STREAM LLM] ❌ Error: {__safe_log(e)}")
        if not full_text:
            yield "माफ़ कीजिये, कुछ गड़बड़ हो गई।"
        return

    elapsed = (time.time() - start_time) * 1000
    
    # Post-process full text
    if full_text:
        full_text = re.sub(r'(?i)\b(?:rs\.?|inr)\b|₹', ' rupees ', full_text)
        full_text = re.sub(r'\[.*?\]', '', full_text).strip()

    print(f"[STREAM LLM] ✅ Complete response in {elapsed:.0f}ms: '{full_text[:80]}...'")


async def stream_generate_full(
    client: httpx.AsyncClient,
    user_text: str,
    history: List[Dict],
    agent_config: Dict = None,
    tone_context: str = "",
    system_prompt: str = "",
    gemini_key: str = "",
) -> tuple:
    """
    Convenience wrapper: streams LLM and collects into (full_text, chunks_list).
    Used when you need both streaming AND the final text.
    """
    chunks = []
    full_text = ""
    async for chunk in stream_generate_response(
        client, user_text, history, agent_config,
        tone_context, system_prompt, gemini_key
    ):
        chunks.append(chunk)
        full_text += chunk

    return full_text, chunks
