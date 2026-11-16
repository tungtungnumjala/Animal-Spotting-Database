import type { Request, Response } from "express";
import { Spot, Photo } from "../models/index.js";

export const getMySpots = async (
    req: Request,
    res: Response,
): Promise<void> => {
    const userId = req.session.userID;

    if (!userId) {
        res.status(401).json({
            success: false,
            message: "Please log in",
        });
        return;
    }
    try {
        const spots = await Spot.findAll({
            where: { userId },
            include: [
                {
                    model: Photo,
                    as: "photos",
                    attributes: ["photoId", "photoUrl"],
                },
            ],
            order: [["createdAt", "DESC"]],
        });

        res.status(200).json({
            success: true,
            count: spots.length,
            data: spots,
        });
    } catch (error) {
        console.error("Error fetching collection:", error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch collection",
        });
    }

};