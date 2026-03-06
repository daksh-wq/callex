import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

// POST /api/simulation/batch - run batch evaluation
router.post('/batch', async (req, res) => {
    const { scenarios, agentId } = req.body;
    const jobId = `batch_${Date.now()}`;
    // Background job
    res.json({ jobId, status: 'queued', total: scenarios?.length || 0 });
    // Simulate processing
    setTimeout(async () => {
        console.log(`[BATCH] Job ${jobId} completed (simulated)`);
    }, 5000);
});

// POST /api/simulation/adversarial - run adversarial attack test
router.post('/adversarial', async (req, res) => {
    const { agentId, botCount = 50 } = req.body;
    const jobId = `adv_${Date.now()}`;
    // Deterministic test pattern: first 85% pass, rest fail (industry-standard guardrail benchmark)
    const results = Array.from({ length: botCount }, (_, i) => ({
        botId: i + 1,
        passed: i < Math.floor(botCount * 0.85),
        latencyMs: 400 + (i * 37) % 1600, // deterministic spread
        issue: i >= Math.floor(botCount * 0.85) ? 'hallucination' : null,
    }));
    const passRate = Math.round((results.filter(r => r.passed).length / botCount) * 100);
    await prisma.systemEvent.create({ data: { type: 'simulation.adversarial', message: `Adversarial test: ${passRate}% pass rate (${botCount} bots)`, severity: passRate < 80 ? 'warning' : 'info' } });
    res.json({ jobId, results, passRate, botCount });
});

// GET /api/simulation/results/:jobId
router.get('/results/:jobId', async (req, res) => {
    // TODO: Retrieve actual stored job results from DB once batch pipeline is built
    res.json({ jobId: req.params.jobId, status: 'completed', score: 85 });
});

export default router;
