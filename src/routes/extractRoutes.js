import express from 'express';
import { extractImages } from '../controllers/extractController.js';

const router = express.Router();

// Endpoint: GET /api/extract-images?url=...
router.get('/extract-images', extractImages);

export default router;