"""
ElevenLabs WebSocket TTS — Input Streaming
===========================================

Instead of waiting for the full LLM response and then calling the REST API,
this opens a persistent WebSocket to ElevenLabs and feeds text chunks
incrementally as they arrive from the LLM.

The server starts generating audio from the FIRST chunk, so audio begins
playing while the LLM is still thinking about the rest of the sentence.

Latency improvement: ~500-800ms saved (TTS starts generating alongside LLM).

Usage:
    async with ElevenLabsWSStream(voice_id, api_key) as tts:
        async for audio_chunk in tts.stream_text_chunks(text_generator):
            await send_audio_safe(audio_chunk)
"""

import asyncio
import base64
import json
import time
from typing import AsyncGenerator, Optional

import websockets
import websockets.exceptions


def __safe_log(msg) -> str:
    import builtins
    if msg is None: return "None"
    return builtins.str(msg)


class ElevenLabsWSStream:
    """
    WebSocket client for ElevenLabs text-to-speech input streaming.
    
    Opens a single WebSocket connection, feeds text chunks as they arrive
    from the LLM, and yields PCM16 audio chunks as they're generated.
    """

    WS_URL_TEMPLATE = "wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?output_format=pcm_16000"

    def __init__(
        self,
        voice_id: str,
        api_key: str,
        model_id: str = "eleven_flash_v2_5",
        stability: float = 0.5,
        similarity_boost: float = 0.75,
        style: float = 0.0,
        speed: float = 1.0,
        use_speaker_boost: bool = True,
    ):
        self._voice_id = voice_id
        self._api_key = api_key
        self._model_id = model_id
        self._stability = stability
        self._similarity_boost = similarity_boost
        self._style = style
        self._speed = speed
        self._use_speaker_boost = use_speaker_boost
        self._ws = None
        self._is_connected = False

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()

    async def connect(self):
        """Open WebSocket connection to ElevenLabs."""
        url = self.WS_URL_TEMPLATE.format(voice_id=self._voice_id)

        try:
            self._ws = await websockets.connect(
                url,
                additional_headers={"xi-api-key": self._api_key},
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
                max_size=2**22,  # 4MB max message (audio chunks can be large)
            )
            self._is_connected = True

            # Send BOS (Beginning of Stream) message with voice settings
            bos_message = {
                "text": " ",  # Initial space to prime the model
                "voice_settings": {
                    "stability": self._stability,
                    "similarity_boost": self._similarity_boost,
                    "style": self._style,
                    "use_speaker_boost": self._use_speaker_boost,
                    "speed": self._speed,
                },
                "generation_config": {
                    "chunk_length_schedule": [120, 160, 250, 290]  # Fast first chunks
                },
                "xi_api_key": self._api_key,
            }
            await self._ws.send(json.dumps(bos_message))
            print(f"[TTS WS] ✅ Connected to ElevenLabs WebSocket (voice={self._voice_id[:8]}...)")

        except Exception as e:
            print(f"[TTS WS] ❌ Connection failed: {__safe_log(e)}")
            self._is_connected = False
            raise

    async def stream_text_chunks(
        self,
        text_generator: AsyncGenerator[str, None],
        barge_in_check=None,
    ) -> AsyncGenerator[bytes, None]:
        """
        Feed text chunks from LLM into ElevenLabs and yield audio chunks.
        
        Args:
            text_generator: Async generator yielding text chunks from streaming LLM
            barge_in_check: Optional callable that returns True if barge-in is active
            
        Yields:
            PCM16 audio bytes
        """
        if not self._is_connected or not self._ws:
            print("[TTS WS] ⚠️ Not connected, cannot stream")
            return

        t0 = time.time()
        first_audio = True
        full_text = ""

        # Create a task to read audio responses
        audio_queue = asyncio.Queue()
        receive_task = asyncio.create_task(self._receive_audio(audio_queue))

        try:
            # Send text chunks as they arrive from the LLM
            async for text_chunk in text_generator:
                if barge_in_check and barge_in_check():
                    print("[TTS WS] 🛑 Barge-in detected, stopping text feed")
                    break

                full_text += text_chunk

                if text_chunk.strip():
                    # Send text chunk to ElevenLabs
                    msg = {
                        "text": text_chunk,
                        "try_trigger_generation": True,  # Generate audio ASAP
                    }
                    await self._ws.send(json.dumps(msg))

                # Drain any available audio chunks while sending text
                while not audio_queue.empty():
                    audio_data = audio_queue.get_nowait()
                    if audio_data is None:
                        break
                    if first_audio:
                        elapsed = (time.time() - t0) * 1000
                        print(f"[TTS WS] ⚡ First audio chunk in {elapsed:.0f}ms")
                        first_audio = False
                    yield audio_data

            # Send EOS (End of Stream) to flush remaining audio
            eos_message = {"text": ""}
            await self._ws.send(json.dumps(eos_message))

            # Collect remaining audio chunks
            while True:
                if barge_in_check and barge_in_check():
                    break

                try:
                    audio_data = await asyncio.wait_for(audio_queue.get(), timeout=5.0)
                    if audio_data is None:
                        break  # Stream complete
                    if first_audio:
                        elapsed = (time.time() - t0) * 1000
                        print(f"[TTS WS] ⚡ First audio chunk in {elapsed:.0f}ms")
                        first_audio = False
                    yield audio_data
                except asyncio.TimeoutError:
                    print("[TTS WS] ⚠️ Timeout waiting for remaining audio")
                    break

        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[TTS WS] ❌ Streaming error: {__safe_log(e)}")
        finally:
            receive_task.cancel()
            try:
                await receive_task
            except (asyncio.CancelledError, Exception):
                pass

        elapsed = (time.time() - t0) * 1000
        print(f"[TTS WS] ✅ Stream complete ({elapsed:.0f}ms, text='{full_text[:60]}...')")

    async def _receive_audio(self, audio_queue: asyncio.Queue):
        """Background task: receives audio chunks from ElevenLabs WebSocket."""
        try:
            async for raw_msg in self._ws:
                try:
                    msg = json.loads(raw_msg)

                    # Audio chunk
                    audio_b64 = msg.get("audio")
                    if audio_b64:
                        audio_bytes = base64.b64decode(audio_b64)
                        if len(audio_bytes) > 0:
                            # Ensure even byte count for PCM16
                            if len(audio_bytes) % 2 != 0:
                                audio_bytes = audio_bytes[:-1]
                            await audio_queue.put(audio_bytes)

                    # Check if stream is complete
                    if msg.get("isFinal"):
                        await audio_queue.put(None)  # Signal completion
                        return

                    # Alignment info (optional, for debugging)
                    if msg.get("alignment"):
                        pass  # Can log word timestamps if needed

                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[TTS WS] ⚠️ Receive error: {__safe_log(e)}")

        except websockets.exceptions.ConnectionClosed:
            pass
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[TTS WS] ❌ Receive loop error: {__safe_log(e)}")
        finally:
            # Signal completion in case of error
            try:
                await audio_queue.put(None)
            except Exception:
                pass

    async def disconnect(self):
        """Close the WebSocket connection."""
        self._is_connected = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        print("[TTS WS] 🔌 Disconnected")
