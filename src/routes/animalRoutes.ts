import { Router } from 'express';
import { getAllAnimals } from '../controllers/animalController.js';

const router = Router();

router.get('/', getAllAnimals);

export default router;