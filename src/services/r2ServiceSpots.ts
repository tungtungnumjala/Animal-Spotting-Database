import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

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
  fileName: string,
  fileType: string,
  userId: number,
  spotId?: number,
) => {
  const folder = spotId ? `spots/${userId}/${spotId}` : `spots/temp/${userId}`;
  const uniqueFileName = `${folder}/${Date.now()}-${fileName}`;

  // สร้างคำสั่งสำหรับ upload ลง cloudfare
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: uniqueFileName,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  return {
    uploadUrl, // ลิงก์เอาไว้ upload ส่งไป frontend
    publicUrl: `${process.env.R2_PUBLIC_URL?.replace(/\/+$/, "")}/${uniqueFileName}`,
  };
};

export const moveTempFilesToSpotFolder = async (
  publicUrls: string[],
  userId: number,
  spotId: number,
): Promise<string[]> => {
  if (!publicUrls || publicUrls.length === 0) return [];

  const bucket = process.env.R2_BUCKET_NAME;
  const baseUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "") || "";
  const tempPrefix = `spots/temp/${userId}/`;
  const tempKeysToDelete: string[] = [];

  const finalUrls = await Promise.all(
    publicUrls.map(async (url) => {
      let oldKey = "";
      if (baseUrl && url.startsWith(baseUrl)) {
        oldKey = url.slice(baseUrl.length).replace(/^\/+/, "");
      } else {
        try {
          oldKey = decodeURIComponent(
            new URL(url).pathname.replace(/^\/+/, ""),
          );
        } catch {
          return url;
        }
      }

      // เช็กว่าเป็นไฟล์ชั่วคราวของ User คนนี้หรือไม่ (ป้องกันการแอบอ้างไฟล์ของ User อื่นด้วย)
      if (!oldKey.startsWith(tempPrefix)) {
        return url;
      }

      const fileName = oldKey.slice(tempPrefix.length);
      const newKey = `spots/${userId}/${spotId}/${fileName}`;

      await s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: encodeURI(`${bucket}/${oldKey}`),
          Key: newKey,
        }),
      );

      tempKeysToDelete.push(oldKey);
      return `${baseUrl}/${newKey}`;
    }),
  );

  if (tempKeysToDelete.length > 0) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: tempKeysToDelete.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  return finalUrls;
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
