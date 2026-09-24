import express from 'express';
import { searchWeb } from '../controllers/webController.js';

const router = express.Router();

// GET /api/web?q=...&page=...
router.get('/', searchWeb);

export default router;