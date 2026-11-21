import type { Request, Response } from "express";
import prisma from "../config/db.js";
import {
  generatePresignedUrl,
  deleteFilesFromR2,
  isValidSpotPhotoUrl,
  SPOT_IMAGE_EXTENSIONS,
  MAX_SPOT_PHOTO_SIZE,
  MAX_SPOT_PHOTOS_COUNT,
} from "../services/r2ServiceSpots.js";

// Helper สำหรับ Throw error ที่มี HTTP status ภายใน Prisma interactive transaction
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Helper ตรวจสอบพิกัด Latitude / Longitude
function parseCoordinate(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

// Helper ตรวจสอบและกรองรายการ photoUrls
function validatePhotoUrls(
  photoUrls: unknown,
  userId: number,
): { ok: true; urls: string[] } | { ok: false; message: string } {
  if (!Array.isArray(photoUrls)) {
    return { ok: false, message: "photoUrls must be an array" };
  }
  if (photoUrls.length > MAX_SPOT_PHOTOS_COUNT) {
    return {
      ok: false,
      message: `You can upload up to ${MAX_SPOT_PHOTOS_COUNT} photos per spot`,
    };
  }

  const cleaned: string[] = [];
  for (const item of photoUrls) {
    if (typeof item !== "string") {
      return { ok: false, message: "Invalid photo URL format" };
    }
    const trimmedUrl = item.trim();
    if (!isValidSpotPhotoUrl(trimmedUrl, userId)) {
      return { ok: false, message: "Invalid or unauthorized photo URL" };
    }
    cleaned.push(trimmedUrl);
  }
  return { ok: true, urls: [...new Set(cleaned)] };
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

    const { fileType, fileSize, spotId } = req.body ?? {};

    if (
      typeof fileType !== "string" ||
      !Object.hasOwn(SPOT_IMAGE_EXTENSIONS, fileType)
    ) {
      res.status(400).json({
        success: false,
        message: "Only PNG, JPEG, or WebP images are allowed",
      });
      return;
    }

    if (
      typeof fileSize !== "number" ||
      !Number.isInteger(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_SPOT_PHOTO_SIZE
    ) {
      res.status(400).json({
        success: false,
        message: "Image size must be between 1 byte and 5 MB",
      });
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

  // ตรวจสอบ title (VarChar(100))
  if (
    typeof title !== "string" ||
    title.trim().length < 1 ||
    title.trim().length > 100
  ) {
    res.status(400).json({
      success: false,
      message: "Title is required and must be 1–100 characters",
    });
    return;
  }
  const cleanTitle = title.trim();

  // ตรวจสอบ address
  if (
    typeof address !== "string" ||
    address.trim().length < 1 ||
    address.trim().length > 1000
  ) {
    res.status(400).json({
      success: false,
      message: "Address is required and must be 1–1000 characters",
    });
    return;
  }
  const cleanAddress = address.trim();

  let cleanDate: Date | null = null;
  if (date !== undefined && date !== null && date !== "") {
    if (typeof date !== "string" && !(date instanceof Date)) {
      res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
      return;
    }

    const parsedDate = new Date(date);
    // เเปลง date เป็น Timestamp เช็คว่า date มาถูกมั้ย
    if (Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
      return;
    }
    cleanDate = parsedDate;
  }

  // ตรวจสอบ description (Optional)
  let cleanDescription: string | null = null;
  if (description !== undefined && description !== null) {
    if (typeof description !== "string" || description.length > 5000) {
      res.status(400).json({
        success: false,
        message: "Description must be text up to 5000 characters",
      });
      return;
    }
    cleanDescription = description.trim() || null;
  }

  // ตรวจสอบพิกัด lat (-90..90) และ lng (-180..180)
  const cleanLat = parseCoordinate(lat, -90, 90);
  const cleanLng = parseCoordinate(lng, -180, 180);
  if (cleanLat === null || cleanLng === null) {
    res.status(400).json({
      success: false,
      message:
        "Valid latitude (-90 to 90) and longitude (-180 to 180) are required",
    });
    return;
  }

  // ตรวจสอบ photoUrls
  let validUrls: string[] = [];
  if (photoUrls !== undefined && photoUrls !== null) {
    const photoCheck = validatePhotoUrls(photoUrls, userId);
    if (!photoCheck.ok) {
      res.status(400).json({ success: false, message: photoCheck.message });
      return;
    }
    validUrls = photoCheck.urls;
  }

  try {
    const newSpot = await prisma.$transaction(async (tx) => {
      const created = await tx.spot.create({
        data: {
          userId,
          title: cleanTitle,
          description: cleanDescription ?? null,
          address: cleanAddress,
          latitude: cleanLat,
          longitude: cleanLng,
          date: cleanDate,
        },
      });

      if (validUrls.length > 0) {
        await tx.photo.createMany({
          data: validUrls.map((photoUrl) => ({
            spotId: created.spotId,
            photoUrl,
          })),
        });
      }

      if (animals && Array.isArray(animals) && animals.length > 0) {
        const uniqueAnimalIds = [
          ...new Set(
            animals
              .map((animal: any) =>
                typeof animal === "object" && animal !== null
                  ? Number(animal.animalId)
                  : NaN,
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
            select: { userId: true, username: true, profileImage: true },
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
          select: { userId: true, username: true, profileImage: true },
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

  const { title, description, address, photoUrls, animals, date } = req.body;

  // 1. Validate ฟิลด์ที่ถูกส่งเข้ามาแก้ไข (เช็กเฉพาะตัวที่ !== undefined)
  let cleanTitle: string | undefined;
  if (title !== undefined) {
    if (
      typeof title !== "string" ||
      title.trim().length < 1 ||
      title.trim().length > 100
    ) {
      res.status(400).json({
        success: false,
        message: "Title must be 1–100 characters",
      });
      return;
    }
    cleanTitle = title.trim();
  }

  let cleanAddress: string | undefined;
  if (address !== undefined) {
    if (
      typeof address !== "string" ||
      address.trim().length < 1 ||
      address.trim().length > 1000
    ) {
      res.status(400).json({
        success: false,
        message: "Address must be 1–1000 characters",
      });
      return;
    }
    cleanAddress = address.trim();
  }

  let cleanDescription: string | null | undefined;
  if (description !== undefined) {
    if (description === null) {
      cleanDescription = null;
    } else if (typeof description !== "string" || description.length > 5000) {
      res.status(400).json({
        success: false,
        message: "Description must be text up to 5000 characters",
      });
      return;
    } else {
      cleanDescription = description.trim() || null;
    }
  }

  let cleanDate: Date | null | undefined;
  if (date !== undefined) {
    if (date === null || date === "") {
      cleanDate = null;
    } else {
      const parsedDate = new Date(date);
      if (Number.isNaN(parsedDate.getTime())) {
        res
          .status(400)
          .json({ success: false, message: "Invalid date format" });
        return;
      }
      cleanDate = parsedDate;
    }
  }

  // ใช้ validatePhotoUrls ตัวเดียวกับ createSpot
  let validatedPhotoUrls: string[] | undefined;
  if (photoUrls !== undefined) {
    const photoCheck = validatePhotoUrls(photoUrls, userId);
    if (!photoCheck.ok) {
      res.status(400).json({ success: false, message: photoCheck.message });
      return;
    }
    validatedPhotoUrls = photoCheck.urls;
  }

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

    if (validatedPhotoUrls !== undefined) {
      const existingPhotos = await prisma.photo.findMany({
        where: { spotId },
      });
      const existingUrls = existingPhotos.map((p) => p.photoUrl);

      removedUrls = existingUrls.filter(
        (url) => !validatedPhotoUrls!.includes(url),
      );
      addedUrls = validatedPhotoUrls.filter(
        (url) => !existingUrls.includes(url),
      );
    }

    // 3. เปิด Transaction อัปเดตข้อมูลทั้งหมดลง Database
    const rawUpdatedSpot = await prisma.$transaction(async (tx) => {
      // 3.1 อัปเดตข้อมูลหลักของ Spot
      await tx.spot.update({
        where: { spotId },
        data: {
          title: cleanTitle ?? spot.title,
          description:
            cleanDescription !== undefined
              ? cleanDescription
              : spot.description,
          address: cleanAddress ?? spot.address,
          date: cleanDate !== undefined ? cleanDate : spot.date,
        },
      });

      // 3.2 อัปเดตตาราง Photo
      if (validatedPhotoUrls !== undefined) {
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
                typeof animal === "object" && animal !== null
                  ? Number(animal.animalId)
                  : NaN,
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
            select: { userId: true, username: true, profileImage: true },
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
