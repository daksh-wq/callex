# Callex AI - Developer API Integration Guide

Welcome to the Callex Agent Creation API. This guide explains how to programmatically create and fetch AI calling agents for your own dashboard or external applications.

## Authentication
All requests must be authenticated using a **Bearer Token**.
You can generate API Keys securely from inside the Callex Agent Studio Dashboard under the **Settings -> API Keys** tab.

**Format**: `Authorization: Bearer <YOUR_API_KEY>`

---

## 1. Create a New Agent
`POST http://147.93.106.182:4000/api/v1/agents`

This endpoint allows you to programmatically create a brand new AI agent. It automatically generates the initial prompt version and readies the agent for calls.

### Request Headers
```http
Content-Type: application/json
Authorization: Bearer <YOUR_API_KEY>
```

### Request Body (JSON)
*(Only `name` is strictly required. All other fields revert to smart defaults if not provided).*

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | - | Name of the AI Agent |
| `systemPrompt` | string | No | "" | The core instructions and personality for the LLM. |
| `openingLine` | string | No | "" | The very first thing the AI says when the call connects. |
| `voice` | string | No | "alloy" | The ElevenLabs Voice ID to use. |
| `language` | string | No | "en-US" | Primary language of the agent. |
| `bargeInMode` | string | No | "balanced" | Interruption sensitivity (`aggressive`, `balanced`, `polite`). |
| `voicemailLogic` | string | No | "hangup" | Action upon detecting voicemail. |
| `maxDuration` | integer | No | 30 | Maximum call duration in minutes. |
| `temperature` | float | No | 0.7 | LLM creativity scale (0.0 to 1.0). |

**Example JSON Payload:**
```json
{
  "name": "Tech Support Agent",
  "systemPrompt": "You are a helpful tech support agent for Callex. Be polite and concise.",
  "openingLine": "Hello! Welcome to Callex Tech Support. How can I help you today?",
  "voice": "nova",
  "language": "en-US",
  "bargeInMode": "balanced",
  "voicemailLogic": "hangup"
}
```

### Example cURL Request
```bash
curl -X POST http://147.93.106.182:4000/api/v1/agents \
-H "Content-Type: application/json" \
-H "Authorization: Bearer ck_live_YOUR_API_KEY_HERE" \
-d '{
  "name": "Jane - Support",
  "systemPrompt": "You are Jane, a support agent.",
  "openingLine": "Hi, this is Jane. How are you?"
}'
```

### Successful Response (`201 Created`)
```json
{
  "message": "Agent successfully created.",
  "agentId": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "agent": {
    "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
    "name": "Jane - Support",
    "status": "draft",
    "createdAt": "2026-03-12T10:00:00.000Z"
  }
}
```

---

## 2. Fetch Agent Details
`GET http://147.93.106.182:4000/api/v1/agents/{agentId}`

Retrieve the full configuration and prompt history of an existing agent.

### Request Headers
```http
Authorization: Bearer <YOUR_API_KEY>
```

### Example cURL Request
```bash
curl -X GET http://147.93.106.182:4000/api/v1/agents/5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1 \
-H "Authorization: Bearer ck_live_YOUR_API_KEY_HERE"
```

### Successful Response (`200 OK`)
```json
{
  "id": "5fa23d1b-722a-4318-aecc-6e6ad9d1a8e1",
  "name": "Jane - Support",
  "systemPrompt": "You are Jane, a support agent.",
  "voice": "nova",
  "language": "en-US",
  "PromptVersion": [
    {
      "version": 1,
      "prompt": "You are Jane, a support agent.",
      "isActive": true
    }
  ]
}
```

---

## Error Handling
If you provide an invalid or revoked API Key, you will receive:
```json
{
  "error": "Invalid or revoked API Key."
}
```
