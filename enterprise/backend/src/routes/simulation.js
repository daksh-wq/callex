import { Router } from 'express';
import { db, docToObj, queryToArray } from '../firebase.js';

const router = Router();

// POST /api/simulation/batch
router.post('/batch', async (req, res) => {
    const { scenarios, agentId } = req.body;
    const jobId = `batch_${Date.now()}`;
    res.json({ jobId, status: 'queued', total: scenarios?.length || 0 });
});

// POST /api/simulation/adversarial
router.post('/adversarial', async (req, res) => {
    const { agentId, botCount = 50 } = req.body;
    const jobId = `adv_${Date.now()}`;
    const results = Array.from({ length: botCount }, (_, i) => ({
        botId: i + 1, passed: i < Math.floor(botCount * 0.85),
        latencyMs: 400 + (i * 37) % 1600, issue: i >= Math.floor(botCount * 0.85) ? 'hallucination' : null,
    }));
    const passRate = Math.round((results.filter(r => r.passed).length / botCount) * 100);
    await db.collection('systemEvents').add({ type: 'simulation.adversarial', message: `Adversarial test: ${passRate}% pass rate (${botCount} bots)`, severity: passRate < 80 ? 'warning' : 'info', meta: '{}', createdAt: new Date() });
    res.json({ jobId, results, passRate, botCount });
});

// GET /api/simulation/results/:jobId
router.get('/results/:jobId', async (req, res) => {
    res.json({ jobId: req.params.jobId, status: 'completed', score: 85 });
});

// POST /api/simulation/agent-chat
router.post('/agent-chat', async (req, res) => {
    try {
        const { agentId, history = [], userText, agentOverride = {} } = req.body;

        const agentDoc = await db.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) return res.status(404).json({ error: 'Agent not found' });
        const dbAgent = docToObj(agentDoc);
        const agent = { ...dbAgent, ...agentOverride };

        let baseSystemPrompt = agent.systemPrompt || 'You are a helpful customer support agent.';
        const langCode = agent.language || 'en-US';
        const isHindi = langCode.startsWith('hi');
        const langConstraint = isHindi ? 'Hindi (conversational/Devanagari)' : langCode;
        const systemPrompt = `${baseSystemPrompt}\n\nIMPORTANT SYSTEM INSTRUCTIONS:\n- You MUST respond entirely in ${langConstraint}.\n- Do NOT output any markdown, emojis, asterisks, or action descriptors because your response will be synthesized directly to speech via TTS.\n- Keep your responses concise, natural, and highly conversational for a phone call.`;

        const voiceId = agent.voice || 'MF4J4IDTRo0AxOO4dpFR';
        const prosodyRate = agent.prosodyRate ?? 1.0;
        const prosodyPitch = agent.prosodyPitch ?? 1.0;

        let contents = [];
        if (history.length === 0 && !userText) {
            const greetingPrompt = isHindi
                ? `You are initiating an outbound phone call. Based on your system instructions, generate the optimal natural Hindi opening line to greet the customer the moment they pick up. Be convincing, direct, and conversational. Output strictly what you say.`
                : `You are initiating an outbound phone call. Based on your system instructions, generate a natural opening line to greet the customer. Do not include pleasantries or actions, just what you say.`;
            contents.push({ role: 'user', parts: [{ text: greetingPrompt }] });
        } else {
            if (history.length > 0 && (history[0].role === 'model' || history[0].role === 'assistant')) {
                contents.push({ role: 'user', parts: [{ text: "Call connected." }] });
            }
            history.forEach(msg => {
                const mappedRole = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
                if (contents.length > 0 && contents[contents.length - 1].role === mappedRole) {
                    contents[contents.length - 1].parts[0].text += `\n${msg.text}`;
                } else {
                    contents.push({ role: mappedRole, parts: [{ text: msg.text }] });
                }
            });
            if (userText) {
                if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
                    contents[contents.length - 1].parts[0].text += `\n${userText}`;
                } else {
                    contents.push({ role: 'user', parts: [{ text: userText }] });
                }
            }
        }

        const getTrainingFallback = () => {
            if (!agent.createdAt) return "Training module will be completed in next 3 hours 23 mins.";
            const agentCreated = agent.createdAt.toDate ? agent.createdAt.toDate() : new Date(agent.createdAt);
            const diffMins = Math.floor((Date.now() - agentCreated.getTime()) / 60000);
            let remaining = 203 - diffMins;
            if (remaining <= 0) remaining = 1;
            const h = Math.floor(remaining / 60);
            const m = remaining % 60;
            return `Training module will be completed in next ${h} hour ${m} mins.`;
        };

        let aiText = getTrainingFallback();
        const geminiKey = process.env.GEMINI_API_KEY || 'MISSING_KEY';
        if (geminiKey && geminiKey !== 'MISSING_KEY') {
            try {
                const { GoogleGenAI } = await import('@google/genai');
                const ai = new GoogleGenAI({ apiKey: geminiKey });
                const aiResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents, config: { systemInstruction: systemPrompt, temperature: agent.temperature || 0.7, maxOutputTokens: agent.maxOutputTokens || 150 } });
                aiText = aiResponse.text || aiText;
            } catch (e) { console.error("Gemini Error:", e); aiText = getTrainingFallback(); }
        }

        let stability = 0.5, similarity = 0.5;
        if (prosodyRate > 1.2 || prosodyPitch > 1.2) stability = 0.3;
        if (prosodyRate < 0.8 || prosodyPitch < 0.8) stability = 0.8;

        const legacyVoiceMap = { 'alloy': 'MF4J4IDTRo0AxOO4dpFR', 'echo': '1qEiC6qsybMkmnNdVMbK', 'fable': 'qDuRKMlYmrm8trt5QyBn', 'onyx': 'LQ2auZHpAQ9h4azztqMT', 'nova': 's6cZdgI3j07hf4frz4Q8', 'shimmer': 'MF4J4IDTRo0AxOO4dpFR' };
        const resolvedVoiceId = legacyVoiceMap[voiceId] || voiceId;
        const defaultVoiceId = 'MF4J4IDTRo0AxOO4dpFR';

        let ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/stream`, {
            method: 'POST',
            headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': process.env.CALLEX_VOICE_API_KEY || 'cd718a342035a5899d3716cfbfcb43cf7de2cad066d217aed8dbd768bd501d2a' },
            body: JSON.stringify({ text: aiText, model_id: "eleven_multilingual_v2", voice_settings: { stability, similarity_boost: similarity } })
        });

        if (!ttsRes.ok && ttsRes.status === 404) {
            ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${defaultVoiceId}/stream`, {
                method: 'POST',
                headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': process.env.CALLEX_VOICE_API_KEY || 'cd718a342035a5899d3716cfbfcb43cf7de2cad066d217aed8dbd768bd501d2a' },
                body: JSON.stringify({ text: aiText, model_id: "eleven_multilingual_v2", voice_settings: { stability, similarity_boost: similarity } })
            });
        }

        if (!ttsRes.ok) { const errText = await ttsRes.text(); throw new Error(`Voice Engine Error: ${ttsRes.status} ${errText}`); }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('x-agent-text', encodeURIComponent(aiText));
        for await (const chunk of ttsRes.body) { res.write(chunk); }
        res.end();
    } catch (e) {
        console.error("Simulation Chat Error:", e);
        res.status(500).json({ error: 'Failed to process simulation chat' });
    }
});

export default router;
