import type { RequestHandler } from "express";
import multer from "multer";
import {
  MAX_PROFILE_PHOTO_SIZE,
  PROFILE_IMAGE_EXTENSIONS,
} from "../services/profileR2Service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_PHOTO_SIZE, files: 1, fields: 3, parts: 4, fieldSize: 1024 },
  fileFilter: (_req, file, callback) => {
    if (!Object.hasOwn(PROFILE_IMAGE_EXTENSIONS, file.mimetype)) {
      callback(new Error("Choose a PNG, JPEG or WebP photo under 2 MB."));
      return;
    }
    callback(null, true);
  },
}).single("profileImage");

function matchesImageType(file: Express.Multer.File): boolean {
  const bytes = file.buffer;
  if (file.mimetype === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (file.mimetype === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  return file.mimetype === "image/webp" && bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

export const registerPhotoUpload: RequestHandler = (req, res, next) => {
  // คำขอ JSON ที่ไม่มีรูปยังใช้ Register แบบเดิมได้
  upload(req, res, (error: unknown) => {
    if (error) {
      const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({
        success: false,
        message: tooLarge ? "Choose a profile photo under 2 MB." : "Invalid registration form or profile photo.",
      });
      return;
    }

    if (req.file && !matchesImageType(req.file)) {
      res.status(400).json({ success: false, message: "The profile photo must be a PNG, JPEG or WebP image." });
      return;
    }
    next();
  });
};
