import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import prisma from "../config/db.js";
import { hashPassWord, verifyPassword } from "../utils/password.js";
import { uploadProfilePhoto } from "../services/profileR2Service.js";

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body ?? {};
    // ตรวจชนิดข้อมูล
    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      res.status(400).json({
        success: false,
        message: "Username, email and password are required",
      });
      return;
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
  // ตรวจข้อมูลในฐานข้อมูล
    if (cleanUsername.length < 1 || cleanUsername.length > 50) {
      res.status(400).json({
        success: false,
        message: "Username must be 1–50 characters",
      });
      return;
    }

    if (
      cleanEmail.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
      return;
    }

    const passwordLength = [...password].length;

    if (passwordLength < 10 || passwordLength > 128) {
      res.status(400).json({
        success: false,
        message: "Password must be 10–128 characters",
      });
      return;
    }
    // ตรวจอีเมลซ้ำ
    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
      select: { userId: true },
    });

    if (existingUser) {
      res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
      return;
    }
    // Hash พร้อม salt ก่อนบันทึก
    const hashedPassword = await hashPassWord(password);
    // บันทึกผู้ใช้ลงตาราง user
    const values = {
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      profileImage: null,
    };

    const photo = req.file;
    const user = photo
      ? await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({ data: values });
          const profileImage = await uploadProfilePhoto(
            created.userId,
            photo.mimetype,
            photo.buffer,
          );
          return tx.user.update({
            where: { userId: created.userId },
            data: { profileImage },
          });
        })
      : await prisma.user.create({ data: values });
    // ส่งเฉพาะข้อมูลที่ต้องใช้กลับไป
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  } catch (error) {
    // รองรับคำขอสมัครอีเมลเดียวกันที่เข้ามาพร้อมกัน
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
      return;
    }

    console.error("Registration failed:", error instanceof Error ? error.message : "Unknown error");
    res.status(500).json({
      success: false,
      message: "Unable to register. Please try again",
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    // รองรับ username/email และคำขอเดิมที่ส่ง email มา
    const identifier = req.body?.identifier ?? req.body?.email;
    const password = req.body?.password;

    if (typeof identifier !== "string" || typeof password !== "string") {
      res.status(400).json({
        success: false,
        message: "Username or email and password are required",
      });
      return;
    }

    const cleanIdentifier = identifier.trim();
    const passwordLength = [...password].length;

    if (
      !cleanIdentifier ||
      cleanIdentifier.length > 100 ||
      passwordLength < 1 ||
      passwordLength > 128
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid username/email or password input",
      });
      return;
    }
    // ตรวจอีเมลก่อน เพราะอีเมลระบุบัญชีได้ไม่ซ้ำกัน
    let user = await prisma.user.findUnique({
      where: { email: cleanIdentifier.toLowerCase() },
    });
    // ถ้าไม่พบอีเมล ให้ค้นหา username โดยไม่เลือกบัญชีที่ชื่อซ้ำ
    if (!user) {
      const matches = await prisma.user.findMany({
        where: { username: cleanIdentifier },
        take: 2,
      });

      if (matches.length === 1) {
        user = matches[0] ?? null;
      }
    }

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Username/email or password is incorrect",
      });
      return;
    }
    // ตรวจรหัสผ่านกับ hash ที่เก็บไว้
    const isPasswordValid = await verifyPassword(user.password, password);

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: "Username/email or password is incorrect",
      });
      return;
    }
    // สร้าง session ID ใหม่
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    // เก็บ ID ผู้ใช้ไว้ใน session
    req.session.userID = user.userId;

    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    // ส่งข้อมูลผู้ใช้กลับไป
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Unable to log in. Please try again",
    });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");

  try {
    // อ่าน ID จาก session ที่ Backend เก็บไว้
    const userId = req.session.userID;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Please log in",
      });
      return;
    }

    // อ่านข้อมูลล่าสุด โดยไม่ดึง password
    const user = await prisma.user.findUnique({
      where: { userId },
      select: {
        userId: true,
        username: true,
        email: true,
        profileImage: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Please log in",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Unable to fetch current user",
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");

  try {
    // ลบ session ฝั่ง Backend
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    // สั่งให้เบราว์เซอร์ลบ cookie ชื่อเดียวกับใน server.ts
    res.clearCookie("animal-spotting.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Unable to log out. Please try again",
    });
  }
};