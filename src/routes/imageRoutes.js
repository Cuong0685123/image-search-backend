import { Router } from 'express';
import { searchImages } from '../controllers/imageController.js';

const router = Router();

// Định nghĩa endpoint GET /api/search
router.get('/search', searchImages);

export default router;