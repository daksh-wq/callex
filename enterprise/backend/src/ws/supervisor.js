import { db, docToObj } from '../firebase.js';

// Simulated transcript lines for active calls
const TRANSCRIPT_LINES = [
    'User: Hello, I need help with my recharge.',
    'Bot: Of course! I can help you with that. What plan are you looking for?',
    'User: I need the 200 rupee plan.',
    'Bot: Perfect. The ₹200 plan offers 30 days validity with unlimited calls. Shall I proceed?',
    'User: Yes, please go ahead.',
    'Bot: Great! Processing your recharge now. One moment...',
    'User: How long will it take?',
    'Bot: It usually takes 2-3 minutes to activate. You will receive a confirmation SMS.',
];

export function setupSupervisorWS(ws, callId) {
    let lineIndex = 0;
    let transcriptInterval = null;

    transcriptInterval = setInterval(async () => {
        if (ws.readyState !== 1) { clearInterval(transcriptInterval); return; }
        const line = TRANSCRIPT_LINES[lineIndex % TRANSCRIPT_LINES.length];
        lineIndex++;
        ws.send(JSON.stringify({ type: 'transcript_line', callId, line, ts: Date.now() }));
        try {
            const doc = await db.collection('calls').doc(callId).get();
            if (doc.exists) {
                const call = doc.data();
                await db.collection('calls').doc(callId).update({ transcript: (call.transcript || '') + '\n' + line });
            }
        } catch { }
    }, 3000);

    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'whisper') {
                ws.send(JSON.stringify({ type: 'whisper_ack', message: parsed.message, ts: Date.now() }));
            } else if (parsed.type === 'listen_in') {
                ws.send(JSON.stringify({ type: 'listen_ack', ts: Date.now() }));
            }
        } catch { }
    });

    ws.on('close', () => { clearInterval(transcriptInterval); });
}
