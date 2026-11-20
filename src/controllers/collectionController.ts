import type { Request, Response } from "express";
import prisma from "../config/db.js";

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
    const rawSpots = await prisma.spot.findMany({
      where: { userId },
      include: {
        photos: {
          select: { photoId: true, photoUrl: true },
        },
        spottedIn: {
          select: {
            animal: {
              select: {
                animalId: true,
                categoryId: true,
                name: true,
                animalImagePin: true,
                spotsCount: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const spots = rawSpots.map(({ spottedIn, ...spot }) => ({
      ...spot,
      animals: spottedIn.map((item) => item.animal),
    }));

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