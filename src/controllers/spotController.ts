import type { Request, Response } from "express";
import { Spot, Photo, Animal, User, SpottedIn } from "../models/index.js";
import { generatePresignedUrl } from "../services/r2Service.js";
import sequelize from "../config/db.js";

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
  const { title, description, address, lat, lng, photoUrls, animals, date } =
    req.body;
  const userId = 1;

  if (!animals || !Array.isArray(animals) || animals.length === 0) {
    res.status(400).json({
      success: false,
      message: "Please select at least one animal species.",
    });
    return;
  }

  if (!photoUrls || !Array.isArray(photoUrls) || photoUrls.length === 0) {
    res.status(400).json({
      success: false,
      message: "Please upload at least one photo.",
    });
    return;
  }
  //เปิด transaction
  const t = await sequelize.transaction();

  try {
    const newSpot = await Spot.create(
      {
        userId: userId,
        title,
        description,
        address,
        latitude: lat,
        longitude: lng,
        date,
      },
      { transaction: t },
    );

    if (photoUrls && Array.isArray(photoUrls) && photoUrls.length > 0) {
      const photoRecords = photoUrls.map((url: string) => ({
        spotId: newSpot.spotId,
        photoUrl: url,
      }));
      await Photo.bulkCreate(photoRecords, { transaction: t });
    }

    if (animals && Array.isArray(animals) && animals.length > 0) {
      const uniqueAnimalIds = [
        ...new Set(
          animals
            .map((animal: any) =>
              typeof animal === "object"
                ? Number(animal.animalId)
                : Number(animal),
            )
            .filter((id: number) => !Number.isNaN(id) && id > 0),
        ),
      ];

      if (uniqueAnimalIds.length > 0) {
        // บันทึกลงตาราง SpottedIn
        const spottedRecords = uniqueAnimalIds.map((animalId) => ({
          spotId: newSpot.spotId,
          animalId: animalId,
        }));
        await SpottedIn.bulkCreate(spottedRecords, { transaction: t });

        await Animal.increment("spotsCount", {
          by: 1,
          where: {
            animalId: uniqueAnimalIds,
          },
          transaction: t,
        });
      }
    }

    await t.commit();

    res.status(201).json({
      success: true,
      message: "Spot created successfully",
      data: newSpot,
    });
  } catch (error) {
    await t.rollback();
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
