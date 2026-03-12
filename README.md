# Callex AI — Enterprise Voice Agent Platform

> Full-stack AI-powered outbound/inbound call center platform with real-time voice synthesis, barge-in interruption handling, and an enterprise admin dashboard.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Running Locally](#running-locally)
- [Running in Production](#running-in-production)
- [Environment Variables](#environment-variables)
- [AI Engine (Python)](#ai-engine-python)
- [Enterprise Backend (Node.js)](#enterprise-backend-nodejs)
- [Enterprise Frontend (React)](#enterprise-frontend-react)
- [External Developer API](#external-developer-api)
- [Database](#database)
- [Deployment](#deployment)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CALLEX PLATFORM                          │
├─────────────────┬──────────────────────┬────────────────────────┤
│   AI Engine     │  Enterprise Backend  │  Enterprise Frontend   │
│   (Python)      │  (Node.js/Express)   │  (React/Vite)          │
│   Port: 8085    │  Port: 4000          │  Served by Backend     │
├─────────────────┼──────────────────────┼────────────────────────┤
│ • FastAPI        │ • REST API (19 routes)│ • 18 Pages (SPA)      │
│ • WebSocket      │ • WebSocket (Live)    │ • React Router        │
│ • FreeSWITCH ESL │ • Prisma ORM          │ • Real-time WS        │
│ • ElevenLabs TTS │ • JWT Auth            │                       │
│ • Gemini STT/LLM │ • API Key Auth        │                       │
│ • 6-Layer Gating │ • External API        │                       │
└─────────────────┴──────────────────────┴────────────────────────┘
         │                   │                       │
         ▼                   ▼                       ▼
   FreeSWITCH          SQLite (Prisma)         Static Dist
   (SIP/VoIP)          Firebase Storage        (Built by Vite)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **AI Engine** | Python 3.11, FastAPI, Uvicorn, WebSocket |
| **Voice** | ElevenLabs TTS, Gemini 2.5 Flash (STT/LLM) |
| **Audio Processing** | WebRTC VAD, Silero VAD, RNNoise, YAMNet, Resemblyzer |
| **Telephony** | FreeSWITCH (ESL), SIP/VoIP |
| **Backend** | Node.js, Express, Prisma, Socket.IO |
| **Frontend** | React 18, Vite, React Router |
| **Database** | SQLite (via Prisma), SQLAlchemy (Python side) |
| **Storage** | Firebase Storage (call recordings) |
| **Auth** | JWT (dashboard), API Keys (external API) |
| **Process Manager** | PM2 |

---

## Project Structure

```
callex/
├── app/                          # 🧠 AI ENGINE (Python)
│   ├── main.py                   # Core AI call handler (FastAPI + WebSocket)
│   ├── audio/                    # Audio processing pipeline
│   │   ├── gating.py             # 6-layer audio gating pipeline
│   │   ├── classifier.py         # YAMNet sound event classifier
│   │   ├── vad_silero.py         # Silero VAD (Voice Activity Detection)
│   │   ├── semantic.py           # Semantic intent filter (faster-whisper)
│   │   ├── speaker_verifier.py   # Speaker verification (Resemblyzer)
│   │   └── verification.py       # Double-verification system
│   ├── core/                     # Core configuration & data
│   │   ├── agent_loader.py       # Load agent configs from DB
│   │   ├── config.py             # Global config constants
│   │   ├── config_manager.py     # JSON config manager
│   │   └── database.py           # SQLAlchemy call logging
│   ├── managers/                  # Business logic managers
│   │   ├── recordings.py         # Firebase recording upload
│   │   └── scripts.py            # Dynamic script engine
│   └── utils/                     # Utilities
│
├── enterprise/                    # 🏢 ENTERPRISE DASHBOARD
│   ├── backend/                   # Node.js API Server
│   │   ├── src/
│   │   │   ├── index.js           # Express entry point (port 4000)
│   │   │   ├── routes/            # 19 API route files
│   │   │   │   ├── agents.js      # Agent CRUD + prompt versioning
│   │   │   │   ├── analytics.js   # Call logs, stats, AI summarization
│   │   │   │   ├── auth.js        # JWT login/register
│   │   │   │   ├── billing.js     # Usage & billing
│   │   │   │   ├── dashboard.js   # Dashboard stats & metrics
│   │   │   │   ├── dialer.js      # Campaign dialer (bulk calling)
│   │   │   │   ├── external.js    # External Developer API (API key auth)
│   │   │   │   ├── followups.js   # Follow-up scheduling
│   │   │   │   ├── integrations.js# CRM integrations
│   │   │   │   ├── knowledge.js   # Knowledge base management
│   │   │   │   ├── qa.js          # Quality assurance scoring
│   │   │   │   ├── reports.js     # CSV/PDF report generation
│   │   │   │   ├── routing.js     # Call routing rules
│   │   │   │   ├── security.js    # Security & voice signatures
│   │   │   │   ├── settings.js    # API keys, webhooks
│   │   │   │   ├── simulation.js  # Agent simulation & testing
│   │   │   │   ├── supervisor.js  # Live call supervisor
│   │   │   │   ├── telecom.js     # SIP trunk management
│   │   │   │   └── wfm.js         # Workforce management
│   │   │   ├── ws/                # WebSocket handlers
│   │   │   │   ├── supervisor.js  # Real-time call monitoring
│   │   │   │   └── dashboard.js   # Live dashboard updates
│   │   │   └── prisma/
│   │   │       └── schema.prisma  # Database schema
│   │   └── package.json
│   │
│   ├── frontend/                  # React Dashboard (Vite)
│   │   ├── src/
│   │   │   ├── App.jsx            # Main router
│   │   │   ├── main.jsx           # React entry point
│   │   │   ├── pages/             # 18 page components
│   │   │   │   ├── Dashboard.jsx  # Home dashboard with KPIs
│   │   │   │   ├── AgentStudio.jsx# Agent builder (51KB — largest)
│   │   │   │   ├── Analytics.jsx  # Call analytics & logs
│   │   │   │   ├── Dialer.jsx     # Campaign dialer UI
│   │   │   │   ├── LiveSupervisor.jsx # Real-time call monitoring
│   │   │   │   ├── Simulation.jsx # Agent testing sandbox
│   │   │   │   ├── Settings.jsx   # API keys & webhooks
│   │   │   │   ├── Login.jsx      # Authentication
│   │   │   │   ├── KnowledgeBase.jsx
│   │   │   │   ├── Reports.jsx
│   │   │   │   ├── Routing.jsx
│   │   │   │   ├── Integrations.jsx
│   │   │   │   ├── Security.jsx
│   │   │   │   ├── QA.jsx
│   │   │   │   ├── WFM.jsx
│   │   │   │   ├── Telecom.jsx
│   │   │   │   ├── Billing.jsx
│   │   │   │   └── FollowUps.jsx
│   │   │   ├── components/        # Reusable UI components
│   │   │   └── lib/
│   │   │       └── api.js         # API client
│   │   ├── dist/                  # Built production files (served by backend)
│   │   └── vite.config.js
│   │
│   └── start.sh                   # Start script
│
├── scripts/                       # Deployment & voice scripts
│   ├── deployment/
│   └── voices/                    # Voice sample files
│
├── data/                          # SQLite databases
├── recordings/                    # Call recordings (local cache)
├── cache/                         # Model cache files
│
├── .env                           # Environment variables
├── requirements.txt               # Python dependencies
├── API_DOCUMENTATION.md           # External API docs (for clients)
├── API_DOCUMENTATION.pdf          # PDF version
├── TUNING.md                      # Audio tuning parameters
└── README.md                      # This file
```

---

## Setup & Installation

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **FreeSWITCH** (for VoIP/SIP)
- **PM2** (`npm install -g pm2`)
- **SQLite** (bundled with Python)

### 1. Clone the Repository

```bash
git clone https://github.com/daksh-wq/callex.git
cd callex
```

### 2. Python AI Engine Setup

```bash
# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Enterprise Backend Setup

```bash
cd enterprise/backend
npm install

# Push the Prisma schema to create/update the database
npx prisma db push

# Seed initial data (optional)
npm run db:seed
```

### 4. Enterprise Frontend Setup

```bash
cd enterprise/frontend
npm install

# Build for production (output goes to dist/)
npm run build
```

---

## Running Locally

### Start Everything

```bash
# Terminal 1: AI Engine (Python)
cd /path/to/callex
uvicorn app.main:app --host 0.0.0.0 --port 8085

# Terminal 2: Enterprise Backend (serves dashboard + API)
cd enterprise/backend
node src/index.js
```

### Access Points

| Service | URL |
|---------|-----|
| **Admin Dashboard** | http://localhost:4000 |
| **Internal API** | http://localhost:4000/api/... |
| **External Developer API** | http://localhost:4000/api/v1/agents |
| **AI Engine** | http://localhost:8085 |

> **Note:** The Enterprise Backend serves the React frontend automatically from `enterprise/frontend/dist/`. You do NOT need to start the frontend separately in production.

### For Frontend Development (with hot reload)

```bash
# If actively developing the frontend:
cd enterprise/frontend
npm run dev    # Runs Vite on port 3000 with proxy to backend
```

---

## Running in Production (PM2)

```bash
# AI Engine
pm2 start "uvicorn app.main:app --host 0.0.0.0 --port 8085" --name callex-AI-AMD

# Enterprise Backend (also serves frontend)
pm2 start enterprise/backend/src/index.js --name callex-backend

# Save PM2 config
pm2 save
```

### PM2 Quick Reference

```bash
pm2 list                    # List all processes
pm2 logs <id>               # View logs
pm2 restart <id>            # Restart a process
pm2 restart all             # Restart everything
pm2 monit                   # Real-time monitoring
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
# ElevenLabs (TTS)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
GENARTML_SECRET_KEY=your_elevenlabs_api_key

# Gemini (STT/LLM)
GEMINI_API_KEY=your_gemini_api_key

# Firebase (Call Recording Storage)
FIREBASE_CREDENTIALS_PATH=firebase_credentials.json
FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com

# JWT Secret (auto-generated if not set)
JWT_SECRET=your_jwt_secret

# Server Port
PORT=4000
```

---

## AI Engine (Python)

### Core: `app/main.py`

The heart of the platform. Handles real-time voice calls via WebSocket:

1. **Receives audio** from FreeSWITCH (16-bit PCM, 16kHz)
2. **Processes through 6-layer gating pipeline** to detect valid speech
3. **Transcribes** using Gemini 2.5 Flash
4. **Generates response** using Gemini LLM with agent's system prompt
5. **Synthesizes speech** using ElevenLabs TTS
6. **Streams audio back** to FreeSWITCH

### Audio Gating Pipeline (`app/audio/gating.py`)

The 6-layer pipeline prevents false interruptions:

```
Audio Input → Layer 1: Noise Suppression (RNNoise/Spectral)
            → Layer 2: Voice Activity Detection (Silero VAD)
            → Layer 3: Speaker Verification (Resemblyzer) [optional]
            → Layer 4: Duration Validation (400ms min)
            → Layer 5: Bot Ignore Window (500ms grace)
            → Layer 5.5: Sound Classification (YAMNet - blocks 34 sounds)
            → Layer 6: Semantic Intent Confirmation (ASR)
            → ✅ Valid Interruption
```

| File | Purpose |
|------|---------|
| `gating.py` | Main pipeline orchestrator |
| `classifier.py` | YAMNet-based non-speech sound filter (dog bark, car horn, etc.) |
| `vad_silero.py` | Silero VAD model for speech detection |
| `semantic.py` | Faster-whisper semantic intent verification |
| `speaker_verifier.py` | Resemblyzer speaker embedding verification |
| `verification.py` | Mathematical confidence scoring + time-based double verification |

### Key Features

- **Barge-in support** — customer can interrupt the AI mid-sentence
- **Multi-language** — supports Hindi, English, and dynamic code-switching
- **Real-time** — target latency < 150ms
- **Outbound dialing** — AI initiates calls via FreeSWITCH originate
- **Call recording** — recordings saved to Firebase Storage
- **Dynamic scripts** — agent prompts loaded from database

---

## Enterprise Backend (Node.js)

### Entry Point: `enterprise/backend/src/index.js`

Express server on **port 4000** with:
- 19 REST API route files
- WebSocket support (live supervisor, dashboard)
- JWT authentication (dashboard users)
- API Key authentication (external developers)
- Static file serving (React dashboard from `dist/`)
- Prisma ORM for database access

### API Routes

| Route | File | Purpose |
|-------|------|---------|
| `/api/dashboard` | `dashboard.js` | KPIs, stats, system events |
| `/api/agents` | `agents.js` | Agent CRUD, prompt versioning, voice config |
| `/api/analytics` | `analytics.js` | Call logs, AI summarization, sentiment |
| `/api/simulation` | `simulation.js` | Agent testing, adversarial tests, live chat |
| `/api/dialer` | `dialer.js` | Campaign management, bulk calling |
| `/api/supervisor` | `supervisor.js` | Live call monitoring |
| `/api/knowledge` | `knowledge.js` | Knowledge base documents |
| `/api/reports` | `reports.js` | CSV/PDF report generation |
| `/api/routing` | `routing.js` | Call routing rules |
| `/api/integrations` | `integrations.js` | CRM integrations |
| `/api/security` | `security.js` | Voice signatures, security |
| `/api/settings` | `settings.js` | API keys, webhooks |
| `/api/qa` | `qa.js` | Quality assurance scoring |
| `/api/wfm` | `wfm.js` | Workforce management |
| `/api/telecom` | `telecom.js` | SIP trunk management |
| `/api/billing` | `billing.js` | Usage & billing |
| `/api/auth` | `auth.js` | Login, register, JWT |
| `/api/followups` | `followups.js` | Follow-up scheduling |
| `/api/v1/*` | `external.js` | External Developer API (API Key auth) |

### External Developer API

For third-party integrations. Secured with API keys (generated from Settings page):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/agents` | List agents (paginated) |
| `POST` | `/api/v1/agents` | Create agent |
| `GET` | `/api/v1/agents/:id` | Get agent details |
| `PUT` | `/api/v1/agents/:id` | Update agent |
| `DELETE` | `/api/v1/agents/:id` | Delete agent |

> Full documentation: See `API_DOCUMENTATION.md` or `API_DOCUMENTATION.pdf`

---

## Enterprise Frontend (React)

### 18 Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Home — KPIs, active calls, charts |
| **Agent Studio** | Full agent builder — prompts, voice, behavior, follow-ups |
| **Analytics** | Call logs, sentiment analysis, AI call summaries |
| **Dialer** | Campaign dialer — upload numbers, start bulk calls |
| **Live Supervisor** | Real-time call monitoring with WebSocket |
| **Simulation** | Test agents before deploying |
| **Knowledge Base** | Upload documents for agent context |
| **Reports** | Generate/download CSV & PDF reports |
| **Routing** | Call routing rules |
| **Integrations** | CRM & tool connections |
| **Security** | Voice signatures, security settings |
| **Settings** | API key generation, webhook config |
| **QA** | Quality assurance scoring |
| **WFM** | Workforce management |
| **Telecom** | SIP trunk management |
| **Billing** | Usage tracking & billing |
| **Follow Ups** | Scheduled follow-up calls |
| **Login** | JWT authentication |

### Building the Frontend

```bash
cd enterprise/frontend
npm run build    # Outputs to dist/ — served by backend automatically
```

> The backend serves `dist/` as static files with SPA catch-all routing. No need to run the frontend separately in production.

---

## Database

### Prisma Schema (Enterprise)

Located at: `enterprise/backend/prisma/schema.prisma`

Key models:
- **Agent** — AI agent configuration (50+ fields)
- **PromptVersion** — Versioned prompts per agent
- **Call** — Call logs with transcripts, sentiment, recordings
- **Campaign** — Dialer campaigns
- **ApiKey** — Hashed API keys for external API
- **SystemEvent** — Platform events log
- **User** — Dashboard users

### SQLAlchemy (Python AI Engine)

Located at: `app/core/database.py`

Used for real-time call tracking during active calls (call outcomes, durations, etc.).

### Running Migrations

```bash
cd enterprise/backend

# Apply schema changes
npx prisma db push

# Generate client after schema changes
npx prisma generate

# Open Prisma Studio (GUI database browser)
npx prisma studio
```

---

## Deployment

### Production Server

The platform runs on: `62.171.170.48`

| PM2 ID | Process | Port | Description |
|--------|---------|------|-------------|
| 20 | `callex-AI-AMD` | 8085 | Python AI Engine |
| 21 | `callex-backend` | 4000 | Node.js Backend + Dashboard |

### Deploy Updates

```bash
# SSH into server
ssh root@62.171.170.48

# Pull latest code
cd /usr/src/sumit/elevenlabs/freeswitch-elevenlabs-bridge
git pull origin main

# If frontend changed — rebuild
cd enterprise/frontend
npm install && npm run build

# If backend deps changed
cd ../backend
npm install

# Restart services
pm2 restart 21              # Backend
pm2 restart 20              # AI Engine (if changed)

# Check logs
pm2 logs 21 --lines 20 --nostream
```

### Dashboard URL

- **Production:** http://62.171.170.48:4000
- **Local:** http://localhost:4000

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `.env` | API keys, credentials |
| `bot_config.json` | AI agent behavior tuning |
| `enterprise/backend/prisma/schema.prisma` | Database schema |
| `enterprise/frontend/vite.config.js` | Frontend build config |
| `TUNING.md` | Audio pipeline tuning guide |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `EADDRINUSE` port 4000 | `kill $(lsof -t -i:4000)` then restart |
| `ERR_MODULE_NOT_FOUND` | `cd enterprise/backend && npm install` |
| White screen on dashboard | Rebuild frontend: `cd enterprise/frontend && npm run build` |
| `Cannot GET /login` | Ensure `dist/` folder exists and backend is restarted |
| Prisma table missing | `cd enterprise/backend && npx prisma db push` |
| PM2 process offline | `pm2 restart <id> && pm2 logs <id>` |

---

*Built by Callex Engineering Team — 2026*
