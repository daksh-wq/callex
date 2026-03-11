import base64
import asyncio
import httpx
import struct
import json
import time
import re
import wave  # For recording
import numpy as np
from collections import deque
from typing import List, Dict, AsyncGenerator, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from scipy import signal
from scipy.fft import rfft, rfftfreq
import os
import sys
import shutil
import boto3
from botocore.exceptions import NoCredentialsError
import webrtcvad

# ─── Updated imports for new modular structure ───
from app.utils.logger import tracker          # Database logging
from app.core.database import get_db_session, update_call_outcome
from app.audio.classifier import SoundEventClassifier
from app.audio.vad_silero import SileroVADFilter
from app.audio.semantic import SemanticFilter
from app.audio.speaker_verifier import SpeakerVerifier
from app.core.agent_loader import load_agent, get_default_agent, get_active_prompt, FALLBACK_AGENT

# Force unbuffered output for PM2/Systemd logging
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# ─────────  CONFIGURATION (Loaded from config file) ─────────

from app.core.config_manager import get_config_manager

# Load configuration at startup
config_mgr = get_config_manager()
bot_config = config_mgr.load_config()

# API Keys (from config)
GENARTML_SERVER_KEY = bot_config.api_credentials.server_key
GENARTML_SECRET_KEY = bot_config.api_credentials.secret_key
GENARTML_VOICE_ID = bot_config.api_credentials.voice_id

# Audio Configuration
SAMPLE_RATE = 16000  # 16kHz (High Quality)
MAX_BUFFER_SECONDS = 5

# VAD Configuration (from config)
MIN_SPEECH_DURATION = bot_config.vad.min_speech_duration
SILENCE_TIMEOUT = bot_config.vad.silence_timeout
INTERRUPTION_THRESHOLD_DB = bot_config.vad.interruption_threshold_db

# Noise Suppression Configuration (from config)
NOISE_GATE_DB = bot_config.vad.noise_gate_db
SPECTRAL_FLATNESS_THRESHOLD = bot_config.vad.spectral_flatness_threshold
VOICE_FREQ_MIN = 80           # Hz - Capture lower voice frequencies
VOICE_FREQ_MAX = 4000         # Hz - Capture wider voice range
ADAPTIVE_LEARNING_FRAMES = 8  # Faster noise floor learning

# Silero VAD Configuration (PRODUCTION)
USE_SILERO_VAD = True
SILERO_CONFIDENCE_THRESHOLD = 0.65
CONTINUOUS_VAD_CHECK = True
SEMANTIC_MIN_LENGTH = 3

# Speaker Verification Configuration
SPEAKER_SIMILARITY_THRESHOLD = 0.75
SPEAKER_ENROLLMENT_SECONDS = 3.0
BARGE_IN_CONFIRM_MS = 300  # milliseconds of continuous speech required before barge-in

# Voice Settings (from config)
VOICE_SPEED = bot_config.voice.speed
VOICE_STABILITY = bot_config.voice.stability
VOICE_SIMILARITY_BOOST = bot_config.voice.similarity_boost
VOICE_STYLE = bot_config.voice.style

print(f"[CONFIG] Loaded from bot_config.json")
print(f"[CONFIG] VAD: SILENCE_TIMEOUT={SILENCE_TIMEOUT}s, THRESHOLD={INTERRUPTION_THRESHOLD_DB}dB")
print(f"[CONFIG] Voice: speed={VOICE_SPEED}x, stability={VOICE_STABILITY}")

# History Management
MAX_HISTORY_LENGTH = 12

# Retry Configuration
MAX_RETRIES = 2
RETRY_DELAY = 0.3

# FreeSWITCH ESL Configuration
ESL_HOST = "127.0.0.1"
ESL_PORT = 8021
ESL_PASSWORD = "ClueCon"

# AWS S3 Configuration (loaded from environment variables)
AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
AWS_BUCKET_NAME = os.getenv("AWS_BUCKET_NAME", "callex-callrecording-lakhu")

# ACTIVE_SCRIPT_ID is no longer used — agent_id from FreeSWITCH determines the agent

# Project root & Cache dir (relative to project root, not app/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(PROJECT_ROOT, "cache")


async def freeswitch_hangup(uuid: str):
    """Terminates a call by UUID using FreeSWITCH Event Socket"""
    try:
        reader, writer = await asyncio.open_connection(ESL_HOST, ESL_PORT)
        await reader.readuntil(b"Content-Type: auth/request\n\n")
        writer.write(f"auth {ESL_PASSWORD}\n\n".encode())
        await writer.drain()
        auth_response = await reader.readuntil(b"\n\n")
        if b"+OK" not in auth_response:
            print(f"[ESL Error] Authentication failed: {auth_response}")
            writer.close()
            await writer.wait_closed()
            return
        cmd = f"api uuid_kill {uuid}\n\n"
        writer.write(cmd.encode())
        await writer.drain()
        response = await reader.readuntil(b"\n\n")
        print(f"[ESL] Hangup sent for {uuid}. Response: {response.decode().strip()}")
        writer.close()
        await writer.wait_closed()
    except Exception as e:
        print(f"[ESL Error] Failed to hang up call {uuid}: {e}")


async def freeswitch_command(cmd: str):
    """Sends a generic command to FreeSWITCH via ESL"""
    try:
        reader, writer = await asyncio.open_connection(ESL_HOST, ESL_PORT)
        await reader.readuntil(b"Content-Type: auth/request\n\n")
        writer.write(f"auth {ESL_PASSWORD}\n\n".encode())
        await writer.drain()
        auth_response = await reader.readuntil(b"\n\n")
        if b"+OK" not in auth_response:
            writer.close()
            await writer.wait_closed()
            return None
        writer.write(f"{cmd}\n\n".encode())
        await writer.drain()
        response = await reader.readuntil(b"\n\n")
        writer.close()
        await writer.wait_closed()
        return response.decode().strip()
    except Exception as e:
        print(f"[ESL Error] Command failed ({cmd}): {e}")
        return None


