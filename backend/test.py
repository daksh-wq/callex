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
from logging_utils import tracker  # Database logging
from database import get_db_session, update_call_outcome
from sound_classifier import SoundEventClassifier  # Import classifier
from silero_vad_filter import SileroVADFilter  # Production VAD
from semantic_filter import SemanticFilter  # Filler word filter

# Force unbuffered output for PM2/Systemd logging
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# ─────────  CONFIGURATION (Loaded from config file) ─────────

from config_manager import get_config_manager

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
USE_SILERO_VAD = True         # Enable ML-based speech detection
SILERO_CONFIDENCE_THRESHOLD = 0.50  # 50% minimum confidence for speech
CONTINUOUS_VAD_CHECK = True   # Check throughout speech, not just at start
SEMANTIC_MIN_LENGTH = 3       # Minimum text length after transcription

# Voice Settings (from config)
VOICE_SPEED = bot_config.voice.speed
VOICE_STABILITY = bot_config.voice.stability
VOICE_SIMILARITY_BOOST = bot_config.voice.similarity_boost
VOICE_STYLE = bot_config.voice.style

print(f"[CONFIG] Loaded from {config_mgr.config_path}")
print(f"[CONFIG] VAD: SILENCE_TIMEOUT={SILENCE_TIMEOUT}s, THRESHOLD={INTERRUPTION_THRESHOLD_DB}dB")
print(f"[CONFIG] Voice: speed={VOICE_SPEED}x, stability={VOICE_STABILITY}")

# History Management
MAX_HISTORY_LENGTH = 12   # Keep last 6 exchanges (6 user + 6 model)

# Retry Configuration
MAX_RETRIES = 2
RETRY_DELAY = 0.3

# FreeSWITCH ESL Configuration
ESL_HOST = "127.0.0.1"
ESL_PORT = 8021
ESL_PASSWORD = "ClueCon"

# AWS S3 Configuration (from central config)
from config import AWS_ACCESS_KEY, AWS_SECRET_KEY, AWS_REGION, AWS_BUCKET_NAME

ACTIVE_SCRIPT_ID = "script1"
CACHE_DIR = "cache"

# ───────── DYNAMIC SCRIPT LOADING (from S3) ─────────
from script_manager import get_script_manager

# Load active script from S3 (with hardcoded fallback)
try:
    _script_mgr = get_script_manager()
    _active_script = _script_mgr.get_active_script()
    ACTIVE_SCRIPT_ID = _active_script.get('id', 'script1')
    print(f"[SCRIPTS] Loaded active script from S3: {ACTIVE_SCRIPT_ID} ({_active_script.get('name')})")
except Exception as e:
    print(f"[SCRIPTS] WARNING: S3 load failed, using hardcoded fallback: {e}")
    _active_script = None

async def freeswitch_hangup(uuid: str):
    """Terminates a call by UUID using FreeSWITCH Event Socket"""
    try:
        reader, writer = await asyncio.open_connection(ESL_HOST, ESL_PORT)
        
        # Authenticate
        await reader.readuntil(b"Content-Type: auth/request\n\n")
        writer.write(f"auth {ESL_PASSWORD}\n\n".encode())
        await writer.drain()
        
        auth_response = await reader.readuntil(b"\n\n")
        if b"+OK" not in auth_response:
            print(f"[ESL Error] Authentication failed: {auth_response}")
            writer.close()
            await writer.wait_closed()
            return

        # Send Hangup Command
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
        
        # Authenticate
        await reader.readuntil(b"Content-Type: auth/request\n\n")
        writer.write(f"auth {ESL_PASSWORD}\n\n".encode())
        await writer.drain()
        
        auth_response = await reader.readuntil(b"\n\n")
        if b"+OK" not in auth_response:
            print(f"[ESL Error] Authentication failed in freeswitch_command: {auth_response}")
            writer.close()
            await writer.wait_closed()
            return None

        # Send Command
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
        # Construct URL
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
            self.wav_file.setnchannels(1)  # Mono
            self.wav_file.setsampwidth(2)  # 16-bit
            self.wav_file.setframerate(SAMPLE_RATE)  # 16kHz
            print(f"[LOCAL RECORDING] Started: {self.filepath}")
        except Exception as e:
            print(f"[LOCAL RECORDING ERROR] Failed to create file: {e}")
    
    def write_audio(self, pcm_bytes: bytes, source: str = "unknown"):
        """Write PCM audio bytes to WAV file"""
        if self.wav_file:
            try:
                self.wav_file.writeframes(pcm_bytes)
                self.frames_written += len(pcm_bytes) // 2  # 16-bit = 2 bytes per sample
                
                # Track source
                if source == "customer":
                    self.customer_chunks += 1
                elif source == "bot":
                    self.bot_chunks += 1
            except Exception as e:
                print(f"[LOCAL RECORDING ERROR] Write failed: {e}")
    
    def close(self) -> str:
        """Close WAV file and return filepath"""
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

async def ensure_opener_cache():
    """Ensure opener audio is cached on startup"""
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)
    
    script = SCRIPTS[ACTIVE_SCRIPT_ID]
    filename = f"{ACTIVE_SCRIPT_ID}_opener.pcm"
    filepath = os.path.join(CACHE_DIR, filename)
    
    if os.path.exists(filepath):
        print(f"[CACHE] Opener found: {filepath}")
        return

    print(f"[CACHE] Generating opener for {ACTIVE_SCRIPT_ID}...")
    async with httpx.AsyncClient() as client:
        with open(filepath, "wb") as f:
            async for chunk in tts_stream_generate(client, script['opener']):
                f.write(chunk)
    print(f"[CACHE] Opener saved to {filepath}")

