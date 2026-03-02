import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';

const prisma = new PrismaClient();
const router = Router();

// Helper to filter dates
function getDateFilter(range) {
    const now = new Date();
    const filter = {};

    if (range === 'today') {
        now.setHours(0, 0, 0, 0);
        filter.gte = now;
    } else if (range === '7d') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        filter.gte = d;
    } else if (range === '30d') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        filter.gte = d;
    } else if (range === 'this_month') {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        filter.gte = d;
    } else if (range === 'last_month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        filter.gte = start;
        filter.lte = end;
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
}

// GET /api/reports/export
// Query: ?type=calls_log|qa_scores|billing_usage & range=7d
router.get('/export', async (req, res) => {
    try {
        const { type, range } = req.query;
        let dataToExport = [];
        let csvString = "";

        const dateFilter = getDateFilter(range);

        if (type === 'calls_log') {
            const where = {};
            if (dateFilter) where.startedAt = dateFilter;

            const calls = await prisma.call.findMany({
                where,
                include: { agent: true, campaign: true, disposition: true },
                orderBy: { startedAt: 'desc' }
            });

            const rows = calls.map(c => ({
                CallID: c.id,
                Date: new Date(c.startedAt).toISOString(),
                Phone: c.phoneNumber,
                Direction: c.direction,
                Agent: c.agent?.name || 'Unknown',
                Campaign: c.campaign?.name || 'None',
                DurationSecs: c.duration,
                Sentiment: c.sentiment,
                Disposition: c.disposition?.name || '',
                RecordingURL: c.recordingUrl || '',
                Summary: c.summary || ''
            }));

            csvString = stringify(rows, { header: true });

        } else if (type === 'qa_scores') {
            const where = {};
            if (dateFilter) where.evaluatedAt = dateFilter;

            const scores = await prisma.qAScore.findMany({
                where,
                include: { call: { include: { agent: true } }, scorer: true },
                orderBy: { evaluatedAt: 'desc' }
            });

            const rows = scores.map(s => ({
                ScoreID: s.id,
                CallID: s.callId,
                DateScored: new Date(s.evaluatedAt).toISOString(),
                AgentEvaluated: s.call?.agent?.name || 'Unknown',
                ScoredBy: s.scorer?.name || 'Unknown',
                FinalScore: s.score,
                Feedback: s.feedback
            }));

            csvString = stringify(rows, { header: true });

        } else if (type === 'billing_usage') {
            const stats = await prisma.billingStat.findMany({
                orderBy: { month: 'desc' }
            });

            const rows = stats.map(s => ({
                Month: s.month,
                TelecomMins: s.telecomMins,
                VoiceSTT_Mins: s.sttMinutes,
                LLM_Tokens: s.llmTokens,
                TotalCostUSD: s.totalCostUsd
            }));

            csvString = stringify(rows, { header: true });

        } else {
            return res.status(400).json({ error: 'Invalid report type' });
        }

        const filename = `${type}_export_${range || 'all'}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(csvString);

    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Error generating report");
    }
});

export default router;
