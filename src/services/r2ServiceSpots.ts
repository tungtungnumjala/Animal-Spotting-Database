import { S3Client, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from 'dotenv';

// ตั้งค่าเชื่อม cloudfare
const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || "",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export const generatePresignedUrl = async (fileName: string, fileType: string) => {
  const uniqueFileName = `spots/${Date.now()}-${fileName}`;

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