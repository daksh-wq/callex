import { Router } from 'express';
import { prisma } from '../index.js';
import { requireApiKey } from '../middleware/auth.js';

const router = Router();

// Apply auth middleware to ALL external v1 routes
router.use(requireApiKey);

// POST /v1/agents - Create a new Agent purely via API
router.post('/agents', async (req, res) => {
    try {
        const {
            name, description, systemPrompt, openingLine, voice, language, sttEngine, llmModel,
            fillerPhrases, prosodyRate, prosodyPitch, ipaLexicon, tools, topK, similarityThresh,
            fallbackMessage, profanityFilter, topicRestriction, backgroundAmbience, speakingStyle,
            bargeInMode, patienceMs, maxDuration, temperature, maxTokens, strictToolCalling,
            ringTimeout, voicemailLogic, webhookUrl, autoSummary, autoSentiment, recordCall, processDtmf,
            amdPrecision, voicemailDropAudio, sentimentRouting, competitorAlerts, supervisorWhisper,
            piiRedaction, geoCallerId, multiAgentHandoff, objectionHandling, emotionalMirroring,
            complianceScript, dynamicCodeSwitching, dncLitigatorScrub, callBlending, costCapTokens,
            postCallSms, autoFollowUp, followUpDefaultDays, followUpDefaultTime
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: "Agent 'name' is required." });
        }

        const agent = await prisma.agent.create({
            data: {
                name, description: description || '', systemPrompt: systemPrompt || '', openingLine: openingLine || '',
                voice: voice || 'alloy', language: language || 'en-US', sttEngine: sttEngine || 'callex-1.1',
                llmModel: llmModel || 'callex-1.3',
                fillerPhrases: JSON.stringify(fillerPhrases || ['Let me check...', 'One moment...']),
                prosodyRate: prosodyRate || 1.0, prosodyPitch: prosodyPitch || 1.0,
                ipaLexicon: JSON.stringify(ipaLexicon || {}),
                tools: JSON.stringify(tools || []),
                topK: topK || 5, similarityThresh: similarityThresh || 0.75,
                fallbackMessage: fallbackMessage || "I'm sorry, I don't have that information right now.",
                profanityFilter: profanityFilter || 'redact',
                topicRestriction: topicRestriction || false,
                backgroundAmbience: backgroundAmbience || 'none',
                speakingStyle: speakingStyle || 'professional',
                bargeInMode: bargeInMode || 'balanced',
                patienceMs: patienceMs || 800,
                maxDuration: maxDuration || 30,
                temperature: temperature || 0.7,
                maxTokens: maxTokens || 250,
                strictToolCalling: strictToolCalling ?? true,
                ringTimeout: ringTimeout || 30,
                voicemailLogic: voicemailLogic || 'hangup',
                webhookUrl: webhookUrl || null,
                autoSummary: autoSummary ?? true,
                autoSentiment: autoSentiment ?? true,
                recordCall: recordCall ?? true,
                processDtmf: processDtmf ?? true,
                amdPrecision: amdPrecision || 'balanced',
                voicemailDropAudio: voicemailDropAudio || null,
                sentimentRouting: sentimentRouting ?? false,
                competitorAlerts: competitorAlerts || '',
                supervisorWhisper: supervisorWhisper ?? true,
                piiRedaction: piiRedaction ?? true,
                geoCallerId: geoCallerId ?? false,
                multiAgentHandoff: multiAgentHandoff ?? false,
                objectionHandling: objectionHandling || 'standard',
                emotionalMirroring: emotionalMirroring ?? true,
                complianceScript: complianceScript || null,
                dynamicCodeSwitching: dynamicCodeSwitching ?? true,
                dncLitigatorScrub: dncLitigatorScrub ?? true,
                callBlending: callBlending ?? false,
                costCapTokens: costCapTokens || 5000,
                postCallSms: postCallSms || null,
                autoFollowUp: autoFollowUp ?? true,
                followUpDefaultDays: followUpDefaultDays || 1,
                followUpDefaultTime: followUpDefaultTime || '10:00',
            }
        });

        // Auto-create initial PromptVersion
        await prisma.promptVersion.create({
            data: {
                agentId: agent.id,
                version: 1,
                prompt: systemPrompt || '',
                isActive: true,
                label: 'v1 - Initial'
            }
        });

        res.status(201).json({
            message: "Agent successfully created.",
            agentId: agent.id,
            agent
        });
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: "Failed to create agent" });
    }
});

// GET /v1/agents/:id - Retrieve an existing agent via API
router.get('/agents/:id', async (req, res) => {
    try {
        const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
            include: { PromptVersion: { orderBy: { version: 'desc' } } }
        });
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        res.json(agent);
    } catch (e) {
        console.error('[EXTERNAL API ERROR]', e);
        res.status(500).json({ error: "Failed to retrieve agent" });
    }
});

export default router;