# ───────── GLOBAL MODEL INSTANCES (Pre-loaded at startup) ─────────
GLOBAL_SILERO_VAD: Optional['SileroVADFilter'] = None
GLOBAL_YAMNET_CLASSIFIER: Optional['SoundEventClassifier'] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: load models at startup, cleanup on shutdown"""
    global GLOBAL_SILERO_VAD, GLOBAL_YAMNET_CLASSIFIER
    
    # Ensure opener cache
    await ensure_opener_cache()
    
    print("\n" + "="*60)
    print("[STARTUP] Loading AI Models")
    print("="*60)
    
    startup_start = time.time()
    
    # Pre-load YAMNet Classifier
    try:
        print("[STARTUP] Loading YAMNet sound classifier...")
        GLOBAL_YAMNET_CLASSIFIER = SoundEventClassifier()
        print(f"[STARTUP] YAMNet loaded ({time.time()-startup_start:.1f}s)")
    except Exception as e:
        print(f"[STARTUP] WARNING: YAMNet failed to load: {e}")
        GLOBAL_YAMNET_CLASSIFIER = None
    
    # Pre-load Silero VAD (if enabled)
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
            print(f"[STARTUP] WARNING: Silero VAD failed to load: {e}")
            GLOBAL_SILERO_VAD = None
    else:
        print("[STARTUP] Silero VAD disabled in config")
    
    total_time = time.time() - startup_start
    print(f"[STARTUP] All models ready ({total_time:.1f}s)")
    print("="*60 + "\n")
    print("[SYSTEM] All systems ready.")
    
    yield  # Server runs here
    
    # Cleanup on shutdown
    print("\n[SHUTDOWN] Cleaning up resources...")
    GLOBAL_SILERO_VAD = None
    GLOBAL_YAMNET_CLASSIFIER = None

app = FastAPI(lifespan=lifespan)

# ───────── SCRIPT DEFINITIONS ─────────
# Dynamic: loaded from S3, with hardcoded fallback
if _active_script:
    SCRIPTS = {
        ACTIVE_SCRIPT_ID: {
            "name": _active_script.get('name', 'Unknown Script'),
            "opener": _active_script.get('opener', ''),
            "logic": _active_script.get('logic', ''),
            "system_prompt": _active_script.get('system_prompt', ''),
            "end_goal": _active_script.get('end_goal', '')
        }
    }
else:
    SCRIPTS = {
        "script1": {
            "name": "Script 1: Mahatvapurn Jankari",
            "opener": "महत्वपूर्ण जानकारी का कॉल है। आपका डिशटीवी का कनेक्शन कंपनी में से आज हमेशा के लिए बंध होने जा रहा है। ये कनेक्शन को कभी भी चालू रखना चाहते हो तो आज ही छोटा 200 रुपए का रिचार्ज करवाना जरूरी है, तो रिचार्ज करवा रहे हो तो में कनेक्शन चालु रखु ?",
            "logic": """
        परिदृश्य (Scenario): आप एक ग्राहक को कॉल कर रहे हैं जिसका डिश टीवी कनेक्शन आज निष्क्रियता के कारण हमेशा के लिए बंद होने वाला है।
        आपका काम: उन्हें यह एहसास दिलाना कि अगर उन्होंने आज 200 रुपये का रिचार्ज नहीं किया, तो उनका बहुत बड़ा नुकसान होगा (कनेक्शन खो देंगे)।

        महत्वपूर्ण निर्देश (Critical Logic):
        - यदि ग्राहक "आज" (today) या "कल" (tomorrow) रिचार्ज करने के लिए मान जाए, तो उन्हें और बाध्य न करें (Do not force).
        - तुरंत कहें: "जी सर, करवा लीजियेगा, शुक्रिया।" और कॉल काट दें।
        
        मुख्य आपत्तियां और स्मार्ट जवाब (Smart Counters):
        1. "हाँ, मैं कर दूँगा" या "कल करूँगा" या "आज करूँगा" -> "जी सर, करवा लीजियेगा, शुक्रिया।" [HANGUP]
        2. "नहीं करना / बंद कर दो" -> "सर, जल्दबाजी मत कीजिये। भविष्य में कभी तो टीवी देखेंगे? आज बंद हो गया तो फिर से चालू नहीं होगा। सोच लीजिये।"
        3. "पैसे नहीं हैं" -> "सर, सिर्फ 200 रुपये की बात है। किसी दोस्त या रिश्तेदार से गूगल पे करवा लीजिये, पर इतना पुराना कनेक्शन मत खोइये।"
        4. "बाहर हूँ" -> "सर, ठीक है, आप कल तक करवा लीजियेगा। मैं अभी होल्ड पर डाल देती हूँ।"
        """,
            "system_prompt": ""
        }
    }

# Recording Storage (Force Absolute Path)
RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordings")
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR, exist_ok=True)
    print(f"[SYSTEM] Created recordings directory: {RECORDINGS_DIR}")
else:
    print(f"[SYSTEM] Using recordings directory: {RECORDINGS_DIR}")

# ───────── NOISE SUPPRESSION (PRODUCTION LEVEL) ─────────

class NoiseFilter:
    """
    Advanced noise suppression system that:
    1. Filters out low-frequency fan/AC noise
    2. Learns and subtracts background noise floor
    3. Rejects constant noise (spectral flatness check)
    4. Focuses on human voice frequencies (85-3500Hz)
    5. Applies energy gating for distant sounds
    """
    
    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.noise_floor = None
        self.silence_frames_for_learning = []
        
        # Design high-pass filter (removes fan/AC hum below 80Hz)
        nyquist = sample_rate / 2
        cutoff = 80  # Hz
        self.highpass_b, self.highpass_a = signal.butter(
            4, cutoff / nyquist, btype='high'
        )
        
        # Design band-pass filter for voice frequencies (85-3500Hz)
        low_cutoff = VOICE_FREQ_MIN / nyquist
        high_cutoff = VOICE_FREQ_MAX / nyquist
        self.bandpass_b, self.bandpass_a = signal.butter(
            2, [low_cutoff, high_cutoff], btype='band'
        )
        
    def calculate_spectral_flatness(self, audio: np.ndarray) -> float:
        """
        Calculate spectral flatness (0=tonal, 1=noise-like)
        Fan noise, AC hum = high flatness (>0.7)
        Human voice = low flatness (<0.5)
        """
        # FFT analysis
        spectrum = np.abs(rfft(audio))
        spectrum = spectrum[spectrum > 0]  # Avoid log(0)
        
        if len(spectrum) < 10:
            return 1.0
        
        # Geometric mean / Arithmetic mean
        geometric_mean = np.exp(np.mean(np.log(spectrum + 1e-10)))
        arithmetic_mean = np.mean(spectrum)
        
        if arithmetic_mean < 1e-10:
            return 1.0
            
        flatness = geometric_mean / arithmetic_mean
        return np.clip(flatness, 0, 1)
    
    def learn_noise_floor(self, audio: np.ndarray):
        """Learn background noise pattern from silence frames"""
        self.silence_frames_for_learning.append(audio)
        
        if len(self.silence_frames_for_learning) >= ADAPTIVE_LEARNING_FRAMES:
            # Average the silence frames to get noise floor
            self.noise_floor = np.mean(self.silence_frames_for_learning, axis=0)
            self.silence_frames_for_learning = []  # Reset
            # Only log once
            if not hasattr(self, '_noise_floor_logged'):
                print(f"[Noise Filter] Noise floor learned from {ADAPTIVE_LEARNING_FRAMES} frames")
                self._noise_floor_logged = True
    
    def process(self, audio: np.ndarray) -> tuple[np.ndarray, bool]:
        """
        Process audio chunk and return (filtered_audio, is_valid_speech)
        
        Returns:
            - filtered_audio: Noise-suppressed version
            - is_valid_speech: True if likely human voice, False if noise/distant
        """
        if len(audio) == 0:
            return audio, False
        
        # Step 1: High-pass filter (remove fan/AC hum)
        filtered = signal.filtfilt(self.highpass_b, self.highpass_a, audio)
        
        # Step 2: Band-pass filter (isolate voice frequencies 85-3500Hz)
        filtered = signal.filtfilt(self.bandpass_b, self.bandpass_a, filtered)
        
        # Step 3: Adaptive noise subtraction (REMOVED - causes distortion in time domain)
        # if self.noise_floor is not None and len(self.noise_floor) == len(filtered):
        #    filtered = filtered - (self.noise_floor * 0.5) 
        
        # Step 4: Calculate metrics
        energy = np.sqrt(np.mean(filtered ** 2))
        db = 20 * np.log10(energy + 1e-9)
        spectral_flatness = self.calculate_spectral_flatness(filtered)
        
        # Step 5: Validation checks
        is_valid = True
        rejection_reason = None
        
        # Check 1: Energy gate (reject distant/quiet sounds)
        if db < NOISE_GATE_DB:
            is_valid = False
            # Don't log every rejection (too spammy)
        
        # Check 2: Spectral flatness (reject constant noise like fans)
        elif spectral_flatness > SPECTRAL_FLATNESS_THRESHOLD:
            is_valid = False
            rejection_reason = f"Fan/constant noise (Flatness={spectral_flatness:.2f})"
            # Learn this as noise floor if it's constant
            if db < -30:  # Only learn from quiet backgrounds
                self.learn_noise_floor(audio)
        
        # Check 3: Voice detection via dB threshold
        elif db < INTERRUPTION_THRESHOLD_DB:
            is_valid = False
            # This is just silence, learn it
            if db < -30:
                self.learn_noise_floor(audio)
        
        if not is_valid and rejection_reason:
            print(f"[Noise Filter] {rejection_reason}")
        
        return filtered, is_valid

# ───────── HELPERS ─────────

def wav_header(raw: bytes) -> bytes:
    """Generate WAV header for raw PCM data"""
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(raw), b"WAVE",
        b"fmt ", 16, 1, 1,
        SAMPLE_RATE, SAMPLE_RATE * 2,
        2, 16,
        b"data", len(raw)
    ) + raw


def trim_audio(pcm_bytes: bytes) -> bytes:
    """Trim silence from start/end to reduce processing time"""
    if not pcm_bytes:
        return b""
    
    arr = np.frombuffer(pcm_bytes, dtype=np.int16)
    
    if len(arr) == 0:
        return pcm_bytes
    
    # Simple energy-based trimming
    energy = np.abs(arr)
    threshold = 32768 * 0.02  # 2% threshold
    mask = energy > threshold
    
    if not np.any(mask):
        return pcm_bytes  # Return original if all silence
    
    start = np.argmax(mask)
    end = len(mask) - np.argmax(mask[::-1])
    
    trimmed = arr[start:end].tobytes()
    
    # Ensure minimum length (at least 100ms = 1600 samples at 16kHz)
    min_samples = int(SAMPLE_RATE * 0.1)
    if len(trimmed) // 2 < min_samples:
        return pcm_bytes  # Return original if too short after trimming
    
    return trimmed


def trim_history(history: List[Dict]) -> List[Dict]:
    """Keep history within bounds to reduce token costs and latency"""
    if len(history) > MAX_HISTORY_LENGTH:
        return history[-MAX_HISTORY_LENGTH:]
    return history


# ───────── ASR (Speech-to-Text) ─────────

async def asr_transcribe(client: httpx.AsyncClient, pcm16: bytes, ws: WebSocket, semantic_filter: SemanticFilter = None) -> Optional[str]:
    """Transcribe audio using Gemini ASR with retry logic and semantic filtering"""
    print(f"[ASR] Sending {len(pcm16)} bytes…")
    start_time = time.time()
    
    # Trim audio to reduce processing time
    trimmed_pcm = trim_audio(pcm16)
    print(f"[ASR] Trimmed to {len(trimmed_pcm)} bytes")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key={GENARTML_SERVER_KEY}"
    
    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": "Transcribe audio to Hindi text. Return strictly text only."},
                {"inlineData": {
                    "mimeType": "audio/wav",
                    "data": base64.b64encode(wav_header(trimmed_pcm)).decode()
                }}
            ]
        }]
    }

    # Retry logic
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
                text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            else:
                print(f"[ASR] No candidates in response")
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
    
    # SEMANTIC FILTERING (Stage 4)
    if semantic_filter and not semantic_filter.is_meaningful(text):
        reason = semantic_filter.get_rejection_reason(text)
        print(f"\n[Semantic Filter] Ignored: '{text}' - {reason}\n")
        return None  # Don't trigger barge-in for filler words
    
    # EXPLICIT LOGGING FOR USER
    print(f"\n[USER SPOKE]: '{text}' ({elapsed:.2f}s)\n")
    
    # Barge-in: Stop current broadcast if user is speaking something meaningful
    if len(text.strip()) > 2:
        try:
            await ws.send_json({"type": "STOP_BROADCAST", "stop_broadcast": True})
        except Exception as e:
            print(f"[ASR] Failed to send STOP_BROADCAST: {e}")
        
    return text


# ───────── LLM Response Generation ─────────

async def generate_response(client: httpx.AsyncClient, user_text: str, history: List[Dict]) -> str:
    """Generate conversational response using Gemini LLM"""
    if not user_text:
        return "..."
    
    start_time = time.time()
    script = SCRIPTS[ACTIVE_SCRIPT_ID]
    
    # Filter out system messages
    clean_history = [m for m in history if m["parts"][0]["text"] != "SYSTEM_INITIATE_CALL"]

    system_prompt = ""
    
    # Use custom system_prompt from script if provided, otherwise build smart default
    if script.get('system_prompt', '').strip():
        system_prompt = script['system_prompt']
        # Append logic context if available
        if script.get('logic', '').strip():
            system_prompt += f"\n\nसंदर्भ और नियम:\n{script['logic']}"
    else:
        # Build a smart, generic system prompt from end_goal + logic
        end_goal = script.get('end_goal', '').strip()
        logic = script.get('logic', '').strip()
        
        system_prompt = f"""आप एक स्मार्ट AI कॉलिंग एजेंट हैं।
