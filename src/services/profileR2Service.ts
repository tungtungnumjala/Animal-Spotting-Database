import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const PROFILE_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export const MAX_PROFILE_PHOTO_SIZE = 2 * 1024 * 1024;

function createProfileUpload(userID: number, fileType: string) {
  const extension = PROFILE_IMAGE_EXTENSIONS[fileType];
  if (!extension) throw new Error("Unsupported profile image type");

  const bucket = process.env.R2_BUCKET_NAMEProfile;
  const endpoint = process.env.R2_ENDPOINTProfile;
  const accessKeyId = process.env.R2_ACCESS_KEY_IDProfile;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEYProfile;
  const publicBaseUrl = process.env.R2_PUBLIC_URLProfile;

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    throw new Error("Profile R2 settings are incomplete: check the five variables ending in Profile");
  }
  if (new URL(endpoint).protocol !== "https:" || new URL(publicBaseUrl).protocol !== "https:") {
    throw new Error("Profile R2 endpoint and public URL must use HTTPS");
  }

  const key = `profiles/${userID}/${randomUUID()}.${extension}`;
  const publicUrl = `${publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  if (publicUrl.length > 255) {
    throw new Error("Profile image URL exceeds the profile_image column length");
  }

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: fileType,
  });

  return { client, command, publicUrl };
}

export async function generateProfilePresignedUrl(userID: number, fileType: string) {
  const { client, command, publicUrl } = createProfileUpload(userID, fileType);
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
  return { uploadUrl, publicUrl };
}

export async function uploadProfilePhoto(userID: number, fileType: string, body: Buffer) {
  const { client, command, publicUrl } = createProfileUpload(userID, fileType);
  try {
    await client.send(new PutObjectCommand({ ...command.input, Body: body }));
    return publicUrl;
  } finally {
    client.destroy();
  }
}