def upload_to_s3(file_path: str, object_name: str = None) -> Optional[str]:
    """Upload a file to S3 and return the public URL"""
    if object_name is None:
        object_name = os.path.basename(file_path)
    try:
        s3_client = boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY,
            aws_secret_access_key=AWS_SECRET_KEY,
            region_name=AWS_REGION
        )
        print(f"[S3] Uploading {object_name}...")
        s3_client.upload_file(
            file_path,
            AWS_BUCKET_NAME,
            object_name,
            ExtraArgs={'ContentType': 'audio/wav'}
        )
        url = f"https://{AWS_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{object_name}"
        print(f"[S3] Upload Successful: {url}")
        return url
    except Exception as e:
        print(f"[S3 Error] Upload failed: {e}")
        return None


class LocalRecorder:
    """Records audio from WebSocket streams (customer + bot) into a WAV file"""
    def __init__(self, call_uuid: str):
        self.call_uuid = call_uuid
        self.filepath = f"/tmp/call_{call_uuid}.wav"
        self.wav_file = None
        self.frames_written = 0
        self.customer_chunks = 0
        self.bot_chunks = 0
        try:
            self.wav_file = wave.open(self.filepath, 'wb')
            self.wav_file.setnchannels(1)
            self.wav_file.setsampwidth(2)
            self.wav_file.setframerate(SAMPLE_RATE)
            print(f"[LOCAL RECORDING] Started: {self.filepath}")
        except Exception as e:
            print(f"[LOCAL RECORDING ERROR] Failed to create file: {e}")

    def write_audio(self, pcm_bytes: bytes, source: str = "unknown"):
        if self.wav_file:
            try:
                self.wav_file.writeframes(pcm_bytes)
                self.frames_written += len(pcm_bytes) // 2
                if source == "customer":
                    self.customer_chunks += 1
                elif source == "bot":
                    self.bot_chunks += 1
            except Exception as e:
                print(f"[LOCAL RECORDING ERROR] Write failed: {e}")

    def close(self) -> str:
        if self.wav_file:
            try:
                self.wav_file.close()
                duration = self.frames_written / SAMPLE_RATE
                print(f"[LOCAL RECORDING] Saved: {self.filepath} ({duration:.1f}s)")
                print(f"[LOCAL RECORDING] Customer chunks: {self.customer_chunks}, Bot chunks: {self.bot_chunks}")
                return self.filepath
            except Exception as e:
                print(f"[LOCAL RECORDING ERROR] Close failed: {e}")
        return None


async def ensure_opener_cache(agent_id: str = None, opener_text: str = None, voice_id: str = None):
    """Ensure opener audio is cached for an agent"""
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)

    if not agent_id or not opener_text:
        print("[CACHE] No agent/opener provided, skipping cache")
        return

    safe_id = agent_id.replace('-', '_')[:32]
    filename = f"{safe_id}_opener.pcm"
    filepath = os.path.join(CACHE_DIR, filename)

    if os.path.exists(filepath):
        print(f"[CACHE] Opener found: {filepath}")
        return

    print(f"[CACHE] Generating opener for agent {agent_id}...")
    async with httpx.AsyncClient() as client:
        with open(filepath, "wb") as f:
            async for chunk in tts_stream_generate(client, opener_text, voice_id=voice_id):
                f.write(chunk)
    print(f"[CACHE] Opener saved to {filepath}")


# ───────── GLOBAL MODEL INSTANCES (Pre-loaded at startup) ─────────
GLOBAL_SILERO_VAD: Optional['SileroVADFilter'] = None
GLOBAL_YAMNET_CLASSIFIER: Optional['SoundEventClassifier'] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global GLOBAL_SILERO_VAD, GLOBAL_YAMNET_CLASSIFIER

    await ensure_opener_cache()  # No-op on startup, agents cached per-call

    print("\n" + "=" * 60)
    print("[STARTUP] Loading AI Models")
    print("=" * 60)

    startup_start = time.time()

    try:
        print("[STARTUP] Loading YAMNet sound classifier...")
        GLOBAL_YAMNET_CLASSIFIER = SoundEventClassifier()
        print(f"[STARTUP] YAMNet loaded ({time.time()-startup_start:.1f}s)")
    except Exception as e:
        print(f"[STARTUP] ⚠️ YAMNet failed to load: {e}")
        GLOBAL_YAMNET_CLASSIFIER = None

    if USE_SILERO_VAD:
        try:
            print("[STARTUP] Loading Silero VAD model...")
            vad_start = time.time()
            GLOBAL_SILERO_VAD = SileroVADFilter(
                sample_rate=SAMPLE_RATE,
                threshold=SILERO_CONFIDENCE_THRESHOLD
            )
            print(f"[STARTUP] Silero VAD loaded ({time.time()-vad_start:.1f}s)")
        except Exception as e:
            print(f"[STARTUP] ⚠️ Silero VAD failed to load: {e}")
            GLOBAL_SILERO_VAD = None

    total_time = time.time() - startup_start
    print(f"[STARTUP] All models ready ({total_time:.1f}s)")
    print("=" * 60 + "\n")
    print("[SYSTEM] All systems ready.")

    yield

    print("\n[SHUTDOWN] Cleaning up resources...")
    GLOBAL_SILERO_VAD = None
    GLOBAL_YAMNET_CLASSIFIER = None


app = FastAPI(lifespan=lifespan)

# ───────── SCRIPT DEFINITIONS (LEGACY FALLBACK) ─────────
# These are no longer the primary source of truth.
# Agent configs are now loaded dynamically from the database via agent_loader.
# This dict is kept only for absolute last-resort fallback.
SCRIPTS = {
    "script1": {
        "name": "Script 1: Mahatvapurn Jankari",
        "opener": FALLBACK_AGENT["openingLine"],
        "logic": FALLBACK_AGENT["description"],
    }
}