भाषा: स्वाभाविक हिंदी (Devanagari)।

{"मुख्य लक्ष्य (End Goal): " + end_goal if end_goal else ""}

निर्देश:
1. **इंसानों जैसा व्यवहार**: "जी सर", "मैं समझती हूँ" जैसे शब्द प्रयोग करें।
2. **संक्षिप्त (Short)**: अधिकतम 2 वाक्य।
3. **सहानुभूति**: समस्या सुनें, स्वीकार करें, फिर समाधान दें।
4. **स्मार्ट बातचीत**: ग्राहक की हर आपत्ति का बुद्धिमानी से जवाब दें। हार न मानें, लेकिन ज़बरदस्ती भी न करें।
5. **बाधा (Interruption)**: यदि उपयोगकर्ता बीच में टोके, तो तुरंत रुकें और उनकी बात सुनें।
6. **कोई टैग नहीं**: [Smart Counter] या [Objection] जैसे टैग कभी न बोलें।
7. **शब्दावली**: "RS" या "Rs" नहीं, हमेशा "रुपये" लिखें।
8. **कॉल समाप्ति**: जब ग्राहक राजी हो जाए तो शुक्रिया कहें और [HANGUP] लिखें। जब ग्राहक कॉल काटना चाहे तो "नमस्ते" कहें और [HANGUP] लिखें।

