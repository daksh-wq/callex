"""
FasterWhisperSTT — Local GPU-Accelerated Streaming STT
=======================================================

Drop-in replacement for SSTModel2StreamingSTT that runs locally on
an NVIDIA GPU using faster-whisper. Zero network latency for STT.

Architecture:
  - Audio chunks fed via send_audio() are buffered in memory
  - Silero VAD detects speech boundaries (start/end)
  - On speech end, the buffered audio is transcribed by faster-whisper on GPU
  - Callbacks fire identically to SSTModel2StreamingSTT for seamless integration

Performance (RTX 5070):
  - Model load: ~2s (one-time at startup)
  - Transcription: ~50-150ms for 5s of audio (vs 300-800ms API round-trip)
  - VAD detection: <5ms per chunk
"""

import asyncio
import numpy as np
import time
import os
import tempfile
import wave
import io
from typing import Callable, Optional, Awaitable
from collections import deque


class FasterWhisperSTT:
    """
    Local GPU STT using faster-whisper with built-in VAD.
    
    Same interface as SSTModel2StreamingSTT so it's a drop-in replacement.
    Thread-safe: all public methods are safe to call from the asyncio event loop.
    """

    # VAD Configuration
    VAD_THRESHOLD = 0.45          # Silero VAD confidence threshold for speech
    SPEECH_PAD_MS = 300           # Padding around speech (ms)
    MIN_SPEECH_MS = 250           # Minimum speech duration to transcribe (ms)
    SILENCE_TIMEOUT_MS = 600      # Silence duration to trigger end-of-speech (ms)
    MAX_SPEECH_MS = 30000         # Maximum single utterance length (30s)

    def __init__(
        self,
        on_transcript: Callable[[str], Awaitable[None]] = None,
        on_speech_started: Optional[Callable[[], Awaitable[None]]] = None,
        on_speech_ended: Optional[Callable[[], Awaitable[None]]] = None,
        model_size: str = "distil-large-v3",
        language: str = "hi",
        sample_rate: int = 16000,
        compute_type: str = "float16",
        device: str = "cuda",
        **kwargs,  # Accept and ignore extra kwargs for compatibility
    ):
        self._on_transcript = on_transcript
        self._on_speech_started = on_speech_started
        self._on_speech_ended = on_speech_ended
        self._model_size = model_size
        self._language = language
        self._sample_rate = sample_rate
        self._compute_type = compute_type
        self._device = device

        self._model = None
        self._vad_model = None
        self._is_connected = False
        self._connect_time: Optional[float] = None

        # Audio state
        self._audio_buffer = []        # PCM16 chunks during speech
        self._is_speaking = False
        self._speech_start_time = 0.0
        self._last_speech_time = 0.0
        self._total_speech_bytes = 0

        # VAD state
        self._vad_buffer = deque(maxlen=512)  # Rolling audio for VAD
        self._vad_triggered = False

        # Background processing
        self._process_task: Optional[asyncio.Task] = None
        self._audio_queue: asyncio.Queue = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @property
    def is_connected(self) -> bool:
        return self._is_connected and self._model is not None

    async def connect(self):
        """Load the faster-whisper model onto the GPU. One-time ~2s init."""
        t0 = time.time()
        print(f"[WHISPER STT] Loading faster-whisper model '{self._model_size}' on {self._device}...")

        try:
            # Import faster-whisper
            from faster_whisper import WhisperModel

            # Load model in a thread to not block the event loop
            def _load():
                return WhisperModel(
                    self._model_size,
                    device=self._device,
                    compute_type=self._compute_type,
                    download_root=os.path.join(os.getcwd(), "models", "whisper"),
                )

            self._model = await asyncio.to_thread(_load)

            # Load Silero VAD for speech boundary detection
            import torch
            self._vad_model, vad_utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=True
            )
            self._vad_get_speech = vad_utils[4]  # get_speech_timestamps

            self._is_connected = True
            self._connect_time = time.time()
            self._loop = asyncio.get_running_loop()
            self._audio_queue = asyncio.Queue()

            # Start background processor
            self._process_task = asyncio.create_task(self._process_loop())

            elapsed = time.time() - t0
            print(f"[WHISPER STT] ✅ Model loaded in {elapsed:.1f}s ({self._device}, {self._compute_type})")

        except ImportError as e:
            print(f"[WHISPER STT] ❌ faster-whisper not installed: {e}")
            print(f"[WHISPER STT] Install with: pip install faster-whisper")
            raise
        except Exception as e:
            print(f"[WHISPER STT] ❌ Failed to load model: {e}")
            import traceback
            traceback.print_exc()
            raise

    def send_audio(self, pcm16_bytes: bytes):
        """
        Feed PCM16 audio chunks. Non-blocking — queues for background processing.
        Same interface as SSTModel2StreamingSTT.send_audio().
        """
        if not self._is_connected or self._model is None:
            return
        if not pcm16_bytes or len(pcm16_bytes) == 0:
            return

        try:
            if self._audio_queue and self._loop:
                self._loop.call_soon_threadsafe(
                    self._audio_queue.put_nowait, pcm16_bytes
                )
        except Exception as e:
            print(f"[WHISPER STT] ⚠️ send_audio error: {e}")

    def send_flush(self):
        """Force-flush any buffered audio for transcription."""
        if not self._is_connected:
            return
        try:
            if self._audio_queue and self._loop:
                self._loop.call_soon_threadsafe(
                    self._audio_queue.put_nowait, b"__FLUSH__"
                )
        except Exception:
            pass

    async def _process_loop(self):
        """Background task: processes audio chunks, detects speech, transcribes."""
        print("[WHISPER STT] 🔄 Background processor started")

        while self._is_connected:
            try:
                # Get audio chunk (1s timeout to allow periodic checks)
                try:
                    chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    # Check if speech timed out (user stopped speaking)
                    if self._is_speaking:
                        silence_ms = (time.time() - self._last_speech_time) * 1000
                        if silence_ms > self.SILENCE_TIMEOUT_MS:
                            await self._end_speech()
                    continue

                # Handle flush signal
                if chunk == b"__FLUSH__":
                    if self._is_speaking and self._audio_buffer:
                        await self._end_speech()
                    continue

                # Convert PCM16 bytes to float32 numpy array for VAD
                audio_int16 = np.frombuffer(chunk, dtype=np.int16)
                audio_float = audio_int16.astype(np.float32) / 32768.0

                # Run VAD on this chunk
                is_speech = await self._check_vad(audio_float)

                now = time.time()

                if is_speech:
                    if not self._is_speaking:
                        # Speech just started
                        self._is_speaking = True
                        self._speech_start_time = now
                        self._audio_buffer = []
                        self._total_speech_bytes = 0
                        print(f"[WHISPER STT] 🎤 Speech started")
                        if self._on_speech_started:
                            await self._on_speech_started()

                    # Buffer the audio
                    self._audio_buffer.append(chunk)
                    self._total_speech_bytes += len(chunk)
                    self._last_speech_time = now

                    # Safety: cap at MAX_SPEECH_MS
                    speech_duration_ms = (now - self._speech_start_time) * 1000
                    if speech_duration_ms > self.MAX_SPEECH_MS:
                        print(f"[WHISPER STT] ⚠️ Max speech duration reached ({self.MAX_SPEECH_MS}ms), forcing transcription")
                        await self._end_speech()

                else:
                    # No speech detected
                    if self._is_speaking:
                        # Still buffer silence (for natural boundaries)
                        self._audio_buffer.append(chunk)
                        self._total_speech_bytes += len(chunk)

                        # Check silence timeout
                        silence_ms = (now - self._last_speech_time) * 1000
                        if silence_ms > self.SILENCE_TIMEOUT_MS:
                            await self._end_speech()

            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[WHISPER STT] ⚠️ Process loop error: {e}")

        print("[WHISPER STT] 🔄 Background processor stopped")

    async def _check_vad(self, audio_float: np.ndarray) -> bool:
        """Run Silero VAD on audio chunk. Returns True if speech detected."""
        try:
            import torch

            # Silero VAD expects 512 samples at 16kHz (32ms)
            # Process in 512-sample windows
            self._vad_buffer.extend(audio_float.tolist())

            if len(self._vad_buffer) < 512:
                return self._vad_triggered

            # Take last 512 samples
            vad_input = np.array(list(self._vad_buffer))[-512:]
            tensor = torch.FloatTensor(vad_input)

            # Run VAD
            confidence = self._vad_model(tensor, self._sample_rate).item()

            self._vad_triggered = confidence > self.VAD_THRESHOLD
            return self._vad_triggered

        except Exception as e:
            # Fallback: simple energy-based VAD
            energy = np.sqrt(np.mean(audio_float ** 2))
            return energy > 0.01

    async def _end_speech(self):
        """Speech ended — transcribe the buffered audio."""
        if not self._audio_buffer:
            self._is_speaking = False
            return

        speech_duration_ms = (time.time() - self._speech_start_time) * 1000

        # Skip very short speech (noise/clicks)
        if speech_duration_ms < self.MIN_SPEECH_MS:
            print(f"[WHISPER STT] ⏭️ Skipping too-short speech ({speech_duration_ms:.0f}ms)")
            self._is_speaking = False
            self._audio_buffer = []
            return

        # Fire speech_ended callback IMMEDIATELY (don't wait for transcription)
        self._is_speaking = False
        if self._on_speech_ended:
            await self._on_speech_ended()

        # Concatenate all buffered audio
        all_audio = b"".join(self._audio_buffer)
        self._audio_buffer = []

        audio_duration_s = len(all_audio) / (self._sample_rate * 2)  # 2 bytes per sample
        print(f"[WHISPER STT] 🔄 Transcribing {audio_duration_s:.1f}s of speech...")

        t0 = time.time()

        try:
            # Transcribe in thread pool (GPU compute, don't block event loop)
            transcript = await asyncio.to_thread(
                self._transcribe_audio, all_audio
            )

            elapsed_ms = (time.time() - t0) * 1000
            print(f"[WHISPER STT] 📝 Transcript: '{transcript[:80]}' ({elapsed_ms:.0f}ms, audio={audio_duration_s:.1f}s)")

            if transcript and self._on_transcript:
                await self._on_transcript(transcript)

        except Exception as e:
            print(f"[WHISPER STT] ❌ Transcription error: {e}")
            import traceback
            traceback.print_exc()

    def _transcribe_audio(self, pcm16_bytes: bytes) -> str:
        """
        Transcribe PCM16 audio bytes using faster-whisper.
        Runs on GPU in a thread pool. Returns transcript text.
        """
        # Convert PCM16 bytes to float32 numpy array
        audio_int16 = np.frombuffer(pcm16_bytes, dtype=np.int16)
        audio_float = audio_int16.astype(np.float32) / 32768.0

        # Map language codes to Whisper language codes
        lang_map = {
            "hi-IN": "hi",
            "en-IN": "en",
            "en-US": "en",
            "en-GB": "en",
            "gu-IN": "gu",
            "mr-IN": "mr",
            "ta-IN": "ta",
            "te-IN": "te",
            "bn-IN": "bn",
            "kn-IN": "kn",
        }
        whisper_lang = lang_map.get(self._language, self._language)
        # If language is still in xx-XX format, take just the first part
        if "-" in whisper_lang:
            whisper_lang = whisper_lang.split("-")[0]

        # Run faster-whisper transcription
        segments, info = self._model.transcribe(
            audio_float,
            language=whisper_lang,
            beam_size=1,           # Greedy decoding for speed
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=False,      # We already did VAD
            word_timestamps=False, # Skip for speed
        )

        # Collect all segment texts
        texts = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                texts.append(text)

        return " ".join(texts).strip()

    async def disconnect(self):
        """Clean shutdown."""
        self._is_connected = False

        # Transcribe any remaining audio
        if self._is_speaking and self._audio_buffer:
            try:
                await self._end_speech()
            except Exception:
                pass

        if self._process_task:
            self._process_task.cancel()
            try:
                await self._process_task
            except (asyncio.CancelledError, Exception):
                pass
            self._process_task = None

        # Free GPU memory
        if self._model:
            del self._model
            self._model = None
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

        duration = time.time() - self._connect_time if self._connect_time else 0
        print(f"[WHISPER STT] 🔌 Disconnected (session duration: {duration:.0f}s)")