# Recordings directory (at project root, not app/)
RECORDINGS_DIR = os.path.join(PROJECT_ROOT, "recordings")
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    print(f"[SYSTEM] Created recordings directory: {RECORDINGS_DIR}")
else:
    print(f"[SYSTEM] Using recordings directory: {RECORDINGS_DIR}")


# ───────── NOISE SUPPRESSION (PRODUCTION LEVEL) ─────────

class NoiseFilter:
    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.vad = webrtcvad.Vad(3)  # Maximum aggressiveness for filtering out non-speech
        self.pcm_buffer = bytearray()
        
        nyquist = sample_rate / 2
        cutoff = 80
        self.highpass_b, self.highpass_a = signal.butter(4, cutoff / nyquist, btype='high')
        low_cutoff = VOICE_FREQ_MIN / nyquist
        high_cutoff = VOICE_FREQ_MAX / nyquist
        self.bandpass_b, self.bandpass_a = signal.butter(2, [low_cutoff, high_cutoff], btype='band')

    def calculate_spectral_flatness(self, audio: np.ndarray) -> float:
        spectrum = np.abs(rfft(audio))
        spectrum = spectrum[spectrum > 0]
        if len(spectrum) < 10:
            return 1.0
        geometric_mean = np.exp(np.mean(np.log(spectrum + 1e-10)))
        arithmetic_mean = np.mean(spectrum)
        if arithmetic_mean < 1e-10:
            return 1.0
        flatness = geometric_mean / arithmetic_mean
        return np.clip(flatness, 0, 1)

    def process(self, audio: np.ndarray) -> tuple:
        if len(audio) == 0:
            return audio, False
            
        # 1. Convert incoming float32 array to PCM16 bytes
        pcm16_bytes = (audio * 32767.0).astype(np.int16).tobytes()
        self.pcm_buffer.extend(pcm16_bytes)
        
        # 2. Process strictly in 30ms chunks (480 samples * 2 bytes = 960 bytes for 16kHz)
        FRAME_SIZE = 960 if self.sample_rate == 16000 else 480 
        clean_pcm = bytearray()
        
        processed_bytes = 0
        while len(self.pcm_buffer) - processed_bytes >= FRAME_SIZE:
            frame = bytes(self.pcm_buffer[processed_bytes:processed_bytes+FRAME_SIZE])
            processed_bytes += FRAME_SIZE
            
            try:
                # If WebRTC says it's noise, we ZERO it out.
                if self.vad.is_speech(frame, self.sample_rate):
                    clean_pcm.extend(frame)
                else:
                    clean_pcm.extend(b'\x00' * FRAME_SIZE)
            except Exception as e:
                # Fallback if frame is somehow invalid
                clean_pcm.extend(frame)
                
        # Keep remaining bytes for the next incoming chunk
        self.pcm_buffer = self.pcm_buffer[processed_bytes:]
        
        # If we didn't process anything yet (e.g. initial few bytes), return empty
        if len(clean_pcm) == 0:
            return np.array([], dtype=np.float32), False
            
        # Convert the cleaned, processed frames back to float32
        cleaned_audio = np.frombuffer(bytes(clean_pcm), dtype=np.int16).astype(np.float32) / 32768.0

        # Now do the existing frequency/dB checks on the cleaned audio
        filtered = signal.filtfilt(self.highpass_b, self.highpass_a, cleaned_audio)
        filtered = signal.filtfilt(self.bandpass_b, self.bandpass_a, filtered)
        energy = np.sqrt(np.mean(filtered ** 2))
        db = 20 * np.log10(energy + 1e-9)
        spectral_flatness = self.calculate_spectral_flatness(filtered)
        
        is_valid = True
        rejection_reason = None
        
        # If the WebRTC VAD aggressively zeroed out everything, the energy will be basically 0
        if energy < 1e-6:
             is_valid = False
             rejection_reason = "WebRTC VAD rejected background noise"
        elif db < NOISE_GATE_DB:
            is_valid = False
        elif spectral_flatness > SPECTRAL_FLATNESS_THRESHOLD:
            is_valid = False
            rejection_reason = f"Fan/constant noise (Flatness={spectral_flatness:.2f})"
        elif db < INTERRUPTION_THRESHOLD_DB:
            is_valid = False
            
        if not is_valid and rejection_reason:
            pass # Silenced the explicit print because WebRTC triggers it constantly for background noise
            
        return filtered, is_valid


# ───────── HELPERS ─────────

def wav_header(raw: bytes) -> bytes:
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(raw), b"WAVE",
        b"fmt ", 16, 1, 1,
        SAMPLE_RATE, SAMPLE_RATE * 2,
        2, 16,
        b"data", len(raw)
    ) + raw


def trim_audio(pcm_bytes: bytes) -> bytes:
    if not pcm_bytes:
        return b""
    arr = np.frombuffer(pcm_bytes, dtype=np.int16)
    if len(arr) == 0:
        return pcm_bytes
    energy = np.abs(arr)
    threshold = 32768 * 0.02
    mask = energy > threshold
    if not np.any(mask):
        return pcm_bytes
    start = np.argmax(mask)
    end = len(mask) - np.argmax(mask[::-1])
    trimmed = arr[start:end].tobytes()
    min_samples = int(SAMPLE_RATE * 0.1)
    if len(trimmed) // 2 < min_samples:
        return pcm_bytes
    return trimmed


def trim_history(history: List[Dict]) -> List[Dict]:
    if len(history) > MAX_HISTORY_LENGTH:
        return history[-MAX_HISTORY_LENGTH:]
    return history


# ───────── ASR (Speech-to-Text) ─────────

