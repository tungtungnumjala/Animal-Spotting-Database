import type { Request, Response } from "express";
import prisma from "../config/db.js";
import {
  generatePresignedUrl,
  deleteFilesFromR2,
} from "../services/r2ServiceSpots.js";

// Helper สำหรับ Throw error ที่มี HTTP status ภายใน Prisma interactive transaction
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// api for presignedurl
export const getPresignedUrl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.session.userID;
    if (!userId) {
      res.status(401).json({ success: false, message: "Please log in" });
      return;
    }

    const { fileName, fileType, spotId } = req.body;

    if (!fileName || !fileType) {
      res
        .status(400)
        .json({ success: false, message: "Missing fileName or fileType" });
      return;
    }

    if (typeof fileType !== "string" || !fileType.startsWith("image/")) {
      res
        .status(400)
        .json({ success: false, message: "Only image files are allowed" });
      return;
    }

    let parsedSpotId: number | undefined = undefined;

    if (spotId !== undefined && spotId !== null && spotId !== "") {
      parsedSpotId = Number(spotId);
      if (Number.isNaN(parsedSpotId) || parsedSpotId <= 0) {
        res.status(400).json({ success: false, message: "Invalid spotId" });
        return;
      }

      // เช็กสิทธิ์ว่าเป็นเจ้าของ Spot จริงไหมก่อนออกลิงก์ให้อัปโหลดเข้าโฟลเดอร์นั้น
      const spot = await prisma.spot.findUnique({
        where: { spotId: parsedSpotId },
        select: { userId: true },
      });

      if (!spot) {
        res.status(404).json({ success: false, message: "Spot not found" });
        return;
      }

      if (spot.userId !== userId) {
        res.status(403).json({
          success: false,
          message: "You do not have permission to upload to this spot",
        });
        return;
      }
    }

    const { uploadUrl, publicUrl } = await generatePresignedUrl(
      fileName,
      fileType,
      userId,
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

  const userId = req.session.userID;
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Please log in",
    });
    return;
  }

  try {
    const newSpot = await prisma.$transaction(async (tx) => {
      const created = await tx.spot.create({
        data: {
          userId,
          title,
          description: description ?? null,
          address,
          latitude: lat,
          longitude: lng,
          date: date ? new Date(date) : null,
        },
      });

      // บันทึกรูปภาพลง DB ใน Transaction เดียวกันได้เลย
      if (Array.isArray(photoUrls) && photoUrls.length > 0) {
        const validUrls = [
          ...new Set(
            photoUrls
              .filter((url: unknown): url is string => typeof url === "string")
              .map((url) => url.trim())
              .filter((url) => url.length > 0),
          ),
        ];

        if (validUrls.length > 0) {
          await tx.photo.createMany({
            data: validUrls.map((photoUrl) => ({
              spotId: created.spotId,
              photoUrl,
            })),
          });
        }
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
          await tx.spottedIn.createMany({
            data: uniqueAnimalIds.map((animalId) => ({
              spotId: created.spotId,
              animalId,
            })),
          });

          await tx.animal.updateMany({
            where: { animalId: { in: uniqueAnimalIds } },
            data: { spotsCount: { increment: 1 } },
          });
        }
      }

      return tx.spot.findUnique({
        where: { spotId: created.spotId },
        include: {
          user: {
            select: { username: true, profileImage: true },
          },
          photos: {
            select: { photoId: true, photoUrl: true },
          },
        },
      });
    });

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
    const rawSpots = await prisma.spot.findMany({
      include: {
        photos: {
          select: { photoId: true, photoUrl: true },
        },
        spottedIn: {
          select: {
            animal: {
              select: {
                animalId: true,
                name: true,
                categoryId: true,
                animalImagePin: true,
              },
            },
          },
        },
        user: {
          select: { userId: true, username: true },
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

  try {
    // 1. ค้นหา Spot เดิมและตรวจสอบสิทธิ์ความเป็นเจ้าของก่อนทำอย่างอื่น
    const spot = await prisma.spot.findUnique({ where: { spotId } });

    if (!spot) {
      res.status(404).json({ success: false, message: "Spot not found" });
      return;
    }

    if (spot.userId !== userId) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to edit this spot",
      });
      return;
    }

    // 2. เตรียมจัดการรูปภาพ
    let removedUrls: string[] = [];
    let addedUrls: string[] = [];
    const hasPhotoUpdates = Array.isArray(photoUrls);

    if (hasPhotoUpdates) {
      const validUrls = [
        ...new Set(
          photoUrls
            .filter((url: unknown): url is string => typeof url === "string")
            .map((url) => url.trim())
            .filter((url) => url.length > 0),
        ),
      ];

      const existingPhotos = await prisma.photo.findMany({
        where: { spotId },
      });

      const existingUrls = existingPhotos.map((p) => p.photoUrl);

      removedUrls = existingUrls.filter((url) => !validUrls.includes(url));
      addedUrls = validUrls.filter((url) => !existingUrls.includes(url));
    }

    // 3. เปิด Transaction อัปเดตข้อมูลทั้งหมดลง Database (ทำงานเร็วมาก ไม่มีคำสั่งเน็ตขวาง)
    const rawUpdatedSpot = await prisma.$transaction(async (tx) => {
      // 3.1 อัปเดตข้อมูลหลักของ Spot
      await tx.spot.update({
        where: { spotId },
        data: {
          title: title ?? spot.title,
          description:
            description !== undefined ? description : spot.description,
          address: address ?? spot.address,
          latitude: lat !== undefined ? lat : spot.latitude,
          longitude: lng !== undefined ? lng : spot.longitude,
          date: date !== undefined ? (date ? new Date(date) : null) : spot.date,
        },
      });

      // 3.2 อัปเดตตาราง Photo
      if (hasPhotoUpdates) {
        if (removedUrls.length > 0) {
          await tx.photo.deleteMany({
            where: { spotId, photoUrl: { in: removedUrls } },
          });
        }

        if (addedUrls.length > 0) {
          await tx.photo.createMany({
            data: addedUrls.map((photoUrl) => ({ spotId, photoUrl })),
          });
        }
      }

      // 3.3 จัดการสัตว์แบบ Differential
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

        const oldSpottedRecords = await tx.spottedIn.findMany({
          where: { spotId },
        });
        const oldAnimalIds = oldSpottedRecords.map((r) => r.animalId);

        const removedAnimalIds = oldAnimalIds.filter(
          (id) => !newAnimalIds.includes(id),
        );
        const addedAnimalIds = newAnimalIds.filter(
          (id) => !oldAnimalIds.includes(id),
        );

        if (removedAnimalIds.length > 0) {
          await tx.spottedIn.deleteMany({
            where: { spotId, animalId: { in: removedAnimalIds } },
          });

          await tx.animal.updateMany({
            where: {
              animalId: { in: removedAnimalIds },
              spotsCount: { gt: 0 },
            },
            data: { spotsCount: { decrement: 1 } },
          });
        }

        if (addedAnimalIds.length > 0) {
          await tx.spottedIn.createMany({
            data: addedAnimalIds.map((animalId) => ({ spotId, animalId })),
          });

          await tx.animal.updateMany({
            where: { animalId: { in: addedAnimalIds } },
            data: { spotsCount: { increment: 1 } },
          });
        }
      }

      // 3.4 ดึงข้อมูลล่าสุดพร้อม include ส่งกลับไปให้หน้าบ้าน
      return tx.spot.findUnique({
        where: { spotId },
        include: {
          photos: {
            select: { photoId: true, photoUrl: true },
          },
          spottedIn: {
            select: {
              animal: {
                select: {
                  animalId: true,
                  name: true,
                  categoryId: true,
                  animalImagePin: true,
                },
              },
            },
          },
          user: {
            select: { userId: true, username: true },
          },
        },
      });
    });

    // 4. ลบรูปเก่าที่ไม่ได้ใช้ออกจาก R2 แบบ Background
    if (removedUrls.length > 0) {
      deleteFilesFromR2(removedUrls).catch((r2Err) => {
        console.error("Warning: Failed to delete old files from R2:", r2Err);
      });
    }

    const updatedSpot = rawUpdatedSpot
      ? (() => {
          const { spottedIn, ...rest } = rawUpdatedSpot;
          return {
            ...rest,
            animals: spottedIn.map((item) => item.animal),
          };
        })()
      : null;

    res.status(200).json({
      success: true,
      message: "Spot updated successfully",
      data: updatedSpot,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        success: false,
        message: error.message,
      });
      return;
    }
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

  try {
    const photoUrlsToDelete = await prisma.$transaction(async (tx) => {
      // 1. ค้นหา Spot และตรวจสอบสิทธิ์ความเป็นเจ้าของ
      const spot = await tx.spot.findUnique({ where: { spotId } });

      if (!spot) {
        throw new HttpError(404, "Spot not found");
      }

      if (spot.userId !== userId) {
        throw new HttpError(
          403,
          "You do not have permission to delete this spot",
        );
      }

      // 2. ดึง URL รูปภาพทั้งหมดของ Spot นี้เก็บไว้ (เพื่อเอาไปลบออกจาก R2 หลัง commit)
      const photos = await tx.photo.findMany({
        where: { spotId },
        select: { photoUrl: true },
      });
      const urls = photos.map((p) => p.photoUrl);

      // 3. ดึงรายการสัตว์ที่ผูกกับ Spot นี้ เพื่อลด spotsCount ลง 1
      const spottedRecords = await tx.spottedIn.findMany({
        where: { spotId },
        select: { animalId: true },
      });
      const animalIds = spottedRecords.map((r) => r.animalId);

      if (animalIds.length > 0) {
        await tx.animal.updateMany({
          where: {
            animalId: { in: animalIds },
            spotsCount: { gt: 0 },
          },
          data: { spotsCount: { decrement: 1 } },
        });
      }

      // 4. ลบข้อมูลในตารางลูก และลบตัว Spot หลัก
      await tx.photo.deleteMany({ where: { spotId } });
      await tx.spottedIn.deleteMany({ where: { spotId } });
      await tx.spot.delete({ where: { spotId } });

      return urls;
    });

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
    if (error instanceof HttpError) {
      res.status(error.status).json({
        success: false,
        message: error.message,
      });
      return;
    }
    console.error("Error deleting spot:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
