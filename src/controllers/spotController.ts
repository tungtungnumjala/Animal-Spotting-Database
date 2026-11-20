import type { Request, Response } from "express";
import prisma from "../config/db.js";
import {
  generatePresignedUrl,
  deleteFilesFromR2,
  moveTempFilesToSpotFolder,
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
      parsedSpotId,
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

  try {
    //เปิด transaction
    const createdSpotWithDetails = await prisma.$transaction(async (tx) => {
      const newSpot = await tx.spot.create({
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

      if (photoUrls && Array.isArray(photoUrls) && photoUrls.length > 0) {
        const organizedUrls = await moveTempFilesToSpotFolder(
          photoUrls,
          userId,
          newSpot.spotId,
        );

        await tx.photo.createMany({
          data: organizedUrls.map((url: string) => ({
            spotId: newSpot.spotId,
            photoUrl: url,
          })),
        });
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
              spotId: newSpot.spotId,
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
        where: { spotId: newSpot.spotId },
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
      data: createdSpotWithDetails,
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

  const removedUrls: string[] = [];

  try {
    const rawUpdatedSpot = await prisma.$transaction(async (tx) => {
      // 1. ค้นหา Spot เดิมและตรวจสอบสิทธิ์ความเป็นเจ้าของ
      const spot = await tx.spot.findUnique({ where: { spotId } });

      if (!spot) {
        throw new HttpError(404, "Spot not found");
      }

      if (spot.userId !== userId) {
        throw new HttpError(
          403,
          "You do not have permission to edit this spot",
        );
      }

      // 2. อัปเดตข้อมูลหลักของ Spot
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

      // 3. จัดการรูปภาพแบบ Differential
      if (Array.isArray(photoUrls)) {
        const validUrls = [
          ...new Set(
            photoUrls
              .filter((url: unknown): url is string => typeof url === "string")
              .map((url) => url.trim())
              .filter((url) => url.length > 0),
          ),
        ];

        const existingPhotos = await tx.photo.findMany({
          where: { spotId },
        });
        const existingUrls = existingPhotos.map((p) => p.photoUrl);
        removedUrls.push(
          ...existingUrls.filter((url) => !validUrls.includes(url)),
        );
        const addedUrls = validUrls.filter(
          (url) => !existingUrls.includes(url),
        );

        if (removedUrls.length > 0) {
          await tx.photo.deleteMany({
            where: { spotId, photoUrl: { in: removedUrls } },
          });
        }

        if (addedUrls.length > 0) {
          const organizedAddedUrls = await moveTempFilesToSpotFolder(
            addedUrls,
            userId,
            spotId,
          );
          await tx.photo.createMany({
            data: organizedAddedUrls.map((photoUrl) => ({ spotId, photoUrl })),
          });
        }
      }

      // 4. จัดการสัตว์แบบ Differential
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

      // 5. ดึงข้อมูลล่าสุดพร้อม include ส่งกลับไปให้หน้าบ้าน
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

    if (removedUrls.length > 0) {
      deleteFilesFromR2(removedUrls).catch((r2Err) => {
        console.error("Warning: Failed to delete old files from R2:", r2Err);
      });
    }

    const updatedSpot = rawUpdatedSpot
      ? {
          ...(() => {
            const { spottedIn, ...rest } = rawUpdatedSpot;
            return {
              ...rest,
              animals: spottedIn.map((item) => item.animal),
            };
          })(),
        }
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
