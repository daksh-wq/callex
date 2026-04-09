"""
SarvamStreamingSTT — Production WebSocket Streaming STT Client
================================================================

Maintains a persistent WebSocket connection to Sarvam AI's real-time
speech-to-text API (wss://api.sarvam.ai/speech-to-text/ws).

Architecture:
  - Audio is sent as base64-encoded PCM16 JSON messages
  - Server returns transcript events, speech_start, and speech_end signals
  - Callbacks fire on the asyncio event loop for zero-blocking integration

Usage:
    stt = SarvamStreamingSTT(
        api_key="...",
        on_transcript=my_handler,      # async def (text: str)
        on_speech_started=my_handler,  # async def ()
        on_speech_ended=my_handler,    # async def ()
    )
    await stt.connect()
    stt.send_audio(pcm16_bytes)
    await stt.disconnect()
"""

import asyncio
import base64
import json
import time
from typing import Callable, Optional, Awaitable

import websockets
import websockets.exceptions


class SarvamStreamingSTT:
    """
    Production WebSocket client for Sarvam AI Streaming STT.
    
    Thread-safe: all public methods are safe to call from the asyncio event loop.
    Audio sending is non-blocking (fire-and-forget into the WS send buffer).
    """

    WS_URL = "wss://api.sarvam.ai/speech-to-text/ws"
    MAX_RECONNECT_ATTEMPTS = 3
    RECONNECT_DELAY = 1.0  # seconds between reconnect attempts

    def __init__(
        self,
        api_key: str,
        on_transcript: Callable[[str], Awaitable[None]],
        on_speech_started: Optional[Callable[[], Awaitable[None]]] = None,
        on_speech_ended: Optional[Callable[[], Awaitable[None]]] = None,
        model: str = "saaras:v3",
        language: str = "hi-IN",
        mode: str = "transcribe",
        sample_rate: int = 16000,
        vad_signals: bool = True,
        high_vad_sensitivity: bool = True,
    ):
        self._api_key = api_key
        self._on_transcript = on_transcript
        self._on_speech_started = on_speech_started
        self._on_speech_ended = on_speech_ended
        self._model = model
        self._language = language
        self._mode = mode
        self._sample_rate = sample_rate
        self._vad_signals = vad_signals
        self._high_vad_sensitivity = high_vad_sensitivity

        self._ws = None
        self._receive_task: Optional[asyncio.Task] = None
        self._is_connected = False
        self._connect_time: Optional[float] = None
        self._reconnect_count = 0

    @property
    def is_connected(self) -> bool:
        return self._is_connected and self._ws is not None

    async def connect(self):
        """Establish the WebSocket connection to Sarvam streaming API."""
        try:
            params = [
                f"model={self._model}",
                f"language_code={self._language}",
                f"mode={self._mode}",
                f"sample_rate={self._sample_rate}",
                f"encoding=pcm_s16le",
                f"flush_signal=true"
            ]
            if self._vad_signals:
                params.append("vad_signals=true")
            if self._high_vad_sensitivity:
                params.append("high_vad_sensitivity=true")

            url = f"{self.WS_URL}?{'&'.join(params)}"

            headers = {
                "Api-Subscription-Key": self._api_key,
            }

            self._ws = await websockets.connect(
                url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5,
                max_size=2**20,  # 1MB max message
            )
            self._is_connected = True
            self._connect_time = time.time()
            self._reconnect_count = 0

            # Start background receiver
            self._receive_task = asyncio.create_task(self._receive_loop())
            print(f"[SARVAM WS] ✅ Connected to streaming STT ({self._model}, {self._language})")

        except Exception as e:
            print(f"[SARVAM WS] ❌ Connection failed: {e}")
            self._is_connected = False
            raise

    async def _receive_loop(self):
        """Background task: reads messages from Sarvam WS and dispatches callbacks."""
        try:
            async for raw_msg in self._ws:
                try:
                    msg = json.loads(raw_msg)
                    msg_type = msg.get("type", "")

                    if msg_type == "speech_start":
                        if self._on_speech_started:
                            await self._on_speech_started()

                    elif msg_type == "speech_end":
                        if self._on_speech_ended:
                            await self._on_speech_ended()

                    elif msg_type == "data":
                        # Transcript result
                        data = msg.get("data", {})
                        transcript = data.get("transcript", "").strip()
                        if transcript:
                            metrics = data.get("metrics", {})
                            latency = metrics.get("processing_latency", 0)
                            audio_dur = metrics.get("audio_duration", 0)
                            print(f"[SARVAM WS] 📝 Transcript: '{transcript[:80]}' (latency={latency:.2f}s, audio={audio_dur:.2f}s)")
                            await self._on_transcript(transcript)

                    elif msg_type == "error":
                        error_data = msg.get("data", {})
                        error_msg = error_data.get("message", str(msg))
                        print(f"[SARVAM WS] ⚠️ Server error: {error_msg}")

                    # Silently ignore unknown message types (heartbeats, etc.)

                except json.JSONDecodeError:
                    print(f"[SARVAM WS] ⚠️ Non-JSON message: {str(raw_msg)[:100]}")
                except Exception as e:
                    print(f"[SARVAM WS] ⚠️ Message handler error: {e}")

        except websockets.exceptions.ConnectionClosed as e:
            print(f"[SARVAM WS] 🔌 Connection closed: {e}")
            self._is_connected = False
            # Attempt reconnect
            await self._try_reconnect()

        except asyncio.CancelledError:
            # Clean shutdown — don't reconnect
            raise

        except Exception as e:
            print(f"[SARVAM WS] ❌ Receive loop error: {e}")
            self._is_connected = False
            await self._try_reconnect()

    async def _try_reconnect(self):
        """Attempt to reconnect after unexpected disconnect."""
        if self._reconnect_count >= self.MAX_RECONNECT_ATTEMPTS:
            print(f"[SARVAM WS] ❌ Max reconnect attempts ({self.MAX_RECONNECT_ATTEMPTS}) reached. Giving up.")
            return

        self._reconnect_count += 1
        print(f"[SARVAM WS] 🔄 Reconnect attempt {self._reconnect_count}/{self.MAX_RECONNECT_ATTEMPTS}...")
        await asyncio.sleep(self.RECONNECT_DELAY)

        try:
            await self.connect()
            print(f"[SARVAM WS] ✅ Reconnected successfully")
        except Exception as e:
            print(f"[SARVAM WS] ❌ Reconnect failed: {e}")

    def send_audio(self, pcm16_bytes: bytes):
        """
        Send PCM16 audio wrapped as WAV to Sarvam streaming STT.
        
        Non-blocking: schedules the send on the event loop.
        Safe to call from the audio processing hot path.
        """
        if not self._is_connected or self._ws is None:
            return

        try:
            b64_data = base64.b64encode(pcm16_bytes).decode('ascii')
            message = json.dumps({
                "audio": {
                    "data": b64_data,
                    "is_last": False,
                }
            })
            asyncio.create_task(self._safe_send(message))
        except Exception as e:
            print(f"[SARVAM WS] ⚠️ send_audio error: {e}")

    def send_flush(self):
        """Send flush signal to finalize transcript."""
        if not self._is_connected or self._ws is None:
            return
        try:
            message = json.dumps({"flush": True})
            asyncio.create_task(self._safe_send(message))
        except Exception as e:
            print(f"[SARVAM WS] ⚠️ send_flush error: {e}")

    async def _safe_send(self, message: str):
        """Send a message with error handling (no crash on closed socket)."""
        try:
            if self._ws and self._is_connected:
                await self._ws.send(message)
        except websockets.exceptions.ConnectionClosed:
            self._is_connected = False
        except Exception as e:
            print(f"[SARVAM WS] ⚠️ Send failed: {e}")
            self._is_connected = False

    async def disconnect(self):
        """Cleanly disconnect from Sarvam streaming API."""
        self._is_connected = False

        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except (asyncio.CancelledError, Exception):
                pass
            self._receive_task = None

        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        duration = time.time() - self._connect_time if self._connect_time else 0
        print(f"[SARVAM WS] 🔌 Disconnected (session duration: {duration:.0f}s)")
