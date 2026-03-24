# Golex Voice AI — Custom Disposition API Protocol
> **Version:** 3.0 | **Engine:** Golex Voice AI Core

Welcome to the **Golex Voice AI Disposition Module**. A disposition is not just a tag indicating how a call ended; in the Golex ecosystem, a disposition dictates **exactly what data** the AI must extract from the customer interaction.

This robust module allows you to:
1. Define a human-readable **tagline** explaining the disposition's purpose.
2. Provide a **strict data schema** (`requiredFields`) forcing the AI to collect specific variable data (like order numbers, dates, or prices).
3. **Link dispositions** selectively to specific Agents or Dialing Campaigns.

---

## 🛠️ The Disposition Object Architecture

A customized disposition in Golex follows this exact JSON structure:

```json
{
  "id": "disp_8f72a9b3",
  "name": "Meeting Booked",
  "tagline": "The customer agreed to a follow-up meeting",
  "requiresNote": true,
  "category": "Sales",
  "requiredFields": [
    { "name": "Meeting Date", "type": "date", "description": "When the meeting is scheduled" },
    { "name": "Decision Maker Present", "type": "boolean", "description": "Did they confirm decision making power?" }
  ],
  "linkedAgents": ["agent_12345"],
  "linkedCampaigns": ["camp_98765"],
  "active": true
}
```

### Field Definitions
* `name` *(String)*: The core title of the outcome (e.g., "Not Interested", "Sale Made").
* `tagline` *(String)*: A brief sentence defining exactly what this means, passed to the AI as context.
* `requiredFields` *(Array)*: An array of JSON objects. These define the "Schema" of information the agent is supposed to parse from the conversation. 
* `linkedAgents` *(Array of Strings)*: Connects this disposition *only* to specific Agent IDs.
* `linkedCampaigns` *(Array of Strings)*: Connects this disposition *only* to specific out-dialing Campaign IDs.
* `active` *(Boolean)*: Setting to `false` archives the disposition without deleting historical call data.

---

## 🚀 API Endpoints

**Base Endpoint URL:** `https://api.golex.ai/v1/dispositions`
**Authentication:** `Authorization: Bearer <YOUR_API_KEY>`

### 1. Create a New Custom Disposition
* **Method:** `POST`
* **URL:** `/v1/dispositions`

Creates a new intelligent disposition schema in your workspace.

**Request Payload:**
```json
{
  "name": "High Value Lead",
  "tagline": "Customer has a budget over $10,000 and requires urgent sales followup",
  "category": "Hot Lead",
  "requiredFields": [
    { "name": "Estimated Budget", "type": "number" },
    { "name": "Timeline to Purchase", "type": "string" }
  ],
  "linkedAgents": ["agent_abc123"],
  "linkedCampaigns": []
}
```

**Success Response (201 Created):**
```json
{
  "message": "Disposition created successfully",
  "id": "disp_x92k3m1",
  "name": "High Value Lead",
  "tagline": "Customer has a budget over $10,000 and requires urgent sales followup",
  ... (returns full object)
}
```

---

### 2. Update a Disposition & Manage Links
* **Method:** `PUT`
* **URL:** `/v1/dispositions/:id`

Modify an existing disposition. This is highly useful for dynamically **linking and unlinking** a disposition to different campaigns as your business needs change.

**Request Payload:** *(All fields are optional, send only what you wish to update)*
```json
{
  "tagline": "Updated tagline for better AI comprehension",
  "linkedCampaigns": ["camp_123", "camp_456"]
}
```

---

### 3. List All Your Dispositions
* **Method:** `GET`
* **URL:** `/v1/dispositions`

Returns an array of all custom dispositions in your Golex workspace. You can filter this list on your frontend by inspecting the `linkedAgents` or `linkedCampaigns` arrays to display only relevant outcomes in the UI.

---

### 4. Fetch a Specific Disposition
* **Method:** `GET`
* **URL:** `/v1/dispositions/:id`

Retrieve the exact data schema and linkage map for a single disposition ID.

---

### 5. Archiv / Delete a Disposition
* **Method:** `DELETE`
* **URL:** `/v1/dispositions/:id`

Permanently deletes the custom disposition.
*(Note: If you wish to keep historical reporting intact, we heavily recommend using the `PUT` endpoint to set `"active": false` instead of outright deletion).*

---

## 🧠 How Golex Voice AI Uses This Data

When a live call concludes, the Golex Voice AI pipeline evaluates the transcript against all **active dispositions** linked to the Agent that handled the call. 

If the AI determines the outcome matches the `tagline` of a disposition, it will automatically attempt to extract every variable listed inside `requiredFields` from the transcript context, delivering a perfectly structured JSON object back to your webhook or API dashboard. 
