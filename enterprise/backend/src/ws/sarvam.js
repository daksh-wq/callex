import WebSocket from 'ws';

export function setupSarvamWS(clientWs, agentConfig) {
    const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
    if (!SARVAM_API_KEY) {
        clientWs.send(JSON.stringify({ type: 'error', message: 'SARVAM_API_KEY not found in backend environment' }));
        clientWs.close();
        return;
    }

    // Connect to Sarvam AI STT WebSocket
    const sarvamWsUrl = 'wss://api.sarvam.ai/speech-to-text-translate/ws'; // or speech-to-text/ws depending on dialect translation needs, we'll try speech-to-text/ws
    
    // We'll use the core speech-to-text endpoint since the user wants Hindi STT
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
                model: "saaras:v1",
                language_code: agentConfig.languageCode || "hi-IN",
                mode: "transcribe",
                audio_format: {
                    mime_type: "audio/x-raw",
                    sample_rate: 16000,
                    encoding: "pcm_s16le"
                }
            }
        };
        sarvamWs.send(JSON.stringify(configMsg));
    });

    sarvamWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            // console.log("[SARVAM STT EVENT]", msg.type);
            // Proxy the transcription back to the React UI
            if (msg.type === 'transcript') {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ 
                        type: 'transcript',
                        text: msg.data.transcript, // The string
                        isFinal: msg.data.is_final
                    }));
                }
            } else if (msg.type === 'error') {
                console.error("[SARVAM API ERROR]", msg);
            }
        } catch (e) {
            console.error('[SARVAM STT] Parse Error:', e.message);
        }
    });

    sarvamWs.on('error', (err) => {
        console.error('[SARVAM STT] WebSocket Error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: 'Sarvam API Connection Error' }));
        }
    });

    sarvamWs.on('close', (code, reason) => {
        console.log(`[SARVAM STT] Closed: ${code} - ${reason}`);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
        }
    });

    // Handle messages coming FROM React Mic
    clientWs.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'audio' && isSarvamOpen) {
                // Pipe base64 chunk to Sarvam
                sarvamWs.send(JSON.stringify({
                    type: "audio",
                    data: {
                        audio: data.chunk
                    }
                }));
            }
        } catch (e) {
            console.error('[PROXY] Error processing client message:', e.message);
        }
    });

    clientWs.on('close', () => {
        console.log('[PROXY] React Client disconnected, tearing down Sarvam tunnel.');
        if (sarvamWs.readyState === WebSocket.OPEN) {
            sarvamWs.close();
        }
    });
}