async def asr_transcribe(client: httpx.AsyncClient, pcm16: bytes, ws: WebSocket, semantic_filter: SemanticFilter = None) -> Optional[str]:
    print(f"[ASR] Sending {len(pcm16)} bytes…")
    start_time = time.time()
    trimmed_pcm = trim_audio(pcm16)
    print(f"[ASR] Trimmed to {len(trimmed_pcm)} bytes")

    # Skip if audio is too short (< 0.5 seconds = 16000 bytes at 16kHz 16-bit)
    MIN_ASR_BYTES = SAMPLE_RATE * 1  # 0.5 seconds = 16000 bytes
    if len(trimmed_pcm) < MIN_ASR_BYTES:
        print(f"[ASR] Audio too short ({len(trimmed_pcm)} bytes < {MIN_ASR_BYTES}), skipping")
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GENARTML_SERVER_KEY}"
    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": "Transcribe this audio to Hindi text. Output ONLY the transcribed words, nothing else. No explanations, no formatting, no commentary."},
                {"inlineData": {
                    "mimeType": "audio/wav",
                    "data": base64.b64encode(wav_header(trimmed_pcm)).decode()
                }}
            ]
        }],
        "generationConfig": {
            "thinkingConfig": {"thinkingBudget": 0}
        }
    }
    for attempt in range(MAX_RETRIES + 1):
        try:
            print(f"[ASR] Sending request (Attempt {attempt+1})...")
            r = await client.post(url, json=payload, timeout=5.0)
            if r.status_code != 200:
                print(f"[ASR Error] HTTP {r.status_code}: {r.text[:200]}")
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                return None
            data = r.json()
            if "candidates" in data and data["candidates"]:
                candidate = data["candidates"][0]
                content = candidate.get("content", {})
                parts = content.get("parts", [])
                if parts and "text" in parts[0]:
                    text = parts[0]["text"].strip()
                    # Clean any leaked model thinking (multi-line reasoning)
                    if "\n" in text:
                        lines = [l.strip() for l in text.split("\n") if l.strip()]
                        # Take only the first line (actual transcription)
                        text = lines[0] if lines else ""
                    # Remove common thinking prefixes
                    for prefix in ["think", "The user", "I will", "The output", "The audio"]:
                        if text.startswith(prefix):
                            text = ""
                            break
                else:
                    print(f"[ASR] Empty response from model (blocked or no text)")
                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(RETRY_DELAY)
                        continue
                    return None
            else:
                print(f"[ASR] No candidates in response")
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                return None
            break
        except asyncio.TimeoutError:
            print(f"[ASR] Timeout on attempt {attempt + 1}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY)
                continue
            return None
        except Exception as e:
            print(f"[ASR Error]: {e}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY)
                continue
            return None
    elapsed = time.time() - start_time
    if semantic_filter and not semantic_filter.is_meaningful(text):
        reason = semantic_filter.get_rejection_reason(text)
        print(f"\n🛡️ [Semantic Filter] Ignored: '{text}' - {reason}\n")
        return None
    print(f"\n👉 [USER SPOKE]: '{text}' ({elapsed:.2f}s)\n")
    if len(text.strip()) > 2:
        try:
            await ws.send_json({"type": "STOP_BROADCAST", "stop_broadcast": True})
        except Exception as e:
            print(f"[ASR] Failed to send STOP_BROADCAST: {e}")
    return text


# ───────── LLM Response Generation ─────────

async def generate_response(client: httpx.AsyncClient, user_text: str, history: List[Dict], agent_config: Dict = None) -> str:
    if not user_text:
        return "..."
    start_time = time.time()

    # Use agent config from database, fallback to FALLBACK_AGENT
    agent = agent_config or FALLBACK_AGENT
    system_prompt = agent.get('systemPrompt', FALLBACK_AGENT['systemPrompt'])
    logic_context = agent.get('description', '') or ''
    temperature = agent.get('temperature', 0.7)
    max_tokens = agent.get('maxTokens', 250)

    # Check for active prompt version (overrides systemPrompt)
    if agent.get('id') and agent['id'] != 'fallback':
        active_prompt = get_active_prompt(agent['id'])
        if active_prompt:
            system_prompt = active_prompt

    # Append logic context if available
    if logic_context:
        system_prompt = f"{system_prompt}\n\nसंदर्भ: {logic_context}"

    clean_history = [m for m in history if m["parts"][0]["text"] != "SYSTEM_INITIATE_CALL"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GENARTML_SERVER_KEY}"
    payload = {
        "contents": [*clean_history, {"role": "user", "parts": [{"text": user_text}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "thinkingConfig": {"thinkingBudget": 0},
            "temperature": temperature,
            "maxOutputTokens": max_tokens
        }
    }
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = await client.post(url, json=payload, timeout=5.0)
            if r.status_code != 200:
                print(f"[LLM Error] HTTP {r.status_code}: {r.text[:200]}")
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                return "माफ़ कीजिये, कुछ तकनीकी समस्या है।"
            data = r.json()
            if "candidates" not in data or not data["candidates"]:
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                return "माफ़ कीजिये, आवाज नहीं आई।"
            candidate = data["candidates"][0]
            content = candidate.get("content", {})
            parts = content.get("parts", [])
            if not parts or "text" not in parts[0]:
                print(f"[LLM] Empty/blocked response from model")
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_DELAY)
                    continue
                return "माफ़ कीजिये, आवाज नहीं आई।"
            reply = parts[0]["text"].strip().replace("*", "")
            print(f"\n🤖 [BOT REPLY]: '{reply}'\n")
            reply = reply.replace("RS", "रुपये").replace("Rs", "रुपये").replace("rs", "रुपये")
            reply = re.sub(r'\[.*?\]', '', reply).strip()
            break
        except asyncio.TimeoutError:
            print(f"[LLM] Timeout on attempt {attempt + 1}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY)
                continue
            return "माफ़ कीजिये, जवाब देने में समय लग रहा है।"
        except Exception as e:
            print(f"[LLM Error]: {e}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY)
                continue
            return "माफ़ कीजिये, कुछ गड़बड़ हो गई।"
    elapsed = time.time() - start_time
    print(f"[BOT TEXT]: '{reply}' ({elapsed:.2f}s)")
    return reply


# ───────── OUTCOME ANALYSIS (AI) ─────────

async def analyze_call_outcome(client: httpx.AsyncClient, history: List[Dict]) -> Optional[Dict]:
    if not history: return None
    print("[ANALYSIS] Analyzing call outcome...")
    transcript = ""
    for msg in history:
        role = "User" if msg["role"] == "user" else "Bot"
        text = msg["parts"][0]["text"]
        transcript += f"{role}: {text}\n"
    system_prompt = """
    You are a Call Analyst. Analyze the conversation transcript and extract the outcome.
    Output JSON format only:
    {
        "agreed": true/false,
        "commitment": "today" / "tomorrow" / "later" / "refused",
        "disposition": "Interested - Agreed Today" / "Interested - Agreed Tomorrow" / "Not Interested" / "Unclear",
        "notes": "Short summary of why"
    }
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GENARTML_SERVER_KEY}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": f"{system_prompt}\n\nTranscript:\n{transcript}"}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }
    try:
        r = await client.post(url, json=payload, timeout=15.0)
        if r.status_code == 200:
            data = r.json()
            if "candidates" in data and data["candidates"]:
                candidate = data["candidates"][0]
                content = candidate.get("content", {})
                parts = content.get("parts", [])
                if not parts or "text" not in parts[0]:
                    print("[ANALYSIS] Empty response from model")
                    return None
                raw_json = parts[0]["text"]
                result = json.loads(raw_json)
                import datetime
                today = datetime.date.today()
                comm_date = None
                if result.get("commitment") == "tomorrow":
                    comm_date = today + datetime.timedelta(days=1)
                elif result.get("commitment") == "today":
                    comm_date = today
                return {
                    "agreed": result.get("agreed"),
                    "commitment_date": comm_date,
                    "disposition": result.get("disposition", "Unclear"),
                    "notes": result.get("notes", "")
                }
    except Exception as e:
        import traceback
        print(f"[ANALYSIS ERROR] {type(e).__name__}: {str(e)}")
        traceback.print_exc()
    return None


# ───────── TTS (Text-to-Speech) Streaming ─────────

async def tts_stream_generate(client: httpx.AsyncClient, text: str, voice_id: str = None) -> AsyncGenerator[bytes, None]:
    """Stream TTS audio from ElevenLabs. Uses agent-specific voice_id if provided."""
    resolved_voice_id = voice_id or GENARTML_VOICE_ID
    print(f"[TTS] Starting stream for: '{text[:50]}...' (voice={resolved_voice_id[:8]}...)")
    start_time = time.time()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{resolved_voice_id}/stream?output_format=pcm_16000"
    headers = {
        "xi-api-key": GENARTML_SECRET_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": VOICE_STABILITY,
            "similarity_boost": VOICE_SIMILARITY_BOOST,
            "style": VOICE_STYLE,
            "use_speaker_boost": True,
            "speed": 1.2  # Maximum allowed by ElevenLabs is 1.2
        }
    }
    try:
        async with client.stream("POST", url, json=payload, headers=headers, timeout=15.0) as response:
            if response.status_code != 200:
                error_text = await response.aread()
                print(f"[TTS Error] HTTP {response.status_code}: {error_text[:200]}")
                return
            first_chunk = True
            buffer = b""
            # Stream exactly 0.5s chunks (16000 bytes = 8000 samples @ 16bit) for smooth, uninterrupted WebSocket delivery
            CHUNK_SIZE = 16000
            async for chunk in response.aiter_bytes():
                if first_chunk:
                    print(f"[TTS First Byte]: {time.time() - start_time:.2f}s")
                    first_chunk = False
                if chunk:
                    buffer += chunk
                    while len(buffer) >= CHUNK_SIZE:
                        yield buffer[:CHUNK_SIZE]
                        buffer = buffer[CHUNK_SIZE:]
            if buffer and len(buffer) > 0:
                yield buffer
    except asyncio.TimeoutError:
        print("[TTS] Stream timeout")
    except Exception as e:
        print(f"[TTS Error]: {e}")
    print(f"[TTS] Stream complete ({time.time() - start_time:.2f}s)")


# ───────── WEBSOCKET HANDLER ─────────

@app.websocket("/")
async def ws(ws: WebSocket):
    await ws.accept()
    print("\n" + "=" * 50)
    print("[CALL] 📞 NEW CALL STARTED")
    print(f"[CALL HEADERS] {dict(ws.headers)}")
    print("=" * 50 + "\n")

    call_uuid = (
        ws.headers.get("x-call-id")
        or ws.headers.get("call-id")
        or ws.headers.get("X-Freeswitch-Call-UUID")
        or ws.query_params.get("uuid")
        or ws.query_params.get("call_id")
    )

    # FreeSWITCH will pass agent_id in headers or query params
    # e.g., {"agent_id": "abc-123"}
    agent_id = (
        ws.headers.get("x-agent-id")
        or ws.headers.get("agent-id")
        or ws.query_params.get("agent_id")
    )
    
    phone_number = (
        ws.headers.get("x-phone-number")
        or ws.headers.get("caller-id")
        or ws.headers.get("Caller-Caller-ID-Number")
        or ws.headers.get("variable_sip_from_user")
        or ws.query_params.get("phone")
        or ws.query_params.get("to")
    )

    if call_uuid:
        print(f"[CALL] UUID: {call_uuid}")
    else:
        print("[CALL] Warning: No UUID in headers, generating one")
        import uuid
        call_uuid = str(uuid.uuid4())

    if phone_number:
        print(f"[CALL] Phone: {phone_number}")
        
    # --- LOAD AGENT CONFIGURATION ---
    if agent_id:
        print(f"[CALL] Requested Agent ID: {agent_id}")
        agent_config = load_agent(agent_id)
        if not agent_config:
            print(f"[CALL] ⚠️ Agent {agent_id} not found, falling back to default")
            agent_config = get_default_agent() or FALLBACK_AGENT
    else:
        print("[CALL] No agent_id provided, using default agent")
        agent_config = get_default_agent() or FALLBACK_AGENT

    print(f"[CALL] Using Agent: {agent_config['name']} (Voice: {agent_config['voice']}, Temp: {agent_config['temperature']})")
    
    # Store safe ID for caching
    safe_agent_id = str(agent_config['id']).replace('-', '_')[:32]

    print(f"[DB] Creating call record for {call_uuid}")
    tracker.start_call(call_uuid, phone_number)
    print(f"[DB] ✅ Call record created")

    db = get_db_session()

    buffer = deque(maxlen=SAMPLE_RATE * MAX_BUFFER_SECONDS)
    vad_buffer = deque(maxlen=SAMPLE_RATE * MAX_BUFFER_SECONDS)
    history: List[Dict] = []

    speaking = False
    last_voice = 0.0
    ws_alive = True
    current_task: asyncio.Task | None = None
    task_lock = asyncio.Lock()
    first_line_complete = False
    bot_speaking = False
    barge_in_confirm_start = None  # Timestamp when continuous caller speech started

    recorder = LocalRecorder(call_uuid)
    noise_filter = NoiseFilter(sample_rate=SAMPLE_RATE)

    classifier = GLOBAL_YAMNET_CLASSIFIER
    semantic_filter = SemanticFilter(language='hi', min_length=SEMANTIC_MIN_LENGTH)
    use_silero = USE_SILERO_VAD and GLOBAL_SILERO_VAD is not None

    if use_silero and GLOBAL_SILERO_VAD:
        silero_vad = GLOBAL_SILERO_VAD
        silero_vad.reset_noise_profile()
        print("[Noise Filter] ✅ Using pre-loaded: Silero VAD + YAMNet + Semantic Filter")
    else:
        silero_vad = None
        print("[Noise Filter] Initialized: High-pass + Band-pass + YAMNet Classifier")

    if not classifier:
        print("[Noise Filter] ⚠️ YAMNet not available, noise classification disabled")

    speaker_verifier = SpeakerVerifier(
        sample_rate=SAMPLE_RATE,
        enrollment_seconds=SPEAKER_ENROLLMENT_SECONDS,
        similarity_threshold=SPEAKER_SIMILARITY_THRESHOLD
    )

    async def cancel_current():
        nonlocal current_task, bot_speaking
        async with task_lock:
            if current_task and not current_task.done():
                print("[SYSTEM] Cancelling previous task (barge-in)")
                bot_speaking = False
                current_task.cancel()
                try:
                    await asyncio.wait_for(current_task, timeout=0.5)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            current_task = None

    async def send_audio_safe(audio_chunk: bytes) -> bool:
        if not ws_alive:
            return False
        try:
            if bot_speaking:
                recorder.write_audio(audio_chunk, source="bot")
            await ws.send_json({
                "type": "streamAudio",
                "data": {
                    "audioDataType": "raw",
                    "sampleRate": SAMPLE_RATE,
                    "audioData": base64.b64encode(audio_chunk).decode()
                }
            })
            return True
        except Exception as e:
            print(f"[WS] Send failed: {e}")
            return False

    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
    ) as client:

        async def process_audio(samples: np.ndarray):
            nonlocal history, ws_alive
            try:
                pcm16 = (samples * 32767).astype(np.int16).tobytes()
                user_text = await asr_transcribe(client, pcm16, ws, semantic_filter=semantic_filter)
                if not user_text or not ws_alive:
                    return
                print(f"\n[CUSTOMER] 🗣️  {user_text}")
                history.append({"role": "user", "parts": [{"text": user_text}]})
                if call_uuid:
                    tracker.log_message(call_uuid, "user", user_text)
                history = trim_history(history)
                reply_text = await generate_response(client, user_text, history, agent_config=agent_config)
                should_hangup = False
                if "[HANGUP]" in reply_text:
                    should_hangup = True
                    reply_text = reply_text.replace("[HANGUP]", "").strip()
                print(f"[BOT] 🤖 {reply_text}")
                history.append({"role": "model", "parts": [{"text": reply_text}]})
                if call_uuid:
                    tracker.log_message(call_uuid, "model", reply_text)
                history = trim_history(history)
                bot_speaking = True
                async for audio_chunk in tts_stream_generate(client, reply_text, voice_id=agent_config['voice']):
                    if not ws_alive:
                        break
                    if not await send_audio_safe(audio_chunk):
                        break
                bot_speaking = False
                if should_hangup:
                    print("[SYSTEM] Hanging up call as per script logic.")
                    if ws_alive:
                        await ws.send_json({"type": "BROADCAST_STOPPED", "status": "success"})
                    await asyncio.sleep(0.5)
                    if call_uuid:
                        await freeswitch_hangup(call_uuid)
                    if ws_alive:
                        await ws.send_json({"type": "hangup"})
                        ws_alive = False
            except asyncio.CancelledError:
                print("[SYSTEM] Task cancelled gracefully")
                raise
            except Exception as e:
                print(f"[Process Error]: {e}")
                if ws_alive:
                    try:
                        fallback_text = "माफ़ कीजिये, आपकी आवाज़ स्पष्ट नहीं आ रही है। क्या आप दोहरा सकते हैं?"
                        async for audio_chunk in tts_stream_generate(client, fallback_text):
                            if not ws_alive: break
                            if not await send_audio_safe(audio_chunk): break
                    except Exception as fallback_error:
                        print(f"[Fallback Error]: {fallback_error}")

        # Send opener
        opener_text = agent_config['openingLine']
        print(f"[{agent_config['name']}]: {opener_text}")
        history.append({"role": "model", "parts": [{"text": opener_text}]})

        # Cache path uses safe_agent_id
        cache_path = os.path.join(CACHE_DIR, f"{safe_agent_id}_opener.pcm")
        total_opener_bytes = 0
        bot_speaking = True

        if os.path.exists(cache_path):
            print(f"[CACHE] Streaming opener from disk")
            chunk_size = 100000
            with open(cache_path, "rb") as f:
                while True:
                    data = f.read(chunk_size)
                    if not data:
                        break
                    if await send_audio_safe(data):
                        total_opener_bytes += len(data)
                    else:
                        break
                    await asyncio.sleep(0.02)
        else:
            print(f"[CACHE] Generating opener on the fly for agent {agent_config['id']}")
            async for chunk in tts_stream_generate(client, opener_text, voice_id=agent_config['voice']):
                if await send_audio_safe(chunk):
                    total_opener_bytes += len(chunk)
                else:
                    break
        bot_speaking = False

        playback_duration = total_opener_bytes / 32000.0
        if playback_duration < 3.0:
            print(f"[SYSTEM] Warning: Calculated duration very short ({playback_duration:.2f}s). Setting minimum 3s.")
            playback_duration = 3.0

        print(f"[SYSTEM] Opener playback protection: {playback_duration:.2f}s\")")

        async def enable_barge_in_delayed(delay: float):
            try:
                safe_delay = delay + 0.3
                print(f"[SYSTEM] Locking barge-in for {safe_delay:.2f}s...")
                await asyncio.sleep(safe_delay)
                nonlocal first_line_complete
                first_line_complete = True
                if silero_vad:
                    silero_vad.finalize_noise_profile()
                print("[SYSTEM] Opener playback complete - barge-in now enabled")
            except Exception as e:
                print(f"[SYSTEM] Timer error: {e}")

        asyncio.create_task(enable_barge_in_delayed(playback_duration))

        try:
            while ws_alive:
                try:
                    msg = await asyncio.wait_for(ws.receive(), timeout=30.0)
                except asyncio.TimeoutError:
                    print("[WS] Receive timeout, sending keepalive...")
                    try:
                        await ws.send_json({"type": "keepalive"})
                    except:
                        break
                    continue

                if msg["type"] == "websocket.disconnect":
                    break

                if "bytes" in msg:
                    recorder.write_audio(msg["bytes"], source="customer")
                    pcm = np.frombuffer(msg["bytes"], dtype=np.int16)
                    if pcm.size == 0:
                        continue
                    chunk = pcm.astype(np.float32) / 32768.0
                    filtered_chunk, is_valid_speech = noise_filter.process(chunk)
                    
                    if len(filtered_chunk) == 0:
                        continue
                        
                    energy = np.sqrt(np.mean(filtered_chunk * filtered_chunk))
                    audio_db = 20 * np.log10(energy + 1e-9)
                    now = time.time()

                    if speaking and now - last_voice > SILENCE_TIMEOUT:
                        speaking = False
                        duration = len(buffer) / SAMPLE_RATE
                        if duration >= MIN_SPEECH_DURATION:
                            print(f"[VAD] End of speech detected ({duration:.2f}s). Processing...")
                            samples = np.array(buffer, dtype=np.float32)
                            buffer.clear()
                            vad_buffer.clear()
                            async with task_lock:
                                current_task = asyncio.create_task(process_audio(samples))
                        else:
                            print(f"[VAD] Speech too short ({duration:.2f}s), ignoring")
                            buffer.clear()
                            vad_buffer.clear()

                    if not is_valid_speech:
                        barge_in_confirm_start = None  # Reset confirmation buffer on silence
                        if speaking:
                            buffer.extend(chunk)
                        continue

                    if use_silero and silero_vad:
                        is_speech, vad_confidence = silero_vad.is_speech(filtered_chunk)
                        if not is_speech or vad_confidence < SILERO_CONFIDENCE_THRESHOLD:
                            if speaking:
                                buffer.extend(chunk)
                            continue

                    # Feed confirmed speech to speaker enrollment
                    if not speaker_verifier.is_enrolled:
                        speaker_verifier.enroll(filtered_chunk)

                    buffer.extend(chunk)
                    vad_buffer.extend(filtered_chunk)

                    if speaking and now - last_voice > SILENCE_TIMEOUT:
                        speaking = False
                        samples = np.array(buffer, dtype=np.float32) / 32767.0
                        if len(samples) >= MIN_SPEECH_DURATION * SAMPLE_RATE:
                            print(f"[VAD] 🎤 Speech ended ({len(samples)/SAMPLE_RATE:.2f}s total)")
                            if current_task is None or current_task.done():
                                current_task = asyncio.create_task(process_audio(samples))
                        else:
                            print(f"[VAD] Speech too short, ignored")
                        buffer.clear()
                        vad_buffer.clear()
                        continue

                    if audio_db > INTERRUPTION_THRESHOLD_DB:
                        if not speaking:
                            if not first_line_complete:
                                continue

                            # Stage 3: Speaker Verification
                            is_caller, sim_score = speaker_verifier.verify(filtered_chunk)
                            if not is_caller:
                                barge_in_confirm_start = None
                                buffer.clear()
                                vad_buffer.clear()
                                continue

                            # Stage 4: Confirmation Buffer (300ms continuous caller speech)
                            if barge_in_confirm_start is None:
                                barge_in_confirm_start = now

                            elapsed_ms = (now - barge_in_confirm_start) * 1000
                            if elapsed_ms < BARGE_IN_CONFIRM_MS:
                                # Still waiting for confirmation — buffer audio but don't barge-in yet
                                buffer.extend(chunk)
                                vad_buffer.extend(filtered_chunk)
                                last_voice = now
                                continue

                            # ✅ 300ms of continuous caller speech confirmed — FIRE barge-in
                            barge_in_confirm_start = None

                            if len(vad_buffer) > 4000 and classifier:
                                recent_audio = np.array(vad_buffer)[-15000:]
                                is_safe, label, conf = classifier.classify(recent_audio)
                                if not is_safe and conf > 0.45:
                                    print(f"[YAMNet] 🛡️ Ignored noise: {label} ({conf:.2f})")
                                    buffer.clear()
                                    vad_buffer.clear()
                                    continue
                            vad_status = f"Silero: {vad_confidence:.2f}" if use_silero and silero_vad else "Basic"
                            caller_status = f"Caller: {sim_score:.2f}" if speaker_verifier.is_enrolled else "Enrolling"
                            print(f"\n[VAD] ✅ Speech started (dB: {audio_db:.1f}, {vad_status}, {caller_status})")
                            await ws.send_json({"type": "STOP_BROADCAST", "stop_broadcast": True})
                            if current_task and not current_task.done():
                                history.append({"role": "model", "parts": [{"text": "[System: User interrupted previous response]"}]})
                        speaking = True
                        last_voice = now
                        await cancel_current()
                    else:
                        # Audio below threshold — reset confirmation buffer
                        barge_in_confirm_start = None

                elif "text" in msg:
                    try:
                        data = json.loads(msg["text"])
                        msg_type = data.get("type")
                        if msg_type == "STOP_BROADCAST":
                            print("[WS] STOP_BROADCAST received")
                            await cancel_current()
                            await ws.send_json({"type": "BROADCAST_STOPPED", "status": "success"})
                        elif msg_type == "HANGUP_CALL":
                            print("[WS] HANGUP_CALL received")
                            if call_uuid:
                                await freeswitch_hangup(call_uuid)
                            ws_alive = False
                        elif msg_type == "FINAL_DISPOSITION":
                            disp = data.get("final_disposition")
                            print(f"[WS] FINAL_DISPOSITION received: {disp}")
                            if call_uuid:
                                update_call_outcome(db, call_uuid, disp)
                                await ws.send_json({"type": "DISPOSITION_SAVED", "status": "success"})
                    except Exception as e:
                        print(f"[WS JSON Error]: {e}")

        except WebSocketDisconnect:
            print("[CALL] Client disconnected")
        except Exception as e:
            print(f"[CALL ERROR]: {e}")
            import traceback
            traceback.print_exc()
        finally:
            ws_alive = False
            await cancel_current()
            if 'db' in locals():
                db.close()

            recording_filepath = recorder.close()
            final_path = None
            if recording_filepath and os.path.exists(recording_filepath):
                try:
                    print(f"[LOCAL RECORDING] File ready: {recording_filepath}")
                    s3_url = upload_to_s3(recording_filepath)
                    if s3_url:
                        final_path = s3_url
                    else:
                        final_path = os.path.abspath(recording_filepath)
                        print(f"[LOCAL RECORDING] ⚠️ S3 upload failed, using local path")
                except Exception as rec_e:
                    print(f"[LOCAL RECORDING ERROR] {rec_e}")

            ai_outcome = None
            if history:
                try:
                    async with httpx.AsyncClient() as analysis_client:
                        ai_outcome = await analyze_call_outcome(analysis_client, history)
                        if ai_outcome:
                            print(f"[ANALYSIS] Result: {ai_outcome}")
                except Exception as e:
                    import traceback
                    print(f"[ANALYSIS ERROR] {type(e).__name__}: {str(e)}")
                    traceback.print_exc()

            if call_uuid:
                print(f"[DB] Ending call record for {call_uuid}")
                try:
                    try:
                        tracker.end_call(call_uuid, status="completed", recording_filename=final_path, outcome_override=ai_outcome)
                    except TypeError:
                        tracker.end_call(call_uuid, status="completed")
                    print(f"[DB] ✅ Call record closed")
                except Exception as db_error:
                    print(f"[DB ERROR] Failed to end call: {db_error}")

            print("\n" + "=" * 50)
            print("[CALL] 📴 CALL ENDED")
            print("=" * 50 + "\n")


# ───────── HEALTH CHECK ─────────

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


# ───────── DASHBOARD & API INTEGRATION ─────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes (legacy dashboard API)
try:
    from api_routes import router as api_router
    app.include_router(api_router)
    print("[DASHBOARD] API routes mounted at /api")
except Exception as e:
    print(f"[DASHBOARD] Warning: Could not load API routes: {e}")

# Serve dashboard - try enterprise frontend dist first, then old dashboard/
ENTERPRISE_DASHBOARD_DIR = os.path.join(PROJECT_ROOT, "enterprise", "frontend", "dist")
OLD_DASHBOARD_DIR = os.path.join(PROJECT_ROOT, "dashboard")

try:
    if os.path.exists(ENTERPRISE_DASHBOARD_DIR):
        app.mount("/dashboard", StaticFiles(directory=ENTERPRISE_DASHBOARD_DIR, html=True), name="dashboard")
        print(f"[DASHBOARD] Served at http://0.0.0.0:8085/dashboard/")
        print(f"[DASHBOARD] Files: {', '.join(os.listdir(ENTERPRISE_DASHBOARD_DIR))}")
    elif os.path.exists(OLD_DASHBOARD_DIR):
        app.mount("/dashboard", StaticFiles(directory=OLD_DASHBOARD_DIR, html=True), name="dashboard")
        print(f"[DASHBOARD] Served at http://0.0.0.0:8085/dashboard/")
        print(f"[DASHBOARD] Files: {', '.join(os.listdir(OLD_DASHBOARD_DIR))}")
    else:
        print(f"[DASHBOARD] Warning: Enterprise dashboard directory not found at {ENTERPRISE_DASHBOARD_DIR}")
        print(f"[DASHBOARD] Please build the enterprise frontend first (cd enterprise/frontend && npm run build)")
except Exception as e:
    print(f"[DASHBOARD] Warning: Could not mount dashboard: {e}")


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("🚀 Lakhu Teleservices Voice Bot System")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8085)
