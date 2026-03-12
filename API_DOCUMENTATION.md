# Callex AI — Developer API Documentation

> **Version:** 1.0 &nbsp;|&nbsp; **Base URL:** `http://62.171.170.48:4000` &nbsp;|&nbsp; **Last Updated:** March 12, 2026

---

## Table of Contents

1. [Admin Panel](#admin-panel)
2. [Getting Your API Key](#getting-your-api-key)
3. [Authentication](#authentication)
4. [API Endpoints](#api-endpoints)
   - [List Agents (Paginated)](#1-list-all-agents-paginated)
   - [Create Agent](#2-create-a-new-agent)
   - [Get Agent Details](#3-get-agent-details)
   - [Edit Agent](#4-edit--update-an-agent)
   - [Delete Agent](#5-delete-an-agent)
5. [Agent Configuration Reference](#agent-configuration-reference)
6. [Error Reference](#error-reference)
7. [Best Practices](#best-practices)

---

## Admin Panel

Everything you can do via the API can also be done through the **Callex Admin Panel** — a full-featured web dashboard.

🔗 **Admin Panel URL:** [http://62.171.170.48:4000](http://62.171.170.48:4000)

### What You Get in the Admin Panel

| Feature | Where to Find |
|---------|---------------|
| **Create, Edit & Delete Agents** | Sidebar → **Agent Studio** |
| **Generate & Revoke API Keys** | Sidebar → **Settings** → API Keys |
| **Configure Webhooks** | Sidebar → **Settings** → Webhooks |
| **Live Call Monitoring** | Sidebar → **Live Supervisor** |
| **Call Analytics & Logs** | Sidebar → **Analytics** |
| **Knowledge Base Management** | Sidebar → **Knowledge Base** |
| **Campaign Management (Dialer)** | Sidebar → **Dialer** |
| **Call Routing Rules** | Sidebar → **Routing** |
| **CRM & Tool Integrations** | Sidebar → **Integrations** |
| **Security & Voice Signatures** | Sidebar → **Security** |
| **Quality Assurance** | Sidebar → **QA** |
| **Reports & Exports** | Sidebar → **Reports** |
| **Billing & Usage** | Sidebar → **Billing** |
| **Agent Simulation & Testing** | Sidebar → **Simulation** |

> 💡 **Use the Admin Panel to visually manage everything.** The API below is for developers who want to integrate agent management into their own dashboards or automate workflows programmatically.

---

## Getting Your API Key

Before making any API calls, you need to generate an API key from the Admin Panel.

### Step-by-step

1. **Open the Admin Panel** → [http://62.171.170.48:4000](http://62.171.170.48:4000) and **log in**.
2. Click **Settings** in the left sidebar.
3. You'll see the **"API Keys"** section at the top.
4. Enter a **Key Name** (e.g., "Production App", "My Dashboard").
5. Select the **Environment**:
   - **Test** — for development/staging (prefix: `ck_test_`)
   - **Live** — for production (prefix: `ck_live_`)
6. Click **"Generate"**.
7. Your new API key appears in an **orange highlighted box**.

> ⚠️ **IMPORTANT:** The full API key is shown **only once**. Copy it immediately using the **Copy** button and store it securely. You will not be able to see the full key again.

### Managing API Keys

| Action | How |
|--------|-----|
| **View all keys** | [Admin Panel → Settings](http://62.171.170.48:4000/settings) → API Keys section |
| **See last used date** | Shown next to each key |
| **Revoke a key** | Click the 🗑️ trash icon next to any key |

### Key Format

| Environment | Prefix | Example |
|-------------|--------|---------|
| Test | `ck_test_` | `ck_test_a1b2c3d4_e5f6g7h8i9j0k1l2m3n4o5p6` |
| Live | `ck_live_` | `ck_live_f8e7d6c5_b4a3z2y1x0w9v8u7t6s5r4q3` |

---

## Authentication

All API requests must include your API key in the `Authorization` header.

```
Authorization: Bearer <YOUR_API_KEY>
```

**Example:**
```
Authorization: Bearer ck_live_a1b2c3d4_e5f6g7h8i9j0k1l2m3n4o5p6
```

---

## API Endpoints

### 1. List All Agents (Paginated)

Retrieve a paginated list of all your AI agents.

```
GET /api/v1/agents
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `10` | Items per page (max 100) |
| `status` | string | — | Filter: `draft`, `active`, `paused` |

#### cURL Example

```bash
curl -X GET "http://62.171.170.48:4000/api/v1/agents?page=1&limit=5&status=active" \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

#### Response — `200 OK`

```json
{
  "agents": [
    {
      "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
      "name": "Jane - Support",
      "status": "active",
      "language": "en-US",
      "createdAt": "2026-03-12T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 12,
    "totalPages": 3
  }
}
```

#### Pagination Fields

| Field | Description |
|-------|-------------|
| `page` | Current page number |
| `limit` | Items per page |
| `total` | Total agents matching filter |
| `totalPages` | Total pages available |

---

### 2. Create a New Agent

Create a new AI agent. Automatically creates the first prompt version.

```
POST /api/v1/agents
```

#### Headers

```http
Content-Type: application/json
Authorization: Bearer <YOUR_API_KEY>
```

#### Body (JSON)

Only `name` is required. Everything else has smart defaults.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Agent name |
| `description` | string | No | `""` | Agent description |
| `systemPrompt` | string | No | `""` | LLM instructions & personality |
| `openingLine` | string | No | `""` | First thing AI says on call |
| `voice` | string | No | `"alloy"` | ElevenLabs Voice ID |
| `language` | string | No | `"en-US"` | Language code |
| `temperature` | float | No | `0.7` | Creativity (0.0 – 1.0) |
| `maxDuration` | integer | No | `30` | Max call minutes |
| `bargeInMode` | string | No | `"balanced"` | `aggressive`, `balanced`, `polite` |
| `voicemailLogic` | string | No | `"hangup"` | `hangup`, `leave_message`, `human_escalate` |

> 📘 See the full [Agent Configuration Reference](#agent-configuration-reference) for all 50+ fields.

#### cURL Example

```bash
curl -X POST http://62.171.170.48:4000/api/v1/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_live_YOUR_KEY" \
  -d '{
    "name": "Sales Agent - Premium",
    "systemPrompt": "You are a professional sales agent. Be persuasive but polite.",
    "openingLine": "Hello! I am calling from Acme Corp regarding an exclusive offer.",
    "voice": "nova",
    "temperature": 0.6,
    "maxDuration": 15
  }'
```

#### Response — `201 Created`

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

Retrieve full configuration and prompt history of an agent.

```
GET /api/v1/agents/{agentId}
```

#### cURL Example

```bash
curl -X GET http://62.171.170.48:4000/api/v1/agents/5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1 \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

#### Response — `200 OK`

```json
{
  "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "name": "Sales Agent - Premium",
  "systemPrompt": "You are a professional sales agent.",
  "voice": "nova",
  "language": "en-US",
  "temperature": 0.6,
  "PromptVersion": [
    {
      "version": 1,
      "prompt": "You are a professional sales agent.",
      "isActive": true
    }
  ]
}
```

---

### 4. Edit / Update an Agent

Update any fields of an existing agent. Send **only the fields you want to change**.

```
PUT /api/v1/agents/{agentId}
```

#### Headers

```http
Content-Type: application/json
Authorization: Bearer <YOUR_API_KEY>
```

#### Body

All fields are optional. Only included fields are updated.

#### cURL Example

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

#### Response — `200 OK`

```json
{
  "message": "Agent updated successfully.",
  "agentId": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "agent": {
    "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
    "name": "Sales Agent - Enterprise",
    "temperature": 0.5,
    "status": "active"
  }
}
```

---

### 5. Delete an Agent

Permanently delete an agent and all its prompt versions and follow-ups.

```
DELETE /api/v1/agents/{agentId}
```

> ⚠️ **This action is irreversible.**

#### cURL Example

```bash
curl -X DELETE http://62.171.170.48:4000/api/v1/agents/5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1 \
  -H "Authorization: Bearer ck_live_YOUR_KEY"
```

#### Response — `200 OK`

```json
{
  "message": "Agent deleted successfully.",
  "agentId": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1"
}
```

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
| `voice` | string | `"alloy"` | Voice ID |
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
3. **Paginate** when listing agents — use `page` and `limit` params.
4. **Send only changed fields** when editing — PUT accepts partial updates.
5. **Revoke compromised keys** immediately from **Admin Panel → Settings**.

### Quick Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| List agents | `GET` | `/api/v1/agents?page=1&limit=10` |
| Create agent | `POST` | `/api/v1/agents` |
| Get agent | `GET` | `/api/v1/agents/{id}` |
| Edit agent | `PUT` | `/api/v1/agents/{id}` |
| Delete agent | `DELETE` | `/api/v1/agents/{id}` |

---

> 📌 **Remember:** Everything available via API is also available in the **[Admin Panel](http://62.171.170.48:4000)** with a full visual interface — agent creation, editing, deletion, API key management, analytics, and more.

*For support, contact the Callex engineering team.*
