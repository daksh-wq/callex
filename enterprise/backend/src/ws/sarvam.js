import WebSocket from 'ws';

export function setupSarvamWS(clientWs, agentConfig) {
    const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
    if (!SARVAM_API_KEY) {
        clientWs.send(JSON.stringify({ type: 'error', message: 'SARVAM_API_KEY not found in backend environment' }));
        clientWs.close();
        return;
    }

    // Connect to Sarvam AI STT WebSocket (codemix mode for Hindi-English mixed speech)
    const sarvamWs = new WebSocket('wss://api.sarvam.ai/speech-to-text/ws', {
        headers: {
            'API-Subscription-Key': SARVAM_API_KEY
        }
    });

    let isSarvamOpen = false;

    sarvamWs.on('open', () => {
        isSarvamOpen = true;
        console.log('[SARVAM STT] WebSocket connection established.');

        // Send Configuration payload
        const configMsg = {
            type: "config",
            data: {
                model: "saaras:v2",
                language_code: agentConfig.languageCode || "hi-IN",
                mode: "codemix", // Naturally handles Hindi-English mixed speech
                audio_format: {
                    mime_type: "audio/x-raw",
                    sample_rate: 16000,
                    encoding: "pcm_s16le"
                }
            }
        };
        sarvamWs.send(JSON.stringify(configMsg));
        console.log('[SARVAM STT] Config sent:', JSON.stringify(configMsg));
    });

    sarvamWs.on('message', (rawData) => {
        try {
            const msg = JSON.parse(rawData.toString());
            console.log("[SARVAM STT RAW]", JSON.stringify(msg).substring(0, 300));

            // Sarvam API sends multiple event types:
            // "data" = transcript result, "transcript" = final transcript, 
            // "speech_start" = VAD detected voice, "speech_end" = VAD silence
            
            const transcript = msg?.data?.transcript || msg?.transcript || null;
            const isFinal = msg?.data?.is_final ?? msg?.is_final ?? false;

            if (transcript && transcript.trim().length > 0) {
                console.log(`[SARVAM STT] ${isFinal ? '✅ FINAL' : '⏳ Partial'}: "${transcript}"`);
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ 
                        type: 'transcript',
                        text: transcript.trim(),
                        isFinal: isFinal
                    }));
                }
            } else if (msg.type === 'speech_start') {
                console.log('[SARVAM STT] 🎙️ Speech detected');
            } else if (msg.type === 'speech_end') {
                console.log('[SARVAM STT] 🔇 Speech ended');
            } else if (msg.type === 'error') {
                console.error("[SARVAM API ERROR]", JSON.stringify(msg));
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'error', message: msg.message || 'Sarvam STT Error' }));
                }
            }
        } catch (e) {
            console.error('[SARVAM STT] Parse Error:', e.message, 'Raw:', rawData.toString().substring(0, 200));
        }
    });

    sarvamWs.on('error', (err) => {
        console.error('[SARVAM STT] WebSocket Error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: 'Sarvam API Connection Error: ' + err.message }));
        }
    });

    sarvamWs.on('close', (code, reason) => {
        console.log(`[SARVAM STT] Closed: ${code} - ${reason}`);
        isSarvamOpen = false;
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
        }
    });

    // Handle messages coming FROM React Mic
    let chunkCount = 0;
    clientWs.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'audio' && isSarvamOpen && sarvamWs.readyState === WebSocket.OPEN) {
                chunkCount++;
                // Pipe base64 chunk to Sarvam
                sarvamWs.send(JSON.stringify({
                    type: "audio",
                    data: {
                        audio: data.chunk
                    }
                }));
                // Log every 50th chunk to avoid spam
                if (chunkCount % 50 === 0) {
                    console.log(`[SARVAM STT] Piped ${chunkCount} audio chunks to Sarvam AI`);
                }
            }
        } catch (e) {
            console.error('[PROXY] Error processing client message:', e.message);
        }
    });

    clientWs.on('close', () => {
        console.log(`[PROXY] React Client disconnected after ${chunkCount} chunks. Tearing down Sarvam tunnel.`);
        isSarvamOpen = false;
        if (sarvamWs.readyState === WebSocket.OPEN) {
            sarvamWs.close();
        }
    });
}
