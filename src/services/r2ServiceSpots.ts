import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const SPOT_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// กำหนดขนาดสูงสุดต่อรูปไม่เกิน 5 MB
export const MAX_SPOT_PHOTO_SIZE = 5 * 1024 * 1024;
export const MAX_SPOT_PHOTOS_COUNT = 20;

// ตั้งค่าเชื่อม cloudfare
const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || "",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export const generatePresignedUrl = async (
  fileType: string,
  userId: number,
) => {
  const extension = SPOT_IMAGE_EXTENSIONS[fileType];
  if (!extension) {
    throw new Error("Unsupported image type");
  }

  const publicBaseUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (!publicBaseUrl) {
    throw new Error("R2_PUBLIC_URL is not configured");
  }

  const uniqueFileName = `spots/${userId}/${randomUUID()}.${extension}`;
  const publicUrl = `${publicBaseUrl}/${uniqueFileName}`;

  if (publicUrl.length > 255) {
    throw new Error("Generated public URL exceeds 255 characters");
  }

  // สร้าง command หาที่ลงผ่าน uniqueFileName ที่เเบ่ง directory ตาม / เตรียมส่ง uploadUrl ไปให้ frontend ว่ารูปนั้นจะลงที่ไหน
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: uniqueFileName,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  return {
    uploadUrl,
    // ตัว url ที่โยงไปหารูปที่ลงไปใน uploadUrl ก่อนหน้า
    publicUrl,
  };
};

// ตรวจสอบว่า URL ที่ส่งมาบันทึกลง DB เป็น URL ของ R2 จริง, อยู่ในโฟลเดอร์ spots/ และยาวไม่เกิน 255 ตัวอักษร
export const isValidSpotPhotoUrl = (url: string, userId: number): boolean => {
  if (url.length === 0 || url.length > 255) return false;

  const baseUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (!baseUrl) return false;

  try {
    const parsedUrl = new URL(url);
    const parsedBase = new URL(baseUrl);

    if (parsedUrl.origin !== parsedBase.origin) return false;

    return parsedUrl.pathname.startsWith(`/spots/${userId}/`);
  } catch {
    return false;
  }
};

// ฟังก์ชันสำหรับลบไฟล์บน R2
export const deleteFilesFromR2 = async (
  publicUrls: string[],
): Promise<void> => {
  if (!publicUrls || publicUrls.length === 0) return;

  const baseUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "") || "";

  // แปลง publicUrl กลับเป็น Key (เช่น "spots/1700000000-cat.jpg")
  const keys = publicUrls
    .map((url) => {
      if (baseUrl && url.startsWith(baseUrl)) {
        return url.slice(baseUrl.length).replace(/^\/+/, "");
      }
      try {
        return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
      } catch {
        return null;
      }
    })
    .filter((key): key is string => Boolean(key));

  if (keys.length === 0) return;

  const command = new DeleteObjectsCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Delete: {
      Objects: keys.map((Key) => ({ Key })),
      Quiet: true,
    },
  });

  await s3Client.send(command);
};
