"""
Agent Loader — SQLite Bridge for Dynamic Agent Configuration
=============================================================

Reads agent configuration from the same SQLite database that the
Enterprise Dashboard / Agent Studio writes to (via Prisma).

This module is the bridge between:
  - Frontend (Agent Studio) → Prisma → SQLite (dev.db)
  - Calling System (main.py) → agent_loader.py → SQLite (dev.db)

Both systems share the same database, so changes in Agent Studio
are immediately reflected in live calls.
"""

import sqlite3
import json
import os
from typing import Optional, Dict, Any


# Path to the Prisma SQLite database (shared with enterprise backend)
_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "enterprise", "backend", "prisma", "dev.db"
)


def _get_connection() -> sqlite3.Connection:
    """Get a read-only SQLite connection to the shared database."""
    if not os.path.exists(_DB_PATH):
        raise FileNotFoundError(f"[AgentLoader] Database not found: {_DB_PATH}")
    conn = sqlite3.connect(f"file:{_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def load_agent(agent_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a single agent by ID from the shared database.

    Args:
        agent_id: UUID string or numeric ID of the agent

    Returns:
        Agent config dict, or None if not found
    """
    try:
        conn = _get_connection()
        cursor = conn.execute("SELECT * FROM Agent WHERE id = ?", (str(agent_id),))
        row = cursor.fetchone()
        conn.close()

        if not row:
            print(f"[AgentLoader] ⚠️ Agent '{agent_id}' not found in database")
            return None

        agent = _row_to_dict(row)
        print(f"[AgentLoader] ✅ Loaded agent: {agent['name']} (id={agent['id']})")
        return agent

    except Exception as e:
        print(f"[AgentLoader] ❌ Error loading agent '{agent_id}': {e}")
        return None


def get_default_agent() -> Optional[Dict[str, Any]]:
    """
    Get the first active agent as fallback.
    If no active agents, returns the most recently created agent.
    """
    try:
        conn = _get_connection()

        # Try active agent first
        cursor = conn.execute(
            "SELECT * FROM Agent WHERE status = 'active' ORDER BY updatedAt DESC LIMIT 1"
        )
        row = cursor.fetchone()

        # Fallback to any agent
        if not row:
            cursor = conn.execute("SELECT * FROM Agent ORDER BY createdAt DESC LIMIT 1")
            row = cursor.fetchone()

        conn.close()

        if not row:
            print("[AgentLoader] ⚠️ No agents found in database")
            return None

        agent = _row_to_dict(row)
        print(f"[AgentLoader] ✅ Default agent: {agent['name']} (id={agent['id']})")
        return agent

    except Exception as e:
        print(f"[AgentLoader] ❌ Error loading default agent: {e}")
        return None


def get_active_prompt(agent_id: str) -> Optional[str]:
    """Get the active prompt version for an agent (if using versioning)."""
    try:
        conn = _get_connection()
        cursor = conn.execute(
            "SELECT prompt FROM PromptVersion WHERE agentId = ? AND isActive = 1 ORDER BY version DESC LIMIT 1",
            (str(agent_id),)
        )
        row = cursor.fetchone()
        conn.close()

        if row:
            return row["prompt"]
        return None

    except Exception as e:
        print(f"[AgentLoader] Error loading prompt version: {e}")
        return None


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a SQLite Row to a clean agent config dict."""
    d = dict(row)

    # Parse JSON fields
    for json_field in ['fillerPhrases', 'ipaLexicon', 'tools']:
        if json_field in d and d[json_field]:
            try:
                d[json_field] = json.loads(d[json_field])
            except (json.JSONDecodeError, TypeError):
                pass

    # Ensure defaults for critical fields (handle both missing keys and None values)
    defaults = {
        'systemPrompt': '',
        'openingLine': 'नमस्ते, मैं कैसे मदद कर सकती हूँ?',
        'voice': 'alloy',
        'language': 'en-US',
        'temperature': 0.7,
        'maxTokens': 250,
        'bargeInMode': 'balanced',
        'patienceMs': 800,
        'prosodyRate': 1.0,
        'prosodyPitch': 1.0
    }
    
    for key, default_val in defaults.items():
        if d.get(key) is None:
            d[key] = default_val

    return d


# ─── Fallback Agent (used when DB is unavailable) ───

FALLBACK_AGENT = {
    "id": "fallback",
    "name": "Fallback Agent",
    "status": "active",
    "systemPrompt": """पहचान: "डिश टीवी" से "प्रिया"।
भाषा: स्वाभाविक हिंदी (Devanagari)।
उद्देश्य: ग्राहक को 200 रु रिचार्ज के लिए मनाना ताकि कनेक्शन बंद न हो।

निर्देश:
1. **इंसानों जैसा व्यवहार**: "जी सर", "मैं समझती हूँ" का प्रयोग करें।
2. **संक्षिप्त (Short)**: अधिकतम 2 वाक्य।
3. **सहानुभूति**: समस्या सुनें, स्वीकार करें, फिर समाधान दें।
4. **चेतावनी**: विनम्रता से कनेक्शन बंद होने का डर दिखाएं।
5. **बाधा (Interruption)**: यदि उपयोगकर्ता बीच में टोके, तो तुरंत रुकें और उनकी बात सुनें।
6. **कोई टैग नहीं**: अपने जवाब में कभी भी [Smart Counter] या [Objection] जैसे टैग न बोलें।
7. **शब्दावली (Vocabulary)**: लिखित में "RS" या "Rs" न लिखें, हमेशा "रुपये" लिखें।
8. **कॉल समाप्ति (Call End)**:
- यदि ग्राहक "कल" रिचार्ज करने के लिए कहे: "जी ठीक है सर, कल तक करवा लीजियेगा, शुक्रिया।" [HANGUP]
- यदि ग्राहक "आज", "आज रात तक", "शाम तक" या "अभी" मान जाए: "जी ठीक है सर, आप करवा लीजियेगा, शुक्रिया।" [HANGUP]
- यदि ग्राहक "हाँ" या "ठीक है" कहे: [HANGUP]
- यदि ग्राहक कॉल काटना चाहे: "नमस्ते, आपका दिन शुभ हो।" [HANGUP]
- हमेशा बातचीत के अंत में [HANGUP] लिखें।""",
    "openingLine": "महत्वपूर्ण जानकारी का कॉल है। आपका डिशटीवी का कनेक्शन कंपनी में से आज हमेशा के लिए बंध होने जा रहा है। ये कनेक्शन को कभी भी चालू रखना चाहते हो तो आज ही छोटा 200 रुपए का रिचार्ज करवाना जरूरी है, तो रिचार्ज करवा रहे हो तो में कनेक्शन चालु रखु ?",
    "voice": "alloy",
    "language": "hi-IN",
    "temperature": 0.7,
    "maxTokens": 250,
    "bargeInMode": "balanced",
    "patienceMs": 800,
    "prosodyRate": 1.0,
    "prosodyPitch": 1.0,
    "description": """परिदृश्य: आप एक ग्राहक को कॉल कर रहे हैं जिसका डिश टीवी कनेक्शन आज निष्क्रियता के कारण हमेशा के लिए बंद होने वाला है।
आपका काम: उन्हें यह एहसास दिलाना कि अगर उन्होंने आज 200 रुपये का रिचार्ज नहीं किया, तो उनका बहुत बड़ा नुकसान होगा।

महत्वपूर्ण निर्देश:
- यदि ग्राहक "आज" या "कल" रिचार्ज करने के लिए मान जाए, तो तुरंत कहें: "जी सर, करवा लीजियेगा, शुक्रिया।" और [HANGUP]।
- "नहीं करना / बंद कर दो" → "सर, जल्दबाजी मत कीजिये। भविष्य में कभी तो टीवी देखेंगे? आज बंद हो गया तो फिर से चालू नहीं होगा।"
- "पैसे नहीं हैं" → "सर, सिर्फ 200 रुपये की बात है। किसी से गूगल पे करवा लीजिये।"
- "बाहर हूँ" → "सर, आप कल तक करवा लीजियेगा।" """,
}
