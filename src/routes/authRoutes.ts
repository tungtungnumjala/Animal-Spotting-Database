import { Router } from 'express';
import { getProfilePhotoUploadUrl, updateProfile } from '../controllers/profileController.js';
import {
    register,
    login,
    getMe,
    logout,
} from '../controllers/authController.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', getMe);
router.patch('/me', updateProfile);
router.post('/profile-photo-url', getProfilePhotoUploadUrl);
router.post('/logout', logout);

export default router;