# ── Singleton Model Manager ──────────────────────────────────────────────────
# Load the model ONCE at server startup, share across all calls.
# This avoids 2s model-load delay on every single phone call.

_global_whisper_model = None
_global_whisper_lock = asyncio.Lock() if asyncio.get_event_loop().is_running() else None


async def get_shared_whisper_model(model_size="distil-large-v3", device="cuda", compute_type="float16"):
    """
    Get or create the shared faster-whisper model instance.
    Thread-safe singleton — model loads once, shared by all concurrent calls.
    """
    global _global_whisper_model, _global_whisper_lock

    if _global_whisper_lock is None:
        _global_whisper_lock = asyncio.Lock()

    async with _global_whisper_lock:
        if _global_whisper_model is not None:
            return _global_whisper_model

        print(f"[WHISPER STT] 🚀 Loading shared model (first call)...")
        try:
            from faster_whisper import WhisperModel

            def _load():
                return WhisperModel(
                    model_size,
                    device=device,
                    compute_type=compute_type,
                    download_root=os.path.join(os.getcwd(), "models", "whisper"),
                )

            _global_whisper_model = await asyncio.to_thread(_load)
            print(f"[WHISPER STT] ✅ Shared model loaded successfully")
            return _global_whisper_model

        except Exception as e:
            print(f"[WHISPER STT] ❌ Failed to load shared model: {e}")
            raise