{"संदर्भ और नियम:\n" + logic if logic else ""}"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key={GENARTML_SERVER_KEY}"
    
    payload = {
        "contents": [*clean_history, {"role": "user", "parts": [{"text": user_text}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]}
    }

    # Retry logic
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
                print(f"[LLM] No candidates in response")
                return "माफ़ कीजिये, आवाज नहीं आई।"
            
            reply = data["candidates"][0]["content"]["parts"][0]["text"].strip().replace("*", "")
            
            # Post-processing: Ensure "RS" is spoken as "rupay" (Hindi text)
            # Log the bot reply explicitly
            print(f"\n[BOT REPLY]: '{reply}'\n")
            reply = reply.replace("RS", "रुपये").replace("Rs", "रुपये").replace("rs", "रुपये")
            
            # Post-processing: Remove everything in brackets [] to stop system tag leakage
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
    """
    Analyze the conversation history to determine the call outcome.
    Returns: { "agreed": bool, "commitment_date": str (ISO), "disposition": str, "notes": str }
    """
    if not history: return None
    
    print("[ANALYSIS] Analyzing call outcome...")
    
    # Filter only user messages for analysis context
    transcript = ""
    for msg in history:
        role = "User" if msg["role"] == "user" else "Bot"
        text = msg["parts"][0]["text"]
        transcript += f"{role}: {text}\n"

    system_prompt = """
    You are a Call Analyst. Analyze the conversation transcript and extract the outcome.
    
    Output JSON format only:
    {
        "agreed": true/false (did customer agree to recharge?),
        "commitment": "today" / "tomorrow" / "later" / "refused",
        "disposition": "Interested - Agreed Today" / "Interested - Agreed Tomorrow" / "Not Interested" / "Unclear",
        "notes": "Short summary of why"
    }
    
    Rules:
    - "Yes", "Okay", "I will do it", "Hanji", "Thik hai" -> Agreed = True
    - "No", "Not interested", "Band kar do", "Dena nahi hai" -> Agreed = False
    - If unclear or cut off -> Agreed = null (or omit)
    """

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key={GENARTML_SERVER_KEY}"
    
    payload = {
        "contents": [{
            "role": "user",
            "parts": [{"text": f"{system_prompt}\n\nTranscript:\n{transcript}"}]
        }],
        "generationConfig": { "responseMimeType": "application/json" }
    }

    try:
        r = await client.post(url, json=payload, timeout=5.0)
        if r.status_code == 200:
            data = r.json()
            if "candidates" in data:
                raw_json = data["candidates"][0]["content"]["parts"][0]["text"]
                result = json.loads(raw_json)
                
                # Normalize dates
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
        print(f"[ANALYSIS ERROR] {e}")
    
    return None

# ───────── TTS (Text-to-Speech) Streaming ─────────

async def tts_stream_generate(client: httpx.AsyncClient, text: str) -> AsyncGenerator[bytes, None]:
    """Stream TTS audio from ElevenLabs with proper error handling"""
    print(f"[TTS] Starting stream for: '{text[:50]}...'")
    start_time = time.time()

    # output_format MUST be in URL query param, NOT in JSON body
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{GENARTML_VOICE_ID}/stream?output_format=pcm_16000"
    
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
            "use_speaker_boost": True
        }
    }

    try:
        async with client.stream("POST", url, json=payload, headers=headers, timeout=15.0) as response:
            # Check for errors before streaming
            if response.status_code != 200:
                error_text = await response.aread()
                print(f"[TTS Error] HTTP {response.status_code}: {error_text[:200]}")
                return
            
            first_chunk = True
            buffer = b""
            CHUNK_SIZE = 640  # 20ms of 16kHz mono audio (16000 Hz * 2 bytes * 0.02s = 640 bytes)
            
            async for chunk in response.aiter_bytes():
                if first_chunk:
                    print(f"[TTS First Byte]: {time.time() - start_time:.2f}s")
                    first_chunk = False
                
                if chunk:
                    buffer += chunk
                    while len(buffer) >= CHUNK_SIZE:
                        yield buffer[:CHUNK_SIZE]
                        buffer = buffer[CHUNK_SIZE:]
            
            # Flush remaining audio WITHOUT padding (padding causes loud sound)
            if buffer and len(buffer) > 0:
                yield buffer  # Send as-is, no padding
                
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

    # Extract Call UUID from headers or query params
    call_uuid = (
        ws.headers.get("x-call-id") 
        or ws.headers.get("call-id") 
        or ws.headers.get("X-Freeswitch-Call-UUID")
        or ws.query_params.get("uuid")
        or ws.query_params.get("call_id")
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
    
    # [DB] Start call tracking
    print(f"[DB] Creating call record for {call_uuid}")
    tracker.start_call(call_uuid, phone_number)
    print(f"[DB] ✅ Call record created")
    
    db = get_db_session()

    script = SCRIPTS[ACTIVE_SCRIPT_ID]
    buffer = deque(maxlen=SAMPLE_RATE * MAX_BUFFER_SECONDS)     # For RAW ASR audio
    vad_buffer = deque(maxlen=SAMPLE_RATE * MAX_BUFFER_SECONDS) # For VAD calculations
    history: List[Dict] = []
    
    speaking = False
    last_voice = 0.0
    ws_alive = True
    current_task: asyncio.Task | None = None
    task_lock = asyncio.Lock()  # Prevent race conditions
    first_line_complete = False  # Track opener completion
    bot_speaking = False  # Track if bot is actively playing audio (for recording)
    
    # Initialize Local Recording (WebSocket-based, no FreeSWITCH needed)
    recorder = LocalRecorder(call_uuid)

    # Initialize noise filter
    noise_filter = NoiseFilter(sample_rate=SAMPLE_RATE)
    
    # Use GLOBAL pre-loaded models (instant, no download/initialization delay)
    classifier = GLOBAL_YAMNET_CLASSIFIER
    semantic_filter = SemanticFilter(language='hi', min_length=SEMANTIC_MIN_LENGTH)
    use_silero = USE_SILERO_VAD and GLOBAL_SILERO_VAD is not None
    
    if use_silero and GLOBAL_SILERO_VAD:
        # Create instance reference and reset state for this call
        silero_vad = GLOBAL_SILERO_VAD
        silero_vad.reset_noise_profile()  # Fresh noise profile for this call
        print("[Noise Filter] ✅ Using pre-loaded: Silero VAD + YAMNet + Semantic Filter")
    else:
        silero_vad = None
        if USE_SILERO_VAD:
            print("[Noise Filter] ⚠️ Silero VAD not available, using basic filters")
        print("[Noise Filter] Initialized: High-pass + Band-pass + YAMNet Classifier")
    
    if not classifier:
        print("[Noise Filter] ⚠️ YAMNet not available, noise classification disabled")

    async def cancel_current():
        """Safely cancel current processing task"""
        nonlocal current_task, bot_speaking
        async with task_lock:
            if current_task and not current_task.done():
                print("[SYSTEM] Cancelling previous task (barge-in)")
                bot_speaking = False  # Stop recording bot audio when cancelled
                current_task.cancel()
                try:
                    await asyncio.wait_for(current_task, timeout=0.5)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            current_task = None

    async def send_audio_safe(audio_chunk: bytes) -> bool:
        """Safely send audio, return False if WebSocket is closed"""
        if not ws_alive:
            return False
            
        try:
            # Only record bot audio if bot_speaking flag is True (not cancelled)
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

    # Create shared HTTP client with connection pooling
    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
    ) as client:
        
        async def process_audio(samples: np.ndarray):
            """Process captured audio: ASR -> LLM -> TTS"""
            nonlocal history, ws_alive
            
            try:
                pcm16 = (samples * 32767).astype(np.int16).tobytes()

                # ASR: Speech to Text (with semantic filter)
                user_text = await asr_transcribe(client, pcm16, ws, semantic_filter=semantic_filter)
                if not user_text or not ws_alive:
                    return

                print(f"\n[CUSTOMER] 🗣️  {user_text}")

                # Update history
                history.append({"role": "user", "parts": [{"text": user_text}]})
                
                # [DB] Log user message
                if call_uuid:
                    tracker.log_message(call_uuid, "user", user_text)
                    print(f"[DB] Logged customer message")
                
                history = trim_history(history)
                
                # LLM: Generate response
                reply_text = await generate_response(client, user_text, history)
                
                # Check for hangup signal
                should_hangup = False
                if "[HANGUP]" in reply_text:
                    should_hangup = True
                    reply_text = reply_text.replace("[HANGUP]", "").strip()

                print(f"[BOT] 🤖 {reply_text}")
                
                history.append({"role": "model", "parts": [{"text": reply_text}]})
                
                # [DB] Log bot message
                if call_uuid:
                    tracker.log_message(call_uuid, "model", reply_text)
                    print(f"[DB] Logged bot response")
                
                history = trim_history(history)

                # TTS: Text to Speech (streaming)
                bot_speaking = True  # Start recording bot audio
                async for audio_chunk in tts_stream_generate(client, reply_text):
                    if not ws_alive:
                        break
                    if not await send_audio_safe(audio_chunk):
                        break
                bot_speaking = False  # Stop recording bot audio
                
                # Hangup if requested
                if should_hangup:
                    print("[SYSTEM] Hanging up call as per script logic.")
                    # Signal frontend/dashboard that broadcast is stopped due to agreement/hangup
                    if ws_alive:
                        await ws.send_json({"type": "BROADCAST_STOPPED", "status": "success"})
                    
                    await asyncio.sleep(0.5) # clear buffer
                    # Primary: Terminate via FreeSWITCH ESL
                    if call_uuid:
                        print(f"[HANGUP] Triggering ESL hangup for {call_uuid}...")
                        await freeswitch_hangup(call_uuid)
                    
                    # Fallback: Send JSON signal
                    if ws_alive:
                        await ws.send_json({"type": "hangup"})
                        ws_alive = False

            except asyncio.CancelledError:
                print("[SYSTEM] Task cancelled gracefully")
                raise
            except Exception as e:
                print(f"[Process Error]: {e}")
                # FALLBACK: If an unexpected error occurs, don't leave user in silence.
                if ws_alive:
                    try:
                        fallback_text = "माफ़ कीजिये, आपकी आवाज़ स्पष्ट नहीं आ रही है। क्या आप दोहरा सकते हैं?"
                        print(f"[Fallback] Speaking: '{fallback_text}'")
                        async for audio_chunk in tts_stream_generate(client, fallback_text):
                            if not ws_alive: break
                            if not await send_audio_safe(audio_chunk): break
                    except Exception as fallback_error:
                        print(f"[Fallback Error]: {fallback_error}")

        # Send opener
        print(f"[Priya]: {script['opener']}")
        history.append({"role": "model", "parts": [{"text": script['opener']}]})
        # Opener Logic (Stream cached or generate on-the-fly)
        
        # Stream opener TTS
        cache_path = os.path.join(CACHE_DIR, f"{ACTIVE_SCRIPT_ID}_opener.pcm")
        
        total_opener_bytes = 0
        
        bot_speaking = True  # Start recording bot audio for opener
        
        # Use cached opener if available
        if os.path.exists(cache_path):
            print(f"[CACHE] Streaming opener from disk")
            chunk_size = 16000  # 0.5s chunks
            with open(cache_path, "rb") as f:
                while True:
                    data = f.read(chunk_size)
                    if not data:
                        break
                    if await send_audio_safe(data):
                        total_opener_bytes += len(data)
                    else:
                        break
                    await asyncio.sleep(0.02) # Control playback speed
        else:
            async for chunk in tts_stream_generate(client, script['opener']):
                if await send_audio_safe(chunk):
                    total_opener_bytes += len(chunk)
                else:
                    break
        bot_speaking = False # Stop recording bot audio after opener
        
        # Calculate playback duration
        playback_duration = total_opener_bytes / 32000.0
        
        # Use actual duration with minimal safety buffer (no forced 14s minimum)
        if playback_duration < 3.0:
            print(f"[SYSTEM] Warning: Calculated duration very short ({playback_duration:.2f}s). Setting minimum 3s.")
            playback_duration = 3.0
            
        print(f"[SYSTEM] Opener playback protection: {playback_duration:.2f}s\")")
        
        # Delay barge-in enable until audio ACTUALLY finishes playing
        async def enable_barge_in_delayed(delay: float):
            try:
                # Minimal buffer for network latency (reduced from 1.0s to 0.3s)
                safe_delay = delay + 0.3
                print(f"[SYSTEM] Locking barge-in for {safe_delay:.2f}s...")
                await asyncio.sleep(safe_delay)
                
                nonlocal first_line_complete
                first_line_complete = True
                
                # Finalize Silero VAD noise profiling after opener
                if silero_vad:
                    silero_vad.finalize_noise_profile()
                
                print("[SYSTEM] Opener playback complete - barge-in now enabled")
            except Exception as e:
                print(f"[SYSTEM] Timer error: {e}")
        
        asyncio.create_task(enable_barge_in_delayed(playback_duration))

        # Main message loop
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
                    # Write customer audio to recording
                    recorder.write_audio(msg["bytes"], source="customer")
                    
                    pcm = np.frombuffer(msg["bytes"], dtype=np.int16)
                    if pcm.size == 0:
                        continue

                    chunk = pcm.astype(np.float32) / 32768.0
                    
                    # ═══════════════════════════════════════════════════════════
                    # PRODUCTION 4-STAGE NOISE FILTERING PIPELINE
                    # ═══════════════════════════════════════════════════════════
                    
                    # STAGE 1: Spectral Filtering (High-pass + Band-pass)
                    filtered_chunk, is_valid_speech = noise_filter.process(chunk)
                    
                    # Calculate RMS energy from FILTERED audio
                    energy = np.sqrt(np.mean(filtered_chunk * filtered_chunk))
                    audio_db = 20 * np.log10(energy + 1e-9)

                    now = time.time()

                    # CRITICAL: Check for end of speech BEFORE rejecting frames
                    if speaking and now - last_voice > SILENCE_TIMEOUT:
                        # End of speech detected
                        speaking = False
                        duration = len(buffer) / SAMPLE_RATE
                        
                        if duration >= MIN_SPEECH_DURATION:
                            print(f"[VAD] End of speech detected ({duration:.2f}s). Processing...")
                            
                            # USE RAW BUFFER FOR ASR (Better quality)
                            samples = np.array(buffer, dtype=np.float32)
                            buffer.clear()
                            vad_buffer.clear()
                            
                            async with task_lock:
                                current_task = asyncio.create_task(process_audio(samples))
                        else:
                            print(f"[VAD] Speech too short ({duration:.2f}s), ignoring")
                            buffer.clear()
                            vad_buffer.clear()
                    
                    # If basic spectral filter rejected it, skip further processing
                    if not is_valid_speech:
                        # Still add to RAW buffer if we are currently speaking (to avoid cuts)
                        if speaking:
                            buffer.extend(chunk)
                        continue
                    
                    # STAGE 2: Silero VAD (ML-based speech detection)
                    if use_silero and silero_vad:
                        is_speech, vad_confidence = silero_vad.is_speech(filtered_chunk)
                        
                        if not is_speech or vad_confidence < SILERO_CONFIDENCE_THRESHOLD:
                            # Silero rejected - not human speech
                            if not speaking:  # Only log when not already speaking
                                pass  # Don't spam logs
                            # Still add to buffer if speaking to avoid cuts
                            if speaking:
                                buffer.extend(chunk)
                            continue
                    
                    # Add to buffers (passed both filters)
                    buffer.extend(chunk)         # Raw audio for ASR
                    vad_buffer.extend(filtered_chunk) # Filtered for VAD logic

                    # STAGE 3: Energy-based VAD + YAMNet Classification
                    # Check for silence timeout to end speaking session
                    if speaking and now - last_voice > SILENCE_TIMEOUT:
                        # Silence detected - customer finished speaking
                        speaking = False
                        
                        samples = np.array(buffer, dtype=np.float32) / 32767.0
                        if len(samples) >= MIN_SPEECH_DURATION * SAMPLE_RATE:
                            print(f"[VAD] 🎤 Speech ended after {now - last_voice:.2f}s silence ({len(samples)/SAMPLE_RATE:.2f}s total)")
                            # Queue ASR processing
                            if current_task is None or current_task.done():
                                current_task = asyncio.create_task(process_audio(samples))
                        else:
                            print(f"[VAD] Speech too short ({len(samples)/SAMPLE_RATE:.2f}s), ignored")
                        
                        buffer.clear()
                        vad_buffer.clear()
                        continue
                    
                    if audio_db > INTERRUPTION_THRESHOLD_DB:
                        # Voice activity detected
                        if not speaking:
                            # CRITICAL: NO BARGE-IN FOR OPENER
                            if not first_line_complete:
                                continue  # Ignore during opener
                            
                            # YAMNet CLASSIFICATION (check for dog barks, coughs, etc.)
                            if len(vad_buffer) > 4000: # Need >0.25s context
                                recent_audio = np.array(vad_buffer)[-15000:] # Last ~1s
                                is_safe, label, conf = classifier.classify(recent_audio)
                                
                                if not is_safe and conf > 0.45:
                                    print(f"[YAMNet] 🛡️ Ignored noise: {label} ({conf:.2f})")
                                    # Clear buffers to prevent accumulation of noise
                                    buffer.clear() 
                                    vad_buffer.clear()
                                    continue # IGNORE THIS SPEECH EVENT
                            
                            # All filters passed - this is likely speech
                            vad_status = f"Silero: {vad_confidence:.2f}" if use_silero and silero_vad else "Basic"
                            print(f"\n[VAD] ✅ Speech started (dB: {audio_db:.1f}, {vad_status})")
                            
                            # Immediate Barge-in: Stop audio instantly
                            await ws.send_json({"type": "STOP_BROADCAST", "stop_broadcast": True})
                            
                            # Mark interruption in history if bot was likely speaking
                            if current_task and not current_task.done():
                                history.append({"role": "model", "parts": [{"text": "[System: User interrupted previous response]"}]})
                                
                        speaking = True
                        last_voice = now
                        await cancel_current()
                    
                    # STAGE 4: Semantic filtering happens in asr_transcribe() after transcription

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
            
            # Close and finalize recording
            recording_filepath = recorder.close()
            
            final_path = None
            if recording_filepath and os.path.exists(recording_filepath):
                try:
                    print(f"[LOCAL RECORDING] File ready: {recording_filepath}")
                    
                    # S3 Upload
                    s3_url = upload_to_s3(recording_filepath)
                    if s3_url:
                        final_path = s3_url  # Use S3 URL for DB
                        print(f"[LOCAL RECORDING] ✅ Uploaded to S3")
                    else:
                        final_path = os.path.abspath(recording_filepath)  # Fallback to local path
                        print(f"[LOCAL RECORDING] ⚠️ S3 upload failed, using local path")

                except Exception as rec_e:
                    print(f"[LOCAL RECORDING ERROR] {rec_e}")
            else:
                print(f"[LOCAL RECORDING WARNING] File not created: {recording_filepath}")

            # AI Outcome Analysis
            ai_outcome = None
            if history:
                try:
                    async with httpx.AsyncClient() as client:
                        ai_outcome = await analyze_call_outcome(client, history)
                        if ai_outcome:
                            print(f"[ANALYSIS] Result: {ai_outcome}")
                except Exception as e:
                    print(f"[ANALYSIS ERROR] {e}")

            # [DB] End call tracking - THIS IS CRITICAL!
            if call_uuid:
                print(f"[DB] Ending call record for {call_uuid}")
                try:
                    try:
                        tracker.end_call(call_uuid, status="completed", recording_filename=final_path, outcome_override=ai_outcome)
                    except TypeError:
                        print("[DB WARNING] tracker.end_call signature mismatch. Attempting legacy call.")
                        tracker.end_call(call_uuid, status="completed")
                    
                    print(f"[DB] ✅ Call record closed")
                except Exception as db_error:
                    print(f"[DB ERROR] Failed to end call: {db_error}")
            else:
                print("[DB WARNING] No call_uuid to close")
            
            print("\n" + "=" * 50)
            print("[CALL] 📴 CALL ENDED")
            print("=" * 50 + "\n")


