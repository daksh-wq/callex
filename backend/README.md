# Lakhu Teleservices - Backend

Python/FastAPI voice bot and REST API server.

## Requirements

```bash
pip install -r requirements.txt
```

## Start the server

```bash
./run.sh
# or directly:
python test.py
```

Server runs on: `http://0.0.0.0:8085`  
API available at: `http://localhost:8085/api`  
Health check: `http://localhost:8085/health`

## Key Files

| File | Purpose |
|------|---------|
| `test.py` | Main FastAPI app + WebSocket voice bot |
| `api_routes.py` | REST API routes (calls, analytics, scripts, settings) |
| `database.py` | SQLAlchemy models + DB session |
| `config.py` | Centralised configuration & credentials |
| `config_manager.py` | Live bot configuration manager |
| `script_manager.py` | Call script management |
| `recording_manager.py` | Audio recording + S3 upload |
| `audio_gating.py` | Noise gating & VAD |
| `silero_vad_filter.py` | Silero ML-based VAD |
| `semantic_filter.py` | Barge-in / filler word filter |

## Data Storage

- `call_recordings.db` — SQLite database (auto-created)
- `recordings/` — Local WAV recordings
- `cache/` — Cached TTS audio
- `scripts/` — Saved call scripts (JSON)
