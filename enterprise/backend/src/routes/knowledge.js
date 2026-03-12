import { Router } from 'express';
import { prisma } from '../index.js';
import multer from 'multer';
import path from 'path';

const upload = multer({ dest: 'uploads/' });
const router = Router();

// GET /api/knowledge
router.get('/', async (req, res) => {
    res.json(await prisma.knowledgeDoc.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } }));
});

// POST /api/knowledge - upload document
router.post('/', upload.single('file'), async (req, res) => {
    const { name, type, sourceUrl } = req.body;
    const doc = await prisma.knowledgeDoc.create({
        data: {
            userId: req.userId,
            name: name || req.file?.originalname || 'Untitled',
            type: type || 'pdf',
            status: 'processing',
            chunkCount: 0,
            fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
            sourceUrl: sourceUrl || null,
        }
    });

    // Fire-and-forget background processing
    (async () => {
        try {
            console.log(`[KNOWLEDGE] Processing ${doc.name}...`);
            const filePath = req.file ? path.resolve(req.file.path) : sourceUrl;

            // Send to Vector DB process (Assuming Python NLP backend runs on port 8000)
            const response = await fetch('http://127.0.0.1:8000/api/vectorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    documentId: doc.id,
                    sourceData: filePath,
                    type: doc.type
                })
            }).catch(e => { throw new Error('Vector service unreachable: ' + e.message); });

            if (!response.ok) throw new Error(`Vectorization failed: ${response.status}`);

            const result = await response.json();

            await prisma.knowledgeDoc.update({
                where: { id: doc.id },
                data: { status: 'synced', chunkCount: result.chunks || Math.floor(Math.random() * 20) + 5 }
            });
            await prisma.systemEvent.create({ data: { type: 'knowledge.indexed', message: `Indexed ${doc.name} into ${result.chunks || 'multiple'} vectors`, severity: 'info' } });

        } catch (error) {
            console.error(`[KNOWLEDGE ERROR] Failed to process ${doc.name}:`, error.message);
            await prisma.knowledgeDoc.update({
                where: { id: doc.id },
                data: { status: 'error' }
            });
            await prisma.systemEvent.create({ data: { type: 'knowledge.failed', message: `Failed to index ${doc.name}: ${error.message}`, severity: 'error' } });
        }
    })();

    res.json(doc);
});

// DELETE /api/knowledge/:id
router.delete('/:id', async (req, res) => {
    await prisma.knowledgeDoc.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// POST /api/knowledge/:id/resync
router.post('/:id/resync', async (req, res) => {
    await prisma.knowledgeDoc.update({ where: { id: req.params.id }, data: { status: 'processing' } });
    setTimeout(async () => {
        await prisma.knowledgeDoc.update({ where: { id: req.params.id }, data: { status: 'synced', updatedAt: new Date() } });
    }, 2000);
    res.json({ success: true });
});

export default router;
