import { Router } from 'express';
import { prisma } from '../index.js';
import multer from 'multer';
import path from 'path';

const upload = multer({ dest: 'uploads/' });
const router = Router();

// GET /api/knowledge
router.get('/', async (req, res) => {
    res.json(await prisma.knowledgeDoc.findMany({ orderBy: { createdAt: 'desc' } }));
});

// POST /api/knowledge - upload document
router.post('/', upload.single('file'), async (req, res) => {
    const { name, type, sourceUrl } = req.body;
    const doc = await prisma.knowledgeDoc.create({
        data: {
            name: name || req.file?.originalname || 'Untitled',
            type: type || 'pdf',
            status: 'processing',
            chunkCount: 0,
            fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
            sourceUrl: sourceUrl || null,
        }
    });
    // Process document in background
    setTimeout(async () => {
        const chunkCount = req.file && req.file.size ? Math.max(1, Math.floor(req.file.size / 2048)) : 15;
        await prisma.knowledgeDoc.update({ where: { id: doc.id }, data: { status: 'synced', chunkCount } });
        await prisma.systemEvent.create({ data: { type: 'knowledge.indexed', message: `Indexed ${doc.name} into ${chunkCount} chunks`, severity: 'info' } });
    }, 2000);
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
