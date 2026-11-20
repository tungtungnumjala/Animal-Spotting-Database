import type { Request, Response } from "express";
import prisma from "../config/db.js";
import { hashPassWord, verifyPassword } from "../utils/password.js";

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const userId = req.session.userID;
  if (!userId) {
    res.status(401).json({ success: false, message: "Please log in" });
    return;
  }

  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || [...currentPassword].length < 1 || [...currentPassword].length > 128) {
    res.status(400).json({ success: false, field: "currentPassword", message: "Enter your current password (1–128 characters)." });
    return;
  }
  if (typeof newPassword !== "string" || [...newPassword].length < 10 || [...newPassword].length > 128) {
    res.status(400).json({ success: false, field: "newPassword", message: "New password must be 10–128 characters." });
    return;
  }
  if (typeof confirmPassword !== "string" || confirmPassword !== newPassword) {
    res.status(400).json({ success: false, field: "confirmPassword", message: "Passwords do not match." });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ success: false, field: "newPassword", message: "Choose a password different from your current password." });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { userId },
      select: { userId: true, password: true },
    });
    if (!user) {
      res.status(401).json({ success: false, message: "Please log in" });
      return;
    }
    if (!await verifyPassword(user.password, currentPassword)) {
      res.status(400).json({ success: false, field: "currentPassword", message: "Current password is incorrect." });
      return;
    }

    const password = await hashPassWord(newPassword);
    // ใช้ updateMany เพื่อเช็กเงื่อนไข password เดิมป้องกัน race condition แบบเดียวกับ Sequelize
    const result = await prisma.user.updateMany({
      where: { userId, password: user.password },
      data: { password },
    });

    if (result.count !== 1) {
      res.status(409).json({ success: false, field: "currentPassword", message: "Your password has changed. Please enter your current password and try again." });
      return;
    }

    res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch {
    res.status(500).json({ success: false, message: "Unable to change password. Please try again." });
  }
};