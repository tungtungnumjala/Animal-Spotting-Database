import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

  // สร้าง Presigned URL expired in 300 sec
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  return {
    uploadUrl, // ลิงก์เอาไว้ upload ส่งไป frontend 
    publicUrl: `${process.env.R2_PUBLIC_URL?.replace(/\/+$/, "")}/${uniqueFileName}`, // ลบเฉพาะ / ที่อยู่ท้าย URL ทั้งหมด แล้วเติม / หนึ่งตัวตอนต่อชื่อไฟล์
    //publicUrl: `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`, // ลิงก์ถาวรสำหรับเอาไปบันทึกลง db แสดงผล
  };
};