import type { Request, Response } from "express";
import { UniqueConstraintError } from "sequelize";
import User from "../models/User.js";
import {
  generateProfilePresignedUrl,
  MAX_PROFILE_PHOTO_SIZE,
  PROFILE_IMAGE_EXTENSIONS,
} from "../services/profileR2Service.js";

export const getProfilePhotoUploadUrl = async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const userID = req.session.userID;
  if (!userID) {
    res.status(401).json({ success: false, message: "Please log in" });
    return;
  }

  const { fileType, fileSize } = req.body ?? {};
  if (
    typeof fileType !== "string" ||
    !Object.hasOwn(PROFILE_IMAGE_EXTENSIONS, fileType) ||
    typeof fileSize !== "number" ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0 ||
    fileSize > MAX_PROFILE_PHOTO_SIZE
  ) {
    res.status(400).json({
      success: false,
      message: "Choose a PNG, JPEG or WebP photo under 2 MB.",
    });
    return;
  }

  try {
    const user = await User.findByPk(userID, { attributes: ["userID"] });
    if (!user) {
      res.status(401).json({ success: false, message: "Please log in" });
      return;
    }

    const data = await generateProfilePresignedUrl(userID, fileType);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Profile photo upload:", error instanceof Error ? error.message : "Unknown error");
    res.status(500).json({
      success: false,
      message: "Unable to prepare photo upload. Please try again.",
    });
  }
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");

  const userID = req.session.userID;
  if (!userID) {
    res.status(401).json({ success: false, message: "Please log in" });
    return;
  }

  const { username, email, profileImage } = req.body ?? {};
  if (typeof username !== "string" || typeof email !== "string") {
    res.status(400).json({
      success: false,
      message: "Username and email are required",
    });
    return;
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (cleanUsername.length < 1 || cleanUsername.length > 50) {
    res.status(400).json({ success: false, message: "Username must be 1–50 characters" });
    return;
  }
  if (cleanEmail.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ success: false, message: "Invalid email address" });
    return;
  }

  // เก็บ URL ของรูปใน profile_image แทนข้อมูล Base64 ของไฟล์
  let cleanImage: string | null | undefined;
  if (profileImage !== undefined) {
    if (profileImage !== null && typeof profileImage !== "string") {
      res.status(400).json({ success: false, message: "Invalid profile image URL" });
      return;
    }

    cleanImage = typeof profileImage === "string" ? profileImage.trim() || null : null;
    if (cleanImage !== null) {
      try {
        const url = new URL(cleanImage);
        if (cleanImage.length > 255 || !["http:", "https:"].includes(url.protocol)) {
          throw new Error("Invalid image URL");
        }
      } catch {
        res.status(400).json({ success: false, message: "Invalid profile image URL" });
        return;
      }
    }
  }

  try {

    const user = await User.findByPk(userID, {
      attributes: ["userID", "username", "email", "profileImage"],
    });
    if (!user) {
      res.status(401).json({ success: false, message: "Please log in" });
      return;
    }

    const emailOwner = await User.findOne({
      where: { email: cleanEmail },
      attributes: ["userID"],
    });
    if (emailOwner && emailOwner.userID !== user.userID) {
      res.status(409).json({ success: false, message: "Email is already registered" });
      return;
    }

    if (cleanUsername !== user.username) {
      const usernameOwner = await User.findOne({
        where: { username: cleanUsername },
        attributes: ["userID"],
      });
      if (usernameOwner && usernameOwner.userID !== user.userID) {
        res.status(409).json({ success: false, message: "Username is already taken" });
        return;
      }
    }

    await user.update({
      username: cleanUsername,
      email: cleanEmail,
      ...(cleanImage !== undefined ? { profileImage: cleanImage } : {}),
    }, { fields: ["username", "email", "profileImage"] });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        userID: user.userID,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      res.status(409).json({ success: false, message: "Email is already registered" });
      return;
    }
    res.status(500).json({ success: false, message: "Unable to save profile. Please try again" });
  }
};
