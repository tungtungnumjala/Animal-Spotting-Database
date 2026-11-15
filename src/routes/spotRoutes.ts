import { Router } from 'express';
import { getAllSpots, createSpot } from '../controllers/spotController.js';

const router = Router();

router.get('/', getAllSpots);
router.post('/', createSpot);

export default router;