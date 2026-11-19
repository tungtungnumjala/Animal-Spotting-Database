import { Router } from "express";
import { getMySpots } from "../controllers/collectionController.js";

const router = Router();

router.get("/", getMySpots);

export default router;