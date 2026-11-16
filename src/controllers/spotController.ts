import type { Request, Response } from "express";
import { Spot, Photo, Animal, User, SpottedIn } from "../models/index.js";
import { generatePresignedUrl } from "../services/r2Service.js";

// api for presignedurl
export const getPresignedUrl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
      res
        .status(400)
        .json({ success: false, message: "Missing fileName or fileType" });
      return;
    }
    //create path for upload
    const { uploadUrl, publicUrl } = await generatePresignedUrl(
      fileName,
      fileType,
    );
    res.status(200).json({
      success: true,
      data: { uploadUrl, publicUrl },
    });
  } catch (error) {
    console.error("Error generating presigned url:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// api create spot
export const createSpot = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { title, description, address, lat, lng, photoUrls, animals, date } =
      req.body;

    //const userId = 1;

    //ตอนที่สร้าง spot มันจะให้ spot บันทึกว่า userID ไหนเป็นคนสร้าง
    const userId = req.session.userID;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Please log in",
      });
      return;
    }

    const newSpot = await Spot.create({
      userId: userId,
      title,
      description,
      address,
      latitude: lat,
      longitude: lng,
      date,
    });
    if (photoUrls && Array.isArray(photoUrls) && photoUrls.length > 0) {
      for (const url of photoUrls) {
        await Photo.create({
          spotId: newSpot.spotId,
          photoUrl: url,
        });
      }
    }
    if (animals && Array.isArray(animals) && animals.length > 0) {
      for (const animal of animals) {
        const animalId = typeof animal === "object" ? animal.animalId : animal;

        if (animalId) {
          await SpottedIn.create({
            spotId: newSpot.spotId,
            animalId: animalId,
          });
        }
      }
    }
    res.status(201).json({
      success: true,
      message: "Spot created successfully",
      data: newSpot,
    });
  } catch (error) {
    console.error("Error creating spot:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// api getall spots
export const getAllSpots = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const spots = await Spot.findAll({
      include: [
        {
          model: Photo,
          as: "photos",
          attributes: ["photoId", "photoUrl"],
        },
        {
          model: Animal,
          as: "animals",
          attributes: ["animalId", "name", "categoryId", "animalImagePin"],
          through: { attributes: [] },
        },
        {
          model: User,
          as: "user",
          attributes: ["userId", "username"],
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
    console.error("Error fetching spots:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
