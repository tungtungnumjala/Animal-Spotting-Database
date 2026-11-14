import { Router } from 'express';
import { getPresignedUrl, createSpot, getAllSpots } from '../controllers/spotController.js';

const router = Router();

router.post('/presigned-url', getPresignedUrl);
router.post('/', createSpot);

router.get('/', getAllSpots);

export default router;