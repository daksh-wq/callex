import { Router } from 'express';
import { db, docToObj } from '../firebase.js';
import WebSocket from 'ws';

const router = Router();

// POST /api/simulation/agent-chat-stream
router.post('/agent-chat-stream', async (req, res) => {
    try {
        const { agentId, history = [], userText, agentOverride = {} } = req.body;

        const agentDoc = await db.collection('agents').doc(agentId).get();
        if (!agentDoc.exists) {
            return res.status(404).json({ error: 'Agent not found' });
        }
        
        const dbAgent = docToObj(agentDoc);
        const agent = { ...dbAgent, ...agentOverride };

        let baseSystemPrompt = agent.systemPrompt || 'You are a helpful customer support agent.';
        const langCode = agent.language || 'en-US';
        const isHindi = langCode.startsWith('hi');
        const langConstraint = isHindi ? 'Hindi (conversational/Devanagari)' : langCode;
        
        const systemPrompt = `${baseSystemPrompt}

IMPORTANT CONVERSATIONAL PSYCHOLOGY INSTRUCTIONS (STRICT COMPLIANCE FOR VOICE TTS):
1. **Language:** Respond entirely in ${langConstraint}.
2. **Formatting:** ABSOLUTELY NO markdown, emojis, asterisks (like *laughs*), or action descriptors.
3. **Hyper-Realism on Short Answers:** If the user gives a short agreement or simple phrase (e.g., "yes", "okay", "yeah", "hello", "got it"), you MUST start your reply with a natural human backchannel (e.g., "Got it,", "Great,", "Right,", "Okay perfect-") and smoothly continue.
4. **Length Constraint:** DO NOT speak in long paragraphs or essays. Speak strictly in short, human-like 1-to-3 sentence bursts. People on the phone don't monologue!
5. **Fillers:** Use natural conversational filler words ("Well,", "Actually,", "So,") occasionally to sound completely human.`;


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

        let stability = 0.5, similarity = 0.5;
        if (prosodyRate > 1.2 || prosodyPitch > 1.2) stability = 0.3;
        if (prosodyRate < 0.8 || prosodyPitch < 0.8) stability = 0.8;

        const legacyVoiceMap = { 'alloy': 'MF4J4IDTRo0AxOO4dpFR', 'echo': '1qEiC6qsybMkmnNdVMbK', 'fable': 'qDuRKMlYmrm8trt5QyBn', 'onyx': 'LQ2auZHpAQ9h4azztqMT', 'nova': 's6cZdgI3j07hf4frz4Q8', 'shimmer': 'MF4J4IDTRo0AxOO4dpFR' };
        const resolvedVoiceId = legacyVoiceMap[voiceId] || voiceId;

        // Set Headers for streaming HTTP audio response back to browser
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        // We cannot reliably set x-agent-text upfront since it's streaming, but we can set a dummy or try to append trailing headers (not supported by fetch standard easily).
        // Let's just stream audio. The frontend simulator doesn't strictly need to display the text instantly, it's mostly for audio.

        const elevenApiKey = process.env.CALLEX_VOICE_API_KEY || '030a62b112af48f06748c478cd7f607c386f41b30d1be8ffc680484f808a6d9c';
        const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/stream-input?model_id=eleven_multilingual_v2`;
        
        const elevenWs = new WebSocket(wsUrl);

        let isWsOpen = false;
        let pendingTextChunks = [];
        let fullAiText = "";

        elevenWs.on('open', () => {
            isWsOpen = true;
            
            // Send initial configuration with the first space to initialize connection
            const configMsg = {
                text: " ",
                voice_settings: { stability, similarity_boost: similarity },
                xi_api_key: elevenApiKey,
            };
            elevenWs.send(JSON.stringify(configMsg));

            // Flush any pending text chunks that Gemini produced before WS opened
            for (const chunk of pendingTextChunks) {
                elevenWs.send(JSON.stringify({ text: chunk, try_trigger_generation: true }));
            }
            pendingTextChunks = [];
        });

        // Pipe ElevenLabs audio directly to the Express response
        elevenWs.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.audio) {
                    const audioBuffer = Buffer.from(msg.audio, 'base64');
                    res.write(audioBuffer);
                }
                if (msg.isFinal) {
                    elevenWs.close();
                }
            } catch (err) {
                console.error("ElevenLabs WS message parse error:", err);
            }
        });

        elevenWs.on('error', (err) => {
            console.error("ElevenLabs WS Error:", err);
            if (!res.headersSent) res.status(500).end();
            else res.end();
        });

        elevenWs.on('close', () => {
            res.end();
        });

        // ── Connect to Gemini via Stream ──
        const geminiKey = process.env.GEMINI_API_KEY || 'MISSING_KEY';
        if (geminiKey && geminiKey !== 'MISSING_KEY') {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            
            try {
                const responseStream = await ai.models.generateContentStream({
                    model: 'gemini-2.5-flash',
                    contents,
                    config: {
                        systemInstruction: systemPrompt,
                        temperature: agent.temperature || 0.7,
                        maxOutputTokens: agent.maxOutputTokens || 150
                    }
                });

                for await (const chunk of responseStream) {
                    const chunkText = chunk.text;
                    if (chunkText) {
                        fullAiText += chunkText;
                        if (isWsOpen) {
                            elevenWs.send(JSON.stringify({ text: chunkText, try_trigger_generation: true }));
                        } else {
                            pendingTextChunks.push(chunkText);
                        }
                    }
                }

                // Signal end of text stream to ElevenLabs
                if (isWsOpen) {
                    elevenWs.send(JSON.stringify({ text: "" }));
                } else {
                    pendingTextChunks.push(""); // The empty string signals the end to ElevenLabs
                }

            } catch (e) {
                console.error("Gemini Streaming Error:", e);
                if (isWsOpen) elevenWs.send(JSON.stringify({ text: "" }));
            }
        } else {
            // Fallback if no Gemini key
            const fallback = "Training module will be completed soon.";
            fullAiText = fallback;
            if (isWsOpen) {
                elevenWs.send(JSON.stringify({ text: fallback, try_trigger_generation: true }));
                elevenWs.send(JSON.stringify({ text: "" }));
            } else {
                pendingTextChunks.push(fallback);
                pendingTextChunks.push("");
            }
        }

    } catch (e) {
        console.error("Simulation Stream Error:", e);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to stream response' });
        else res.end();
    }
});

export default router;
