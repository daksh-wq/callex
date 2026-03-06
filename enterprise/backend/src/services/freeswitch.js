const esl = require('modesl');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// FreeSWITCH ESL Configuration
const ESL_HOST = process.env.FS_HOST || '127.0.0.1';
const ESL_PORT = process.env.FS_PORT || 8021;
const ESL_PASSWORD = process.env.FS_PASSWORD || 'ClueCon';

// WebSocket Server for test.py
const WS_SERVER_URL = process.env.WS_SERVER_URL || '127.0.0.1:8085';

class FreeSWITCHService {
    constructor() {
        this.connection = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected) return;

        return new Promise((resolve, reject) => {
            console.log(`[ESL] Connecting to FreeSWITCH at ${ESL_HOST}:${ESL_PORT}...`);

            this.connection = new esl.Connection(ESL_HOST, ESL_PORT, ESL_PASSWORD, () => {
                console.log('[ESL] Connected to FreeSWITCH ESL');
                this.isConnected = true;
                resolve();
            });

            this.connection.on('error', (err) => {
                console.error('[ESL Error]', err.message);
                this.isConnected = false;
                // Don't reject if already connected (it's a drop)
                if (!this.isConnected) reject(err);
            });

            this.connection.on('esl::end', () => {
                console.warn('[ESL] Connection to FreeSWITCH ended');
                this.isConnected = false;
                this.connection = null;
            });
        });
    }

    /**
     * Originate a call from FreeSWITCH to a destination phone number, 
     * and bridge it to the AI WebSocket server (test.py).
     * 
     * @param {string} destinationNumber - The number to dial
     * @param {Object} campaign - The campaign object for context
     * @param {Object} agent - The agent object for context
     * @returns {Promise<string>} - Job UUID of the call
     */
    async originateCall(destinationNumber, campaign, agent) {
        if (!this.isConnected) {
            await this.connect();
        }

        return new Promise((resolve, reject) => {
            // 1. Determine SIP Gateway
            // For a real production system, this gateway string must match your actual FreeSWITCH sip profile
            // For testing, we use a placeholder that user can configure in their FreeSWITCH dialplan
            const gateway = process.env.FS_GATEWAY || 'sofia/gateway/my_provider';

            // 2. Format dialstring
            const dialString = `${gateway}/${destinationNumber}`;

            // 3. Set custom variables to pass to test.py via headers
            // Adding sip headers or ESL variables so test.py can read the campaign and agent ID
            const variables = [
                `ignore_early_media=true`,
                `absolute_codec_string=PCMU,PCMA`,
                `execute_on_answer='socket ${WS_SERVER_URL} async full'`,
                `x-campaign-id=${campaign.id}`,
                `x-agent-id=${agent.id}`,
                `x-phone-number=${destinationNumber}`
            ].join(',');

            // 4. Build command: bgapi originate {var1=val1,var2=val2}sofia/gateway/prov/1234 &park()
            // Note: We originate to an answering app or park, because the wait_for_answer triggers the socket
            const command = `originate {${variables}}${dialString} &park()`;

            console.log(`[ESL] Originating Call: ${command}`);

            // 5. Send bgapi command (non-blocking)
            this.connection.bgapi(command, (res) => {
                const body = res.getBody();
                console.log(`[ESL] Originate Response: ${body}`);

                if (body.includes('-ERR')) {
                    reject(new Error(`FreeSWITCH Originate Error: ${body}`));
                } else {
                    // Extract Job-UUID
                    const match = body.match(/Reply-Text: \+OK Job-UUID: (.+)/);
                    const jobUuid = match ? match[1] : null;
                    resolve(jobUuid);
                }
            });
        });
    }

    /**
     * Hangup a specific call UUID
     */
    async hangupCall(uuid) {
        if (!this.isConnected) {
            await this.connect();
        }

        return new Promise((resolve) => {
            const command = `uuid_kill ${uuid}`;
            this.connection.api(command, (res) => {
                console.log(`[ESL] Hangup Response for ${uuid}: ${res.getBody()}`);
                resolve();
            });
        });
    }
}

// Create singleton instance
const freeswitchService = new FreeSWITCHService();

module.exports = freeswitchService;