# ───────── HEALTH CHECK ─────────

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


# ───────── DASHBOARD & API INTEGRATION ─────────

# Add CORS for API access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and mount API routes
try:
    from api_routes import router as api_router
    app.include_router(api_router)
    print("[DASHBOARD] API routes mounted at /api")
except Exception as e:
    print(f"[DASHBOARD] Warning: Could not load API routes: {e}")

# Serve dashboard static files
try:
    DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard")
    if os.path.exists(DASHBOARD_DIR):
        # Mount static files (html=True serves index.html automatically)
        app.mount("/dashboard", StaticFiles(directory=DASHBOARD_DIR, html=True), name="dashboard")
        print(f"[DASHBOARD] Served at http://0.0.0.0:8085/dashboard/")
        print(f"[DASHBOARD] Files: {', '.join(os.listdir(DASHBOARD_DIR))}")
    else:
        print(f"[DASHBOARD] Warning: Dashboard directory not found at {DASHBOARD_DIR}")
except Exception as e:
    print(f"[DASHBOARD] Warning: Could not mount dashboard: {e}")


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("Lakhu Teleservices Voice Bot System")
    print("=" * 60)
    print(f"\nWebSocket: ws://62.171.170.48:8085/")
    print(f"Dashboard: http://62.171.170.48:8085/dashboard/")
    print(f"API: http://62.171.170.48:8085/api/")
    print(f"Health: http://62.171.170.48:8085/health")
    print("\n" + "=" * 60 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8085)
