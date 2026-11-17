import type { Request, Response } from "express";
import { Spot, Photo, Animal, User, SpottedIn } from "../models/index.js";
import {
  generatePresignedUrl,
  deleteFilesFromR2,
} from "../services/r2ServiceSpots.js";
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

  //ตอนที่สร้าง spot มันจะให้ spot บันทึกว่า userID ไหนเป็นคนสร้าง
  const userId = req.session.userID;
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Please log in",
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

    const createdSpotWithDetails = await Spot.findByPk(newSpot.spotId, {
      include: [
        {
          model: User,
          attributes: ["username", "profileImage"],
          as: "user",
        },
      ],
    });

    res.status(201).json({
      success: true,
      message: "Spot created successfully",
      data: createdSpotWithDetails,
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

// api update spot
export const updateSpot = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const userId = req.session.userID;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Please log in",
    });
    return;
  }

  if (Number.isNaN(spotId) || spotId <= 0) {
    res.status(400).json({
      success: false,
      message: "Invalid spot ID",
    });
    return;
  }

  const { title, description, address, lat, lng, photoUrls, animals, date } =
    req.body;

  const t = await sequelize.transaction();
  const removedUrls: string[] = [];

  try {
    // 1. ค้นหา Spot เดิมและตรวจสอบสิทธิ์ความเป็นเจ้าของ
    const spot = await Spot.findByPk(spotId, { transaction: t });

    if (!spot) {
      await t.rollback();
      res.status(404).json({
        success: false,
        message: "Spot not found",
      });
      return;
    }

    if (spot.userId !== userId) {
      await t.rollback();
      res.status(403).json({
        success: false,
        message: "You do not have permission to edit this spot",
      });
      return;
    }

    // 2. อัปเดตข้อมูลหลักของ Spot
    await spot.update(
      {
        title: title ?? spot.title,
        description: description ?? spot.description,
        address: address ?? spot.address,
        latitude: lat !== undefined ? lat : spot.latitude,
        longitude: lng !== undefined ? lng : spot.longitude,
        date: date ?? spot.date,
      },
      { transaction: t },
    );

    // 3. จัดการรูปภาพแบบ Differential (ลบเฉพาะรูปที่หายไป เพิ่มเฉพาะรูปใหม่)
    if (Array.isArray(photoUrls)) {
      const validUrls = [
        ...new Set(
          photoUrls
            .filter((url: unknown): url is string => typeof url === "string")
            .map((url) => url.trim())
            .filter((url) => url.length > 0),
        ),
      ];

      const existingPhotos = await Photo.findAll({
        where: { spotId },
        transaction: t,
      });
      const existingUrls = existingPhotos.map((p) => p.photoUrl);
      removedUrls.push(
        ...existingUrls.filter((url) => !validUrls.includes(url)),
      );
      const addedUrls = validUrls.filter((url) => !existingUrls.includes(url));

      if (removedUrls.length > 0) {
        await Photo.destroy({
          where: { spotId, photoUrl: removedUrls },
          transaction: t,
        });
      }

      if (addedUrls.length > 0) {
        await Photo.bulkCreate(
          addedUrls.map((photoUrl) => ({ spotId, photoUrl })),
          { transaction: t },
        );
      }
    }

    // 4. จัดการสัตว์แบบ Differential (ลบเฉพาะตัวที่เอาออก เพิ่มเฉพาะตัวที่มาใหม่)
    if (Array.isArray(animals)) {
      const newAnimalIds = [
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

      const oldSpottedRecords = await SpottedIn.findAll({
        where: { spotId },
        transaction: t,
      });
      const oldAnimalIds = oldSpottedRecords.map((r) => r.animalId);

      const removedAnimalIds = oldAnimalIds.filter(
        (id) => !newAnimalIds.includes(id),
      );
      const addedAnimalIds = newAnimalIds.filter(
        (id) => !oldAnimalIds.includes(id),
      );

      if (removedAnimalIds.length > 0) {
        await SpottedIn.destroy({
          where: { spotId, animalId: removedAnimalIds },
          transaction: t,
        });

        await Animal.decrement("spotsCount", {
          by: 1,
          where: { animalId: removedAnimalIds },
          transaction: t,
        });
      }

      if (addedAnimalIds.length > 0) {
        await SpottedIn.bulkCreate(
          addedAnimalIds.map((animalId) => ({ spotId, animalId })),
          { transaction: t },
        );

        await Animal.increment("spotsCount", {
          by: 1,
          where: { animalId: addedAnimalIds },
          transaction: t,
        });
      }
    }

    await t.commit();

    if (removedUrls.length > 0) {
      deleteFilesFromR2(removedUrls).catch((r2Err) => {
        console.error("Warning: Failed to delete old files from R2:", r2Err);
      });
    }

    // 5. ดึงข้อมูลล่าสุดพร้อม include (เหมือน getAllSpots) ส่งกลับไปให้หน้าบ้าน
    const updatedSpot = await Spot.findByPk(spotId, {
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
    });

    res.status(200).json({
      success: true,
      message: "Spot updated successfully",
      data: updatedSpot,
    });
  } catch (error) {
    await t.rollback();
    console.error("Error updating spot:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// api delete spot
export const deleteSpot = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const userId = req.session.userID;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Please log in",
    });
    return;
  }

  if (Number.isNaN(spotId) || spotId <= 0) {
    res.status(400).json({
      success: false,
      message: "Invalid spot ID",
    });
    return;
  }

  const t = await sequelize.transaction();
  let photoUrlsToDelete: string[] = [];

  try {
    // 1. ค้นหา Spot และตรวจสอบสิทธิ์ความเป็นเจ้าของ
    const spot = await Spot.findByPk(spotId, { transaction: t });

    if (!spot) {
      await t.rollback();
      res.status(404).json({
        success: false,
        message: "Spot not found",
      });
      return;
    }

    if (spot.userId !== userId) {
      await t.rollback();
      res.status(403).json({
        success: false,
        message: "You do not have permission to delete this spot",
      });
      return;
    }

    // 2. ดึง URL รูปภาพทั้งหมดของ Spot นี้เก็บไว้ (เพื่อเอาไปลบออกจาก R2 หลัง commit)
    const photos = await Photo.findAll({
      where: { spotId },
      transaction: t,
    });
    photoUrlsToDelete = photos.map((p) => p.photoUrl);

    // 3. ดึงรายการสัตว์ที่ผูกกับ Spot นี้ เพื่อลด spotsCount ลง 1
    const spottedRecords = await SpottedIn.findAll({
      where: { spotId },
      transaction: t,
    });
    const animalIds = spottedRecords.map((r) => r.animalId);

    if (animalIds.length > 0) {
      await Animal.decrement("spotsCount", {
        by: 1,
        where: { animalId: animalIds },
        transaction: t,
      });
    }

    // 4. ลบข้อมูลในตารางลูก (Photo, SpottedIn) และลบตัว Spot หลัก
    await Photo.destroy({
      where: { spotId },
      transaction: t,
    });

    await SpottedIn.destroy({
      where: { spotId },
      transaction: t,
    });

    await spot.destroy({ transaction: t });

    // ยืนยันการลบข้อมูลใน Database
    await t.commit();

    if (photoUrlsToDelete.length > 0) {
      deleteFilesFromR2(photoUrlsToDelete).catch((r2Err) => {
        console.error("Warning: Failed to delete spot photos from R2:", r2Err);
      });
    }

    res.status(200).json({
      success: true,
      message: "Spot deleted successfully",
    });
  } catch (error) {
    if (t && !(t as any).finished) {
      await t.rollback();
    }
    console.error("Error deleting spot:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
