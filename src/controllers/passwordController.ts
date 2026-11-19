import type { Request, Response } from "express";
import User from "../models/User.js";
import { hashPassWord, verifyPassword } from "../utils/password.js";

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const userID = req.session.userID;
  if (!userID) {
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
    // ใช้บัญชีจาก session เท่านั้น ไม่รับ userID จากฟอร์ม
    const user = await User.findByPk(userID, { attributes: ["userID", "password"] });
    if (!user) {
      res.status(401).json({ success: false, message: "Please log in" });
      return;
    }
    if (!await verifyPassword(user.password, currentPassword)) {
      res.status(400).json({ success: false, field: "currentPassword", message: "Current password is incorrect." });
      return;
    }

    const password = await hashPassWord(newPassword);
    // ป้องกันคำขอพร้อมกันเขียนทับรหัสที่เพิ่งเปลี่ยนไปแล้ว
    const [updated] = await User.update({ password }, {
      where: { userID, password: user.password },
      fields: ["password"],
    });
    if (updated !== 1) {
      res.status(409).json({ success: false, field: "currentPassword", message: "Your password has changed. Please enter your current password and try again." });
      return;
    }

    res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch {
    res.status(500).json({ success: false, message: "Unable to change password. Please try again." });
  }
};
