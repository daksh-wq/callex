# Callex AI — Developer API Documentation

> **Version:** 2.0 &nbsp;|&nbsp; **Base URL:** `http://62.171.170.48:4000` &nbsp;|&nbsp; **Last Updated:** March 13, 2026

---

## Table of Contents

1. [Admin Panel](#admin-panel)
2. [Getting Your API Key](#getting-your-api-key)
3. [Authentication](#authentication)
4. [API Endpoints](#api-endpoints)
   - **Agents**
     - [List Agents](#1-list-all-agents)
     - [Create Agent](#2-create-a-new-agent)
     - [Get Agent Details](#3-get-agent-details)
     - [Edit Agent](#4-edit-an-agent)
     - [Delete Agent](#5-delete-an-agent)
   - **Calls & Transcripts**
     - [List Calls](#6-list-all-calls)
     - [Get Call Details](#7-get-call-details)
     - [Get Call Transcript](#8-get-call-transcript)
   - **Voices**
     - [List Available Voices](#9-list-available-voices)
5. [Available Voices Reference](#available-voices-reference)
6. [Agent Configuration Reference](#agent-configuration-reference)
7. [Error Reference](#error-reference)
8. [Best Practices](#best-practices)

---

## Admin Panel

Everything you can do via the API can also be done through the **Callex Admin Panel**.

🔗 **Admin Panel URL:** [http://62.171.170.48:4000](http://62.171.170.48:4000)

| Feature | Where to Find |
|---------|---------------|
| **Create, Edit & Delete Agents** | Sidebar → **Agent Studio** |
| **Generate & Revoke API Keys** | Sidebar → **Settings** → API Keys |
| **Live Call Monitoring** | Sidebar → **Live Supervisor** |
| **Call Analytics & Logs** | Sidebar → **Analytics** |
| **Campaign Management (Dialer)** | Sidebar → **Dialer** |
| **Knowledge Base Management** | Sidebar → **Knowledge Base** |
| **Call Routing Rules** | Sidebar → **Routing** |
| **CRM & Tool Integrations** | Sidebar → **Integrations** |
| **Quality Assurance** | Sidebar → **QA** |
| **Reports & Exports** | Sidebar → **Reports** |
| **Billing & Usage** | Sidebar → **Billing** |
| **Agent Simulation & Testing** | Sidebar → **Simulation** |

---

## Getting Your API Key

1. Open the **Admin Panel** → [http://62.171.170.48:4000](http://62.171.170.48:4000) and **log in**.
2. Click **Settings** in the left sidebar.
3. Enter a **Key Name** (e.g., "Production App").
4. Select the **Environment**: **Test** (`ck_test_`) or **Live** (`ck_live_`).
5. Click **"Generate"**.

> ⚠️ The full API key is shown **only once**. Copy it immediately.

| Environment | Prefix | Example |
|-------------|--------|---------|
| Test | `ck_test_` | `ck_test_a1b2c3d4_e5f6g7h8i9j0k1l2m3n4o5p6` |
| Live | `ck_live_` | `ck_live_f8e7d6c5_b4a3z2y1x0w9v8u7t6s5r4q3` |

---

## Authentication

All API requests require your API key in the `Authorization` header:

```
Authorization: Bearer <YOUR_API_KEY>
```

---

## API Endpoints

---

### 1. List All Agents

```
GET /api/v1/agents
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `10` | Items per page (max 100) |
| `status` | string | — | Filter: `draft`, `active`, `paused` |

```bash
curl -X GET "http://62.171.170.48:4000/api/v1/agents?page=1&limit=5&status=active" \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{
  "agents": [
    {
      "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
      "name": "Priya - Sales",
      "status": "active",
      "language": "hi-IN",
      "createdAt": "2026-03-12T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 12, "totalPages": 3 }
}
```

---

### 2. Create a New Agent

```
POST /api/v1/agents
```

Only `name` is required. Everything else has smart defaults.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Agent name |
| `description` | string | No | `""` | Agent description |
| `systemPrompt` | string | No | `""` | LLM instructions & personality |
| `openingLine` | string | No | `""` | First thing AI says on call |
| `voice` | string | No | `"MF4J4IDTRo0AxOO4dpFR"` | Callex Voice ID (see [Voices](#9-list-available-voices)) |
| `language` | string | No | `"en-US"` | Language code |
| `temperature` | float | No | `0.7` | Creativity (0.0 – 1.0) |
| `maxDuration` | integer | No | `30` | Max call minutes |
| `bargeInMode` | string | No | `"balanced"` | `aggressive`, `balanced`, `polite` |
| `voicemailLogic` | string | No | `"hangup"` | `hangup`, `leave_message`, `human_escalate` |

> 📘 See the full [Agent Configuration Reference](#agent-configuration-reference) for all 50+ fields.

```bash
curl -X POST http://62.171.170.48:4000/api/v1/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_live_YOUR_KEY" \
  -d '{
    "name": "Sales Agent - Premium",
    "systemPrompt": "You are a professional sales agent. Be persuasive but polite.",
    "openingLine": "Hello! I am calling from Acme Corp regarding an exclusive offer.",
    "voice": "MF4J4IDTRo0AxOO4dpFR",
    "temperature": 0.6,
    "maxDuration": 15
  }'
```

**Response — `201 Created`**

```json
{
  "message": "Agent successfully created.",
  "agentId": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "agent": {
    "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
    "name": "Sales Agent - Premium",
    "status": "draft",
    "createdAt": "2026-03-12T10:00:00.000Z"
  }
}
```

> 💡 New agents start as `draft`. Activate via the Admin Panel or the Edit API.

---

### 3. Get Agent Details

```
GET /api/v1/agents/{agentId}
```

```bash
curl -X GET http://62.171.170.48:4000/api/v1/agents/5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1 \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{
  "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "name": "Sales Agent - Premium",
  "systemPrompt": "You are a professional sales agent.",
  "voice": "MF4J4IDTRo0AxOO4dpFR",
  "language": "hi-IN",
  "temperature": 0.6,
  "PromptVersion": [
    { "version": 1, "prompt": "You are a professional sales agent.", "isActive": true }
  ]
}
```

---

### 4. Edit an Agent

Update any fields of an existing agent. Send **only the fields you want to change**.

```
PUT /api/v1/agents/{agentId}
```

```bash
curl -X PUT http://62.171.170.48:4000/api/v1/agents/5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_live_YOUR_KEY" \
  -d '{
    "name": "Sales Agent - Enterprise",
    "temperature": 0.5,
    "status": "active"
  }'
```

**Response — `200 OK`**

```json
{
  "message": "Agent updated successfully.",
  "agentId": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "agent": { "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1", "name": "Sales Agent - Enterprise", "status": "active" }
}
```

---

### 5. Delete an Agent

> ⚠️ **This action is irreversible.** Deletes the agent, all prompt versions, and follow-ups.

```
DELETE /api/v1/agents/{agentId}
```

```bash
curl -X DELETE http://62.171.170.48:4000/api/v1/agents/5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1 \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{ "message": "Agent deleted successfully.", "agentId": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1" }
```

---

### 6. List All Calls

Retrieve a paginated list of all calls made through your agents.

```
GET /api/v1/calls
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page (max 100) |
| `status` | string | — | Filter: `active`, `completed`, `failed` |
| `agentId` | string | — | Filter by specific agent ID |

```bash
curl -X GET "http://62.171.170.48:4000/api/v1/calls?page=1&limit=10&status=completed" \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{
  "calls": [
    {
      "id": "d9e4ff50-eeba-465d-a68a-fca353fafcf7",
      "phoneNumber": "+919876543210",
      "agentId": "1a81e4bb-f51d-4f22-abc1-c7b9686e3019",
      "agentName": "Priya - Sales",
      "status": "completed",
      "duration": 145,
      "sentiment": "positive",
      "hasTranscript": true,
      "hasRecording": true,
      "recordingUrl": "https://storage.googleapis.com/...",
      "startedAt": "2026-03-13T12:30:00.000Z",
      "endedAt": "2026-03-13T12:32:25.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 47, "totalPages": 5 }
}
```

---

### 7. Get Call Details

Retrieve full call details including the complete transcript and recording URL.

```
GET /api/v1/calls/{callId}
```

```bash
curl -X GET http://62.171.170.48:4000/api/v1/calls/d9e4ff50-eeba-465d-a68a-fca353fafcf7 \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{
  "id": "d9e4ff50-eeba-465d-a68a-fca353fafcf7",
  "phoneNumber": "+919876543210",
  "agentId": "1a81e4bb-f51d-4f22-abc1-c7b9686e3019",
  "agentName": "Priya - Sales",
  "status": "completed",
  "duration": 145,
  "sentiment": "positive",
  "transcript": "AI: नमस्ते, मैं Callex से बोल रही हूँ...\nCustomer: हाँ बोलिए...\nAI: आपका कनेक्शन बंद होने वाला है...",
  "transcriptMessages": [
    { "role": "ai", "text": "नमस्ते, मैं Callex से बोल रही हूँ...", "timestamp": 1710340200 },
    { "role": "customer", "text": "हाँ बोलिए...", "timestamp": 1710340205 },
    { "role": "ai", "text": "आपका कनेक्शन बंद होने वाला है...", "timestamp": 1710340210 }
  ],
  "recordingUrl": "https://storage.googleapis.com/...",
  "summary": "Customer agreed to recharge within 24 hours.",
  "outcome": { "result": "agreed", "followUpRequired": false },
  "startedAt": "2026-03-13T12:30:00.000Z",
  "endedAt": "2026-03-13T12:32:25.000Z"
}
```

---

### 8. Get Call Transcript

Retrieve just the transcript for a specific call.

```
GET /api/v1/calls/{callId}/transcript
```

```bash
curl -X GET http://62.171.170.48:4000/api/v1/calls/d9e4ff50-eeba-465d-a68a-fca353fafcf7/transcript \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{
  "callId": "d9e4ff50-eeba-465d-a68a-fca353fafcf7",
  "transcript": "AI: नमस्ते, मैं Callex से बोल रही हूँ...\nCustomer: हाँ बोलिए...",
  "messages": [
    { "role": "ai", "text": "नमस्ते, मैं Callex से बोल रही हूँ...", "timestamp": 1710340200 },
    { "role": "customer", "text": "हाँ बोलिए...", "timestamp": 1710340205 }
  ],
  "messageCount": 2
}
```

---

### 9. List Available Voices

Get all available Callex voices that can be assigned to agents.

```
GET /api/v1/voices
```

```bash
curl -X GET http://62.171.170.48:4000/api/v1/voices \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

**Response — `200 OK`**

```json
{
  "voices": [
    {
      "id": "MF4J4IDTRo0AxOO4dpFR",
      "name": "Devi",
      "description": "Clear Hindi female voice — crisp and natural",
      "language": "hi-IN",
      "gender": "female",
      "style": "professional",
      "isDefault": true
    },
    {
      "id": "1qEiC6qsybMkmnNdVMbK",
      "name": "Monika",
      "description": "Modulated professional female voice",
      "language": "hi-IN",
      "gender": "female",
      "style": "professional",
      "isDefault": false
    },
    {
      "id": "qDuRKMlYmrm8trt5QyBn",
      "name": "Taksh",
      "description": "Powerful and commanding male voice",
      "language": "hi-IN",
      "gender": "male",
      "style": "authoritative",
      "isDefault": false
    },
    {
      "id": "LQ2auZHpAQ9h4azztqMT",
      "name": "Parveen",
      "description": "Confident male voice — warm and persuasive",
      "language": "hi-IN",
      "gender": "male",
      "style": "confident",
      "isDefault": false
    },
    {
      "id": "s6cZdgI3j07hf4frz4Q8",
      "name": "Arvi",
      "description": "Desi conversational female voice — friendly and casual",
      "language": "hi-IN",
      "gender": "female",
      "style": "conversational",
      "isDefault": false
    }
  ],
  "total": 5
}
```

> 💡 Use the `id` from this response as the `voice` field when creating or editing agents.

---

## Available Voices Reference

| Voice ID | Name | Gender | Style | Default |
|----------|------|--------|-------|---------|
| `MF4J4IDTRo0AxOO4dpFR` | **Devi** | Female | Professional, Clear Hindi | ✅ Yes |
| `1qEiC6qsybMkmnNdVMbK` | **Monika** | Female | Modulated, Professional | No |
| `qDuRKMlYmrm8trt5QyBn` | **Taksh** | Male | Powerful, Commanding | No |
| `LQ2auZHpAQ9h4azztqMT` | **Parveen** | Male | Confident, Warm | No |
| `s6cZdgI3j07hf4frz4Q8` | **Arvi** | Female | Conversational, Friendly | No |

---

## Agent Configuration Reference

Complete list of configurable fields (all optional except `name` on create).

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Agent name |
| `description` | string | `""` | Description |
| `systemPrompt` | string | `""` | LLM instructions |
| `openingLine` | string | `""` | First sentence on call |
| `voice` | string | `"MF4J4IDTRo0AxOO4dpFR"` | Callex Voice ID (see [Voices](#available-voices-reference)) |
| `language` | string | `"en-US"` | Language code |
| `status` | string | `"draft"` | `draft`, `active`, `paused` |

### LLM

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `temperature` | float | `0.7` | Creativity (0.0–1.0) |
| `maxTokens` | integer | `250` | Max tokens per response |
| `sttEngine` | string | `"callex-1.1"` | Speech-to-text engine |
| `llmModel` | string | `"callex-1.3"` | LLM model |

### Voice & Speech

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prosodyRate` | float | `1.0` | Speech speed |
| `prosodyPitch` | float | `1.0` | Pitch |
| `fillerPhrases` | array | `["Let me check..."]` | Filler phrases |
| `speakingStyle` | string | `"professional"` | `professional`, `friendly`, `urgent`, `empathetic` |
| `backgroundAmbience` | string | `"none"` | `none`, `office`, `call_center` |

### Call Behavior

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bargeInMode` | string | `"balanced"` | `aggressive`, `balanced`, `polite`, `disabled` |
| `patienceMs` | integer | `800` | End-of-turn timeout (ms) |
| `maxDuration` | integer | `30` | Max call minutes |
| `ringTimeout` | integer | `30` | Ring timeout (seconds) |
| `voicemailLogic` | string | `"hangup"` | `hangup`, `leave_message`, `human_escalate` |
| `fallbackMessage` | string | `"I'm sorry..."` | Fallback response |

### Advanced

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sentimentRouting` | boolean | `false` | Transfer on angry caller |
| `piiRedaction` | boolean | `true` | Redact credit cards, SSN |
| `emotionalMirroring` | boolean | `true` | Match caller's energy |
| `dynamicCodeSwitching` | boolean | `true` | Switch languages mid-call |
| `objectionHandling` | string | `"standard"` | `standard` or `persistent` |
| `autoSummary` | boolean | `true` | Auto call summary |
| `autoSentiment` | boolean | `true` | Auto sentiment analysis |
| `recordCall` | boolean | `true` | Record calls |
| `webhookUrl` | string | `null` | Post-call webhook URL |
| `autoFollowUp` | boolean | `true` | Auto schedule follow-ups |

---

## Error Reference

| Status | Meaning | Example |
|--------|---------|---------|
| `200` | Success | `{ "message": "Agent updated successfully." }` |
| `201` | Created | `{ "message": "Agent successfully created." }` |
| `400` | Bad Request | `{ "error": "Agent 'name' is required." }` |
| `401` | Unauthorized | `{ "error": "Missing or invalid Authorization header." }` |
| `403` | Forbidden | `{ "error": "Invalid or revoked API Key." }` |
| `404` | Not Found | `{ "error": "Agent not found" }` |
| `500` | Server Error | `{ "error": "Internal server error" }` |

---

## Best Practices

1. **Store your API key securely** — never expose in client-side code or public repos.
2. **Use Test keys** (`ck_test_`) for development, **Live keys** (`ck_live_`) for production.
3. **Paginate** when listing agents or calls — use `page` and `limit` params.
4. **Send only changed fields** when editing — PUT accepts partial updates.
5. **Revoke compromised keys** immediately from **Admin Panel → Settings**.
6. **Use the Voices API** to fetch available voice IDs before creating agents.

### Quick Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| List agents | `GET` | `/api/v1/agents?page=1&limit=10` |
| Create agent | `POST` | `/api/v1/agents` |
| Get agent | `GET` | `/api/v1/agents/{id}` |
| Edit agent | `PUT` | `/api/v1/agents/{id}` |
| Delete agent | `DELETE` | `/api/v1/agents/{id}` |
| List calls | `GET` | `/api/v1/calls?page=1&limit=20` |
| Get call details | `GET` | `/api/v1/calls/{id}` |
| Get transcript | `GET` | `/api/v1/calls/{id}/transcript` |
| List voices | `GET` | `/api/v1/voices` |

---

> 📌 **Remember:** Everything available via API is also available in the **[Admin Panel](http://62.171.170.48:4000)** with a full visual interface.

*For support, contact the Callex engineering team.*
