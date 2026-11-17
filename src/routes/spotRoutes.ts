import { Router } from 'express';
import { getPresignedUrl, createSpot, getAllSpots, updateSpot, deleteSpot } from '../controllers/spotController.js';

const router = Router();

router.post('/presigned-url', getPresignedUrl);
router.post('/', createSpot);

router.get('/', getAllSpots);

router.put('/:spotId', updateSpot);

router.delete('/:spotId', deleteSpot);
export default router;