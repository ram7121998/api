import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import nodemailer from "nodemailer";
import { validationResult, body } from "express-validator";
import axios from "axios";
const prisma = new PrismaClient();
export const verifyEmailOtp = async (req, res) => {
    const user = req.user;
    let { otp, operation } = req.body;
    try {
        // ✅ Default value
        operation = operation || "email_verification";
        // ✅ Validation
        if (!otp) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { otp: "OTP is required" },
            });
        }
        if (!["email_verification", "two_fa", "login", "two_fa_disable"].includes(operation)) {
            return res.status(422).json({
                status: false,
                message: "Invalid operation type",
            });
        }
        console.log(otp, user.user_id);
        // ✅ Start transaction
        const result = await prisma.$transaction(async (tx) => {
            // ✅ Find OTP record
            const otpRecord = await tx.email_otps.findFirst({
                where: {
                    user_id: user.user_id,
                    otp: parseInt(otp),
                },
            });
            if (!otpRecord) {
                throw new Error("Invalid OTP");
            }
            // ✅ Check expiry
            if (dayjs(otpRecord.expires_at).isBefore(dayjs())) {
                throw new Error("OTP has expired");
            }
            console.log("otpRecord", otpRecord);
            // ✅ Delete OTP record after success
            await tx.email_otps.delete({
                where: { otp_id: otpRecord.otp_id }
            });
            // ✅ Handle operation
            switch (operation) {
                case "two_fa":
                    // You can add extra logic for enabling 2FA if needed
                    break;
                case "two_fa_disable":
                    // Handle disabling 2FA flow here if needed
                    break;
                case "login":
                    await tx.users.update({
                        where: { user_id: user.user_id },
                        data: { two_fa_otp_verified: true },
                    });
                    // If you store token_id in user_login_details
                    if (req.tokenId) {
                        await tx.user_login_details.updateMany({
                            where: {
                                user_id: user.user_id,
                                token_id: req.tokenId,
                            },
                            data: { two_fa_otp_verified: true },
                        });
                    }
                    break;
                case "email_verification":
                    const userRecord = await tx.users.findUnique({
                        where: { user_id: user.user_id },
                    });
                    const updateData = {
                        email_verified_at: new Date(),
                    };
                    // ✅ Update user level if all verified
                    if (userRecord.number_verified_at && userRecord.id_verified_at) {
                        updateData.user_level = 1;
                    }
                    await tx.users.update({
                        where: { user_id: user.user_id },
                        data: updateData,
                    });
                    // ✅ Add notification record
                    const notification = await tx.notifications.create({
                        data: {
                            user_id: user.user_id,
                            title: "Email verified successfully.",
                            message: "Congratulations, You have just confirmed your email.",
                            type: "account_activity",
                            is_read: false,
                            created_at: new Date()
                        },
                    });
                    io.to(notification.user_id.toString()).emit("new_notification", notification);
                    break;
            }
            return true;
        });
        if (result) {
            return res.status(200).json({
                status: true,
                message: "Email OTP verified successfully!",
            });
        }
    }
    catch (error) {
        console.error("verifyEmailOtp error:", error);
        if (error.message === "Invalid OTP" || error.message === "OTP has expired") {
            return res.status(400).json({
                status: false,
                message: error.message,
            });
        }
        return res.status(500).json({
            status: false,
            message: "Unable to verify email OTP.",
            errors: error.message,
        });
    }
};
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    secure: false,
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
    },
});
export const sendEmailOtp = async (req, res) => {
    const user = req.user;
    try {
        req.body.operation = req.body.operation?.toLowerCase() || "email_verification";
        const allowedOperations = ["email_verification", "two_fa", "login", "two_fa_disable"];
        if (!allowedOperations.includes(req.body.operation)) {
            return res.status(400).json({
                status: false,
                message: "Invalid operation",
            });
        }
        if (req.body.operation === "two_fa") {
            if (!["buy", "sell"].includes(req.body.operation_type)) {
                return res.status(400).json({
                    status: false,
                    message: "operation_type must be buy or sell",
                });
            }
        }
        const user_id = user.user_id;
        const email = user.email;
        let customMessage = "";
        let customSubject = "";
        switch (req.body.operation) {
            case "two_fa":
                customMessage = `We received a request to initiate a ${req.body.operation_type} trade.\n\nUse this OTP:\n\n`;
                customSubject = "Your OTP for Trade Verification";
                break;
            case "two_fa_disable":
                customMessage = `We received a request to disable 2FA.\n\nUse this OTP:\n\n`;
                customSubject = "OTP to Disable Two-Factor Authentication (2FA)";
                break;
            case "login":
                customMessage = `We noticed a login attempt.\n\nUse this OTP:\n\n`;
                customSubject = "OnnBit Login Verification Code (2FA)";
                break;
            case "email_verification":
                if (user.email_verified_at) {
                    return res.status(400).json({
                        status: true,
                        message: "Email is already verified.",
                    });
                }
                customMessage = `Thank you for registering with OnnBit!\n\nUse this OTP:\n\n`;
                customSubject = "Verify Your Email";
                break;
        }
        const otp = Math.floor(100000 + Math.random() * 900000);
        await prisma.$transaction(async (tx) => {
            const existingOtp = await tx.email_otps.findFirst({
                where: { user_id },
            });
            if (existingOtp) {
                await tx.email_otps.update({
                    where: { email: existingOtp.email }, // ← FIXED
                    data: {
                        otp,
                        expires_at: dayjs().add(5, "minute").toISOString(),
                    },
                });
            }
            else {
                await tx.email_otps.create({
                    data: {
                        user_id,
                        email,
                        otp,
                        expires_at: dayjs().add(5, "minute").toISOString(),
                    },
                });
            }
        });
        await transporter.sendMail({
            to: email,
            subject: customSubject,
            text: `Hello ${user.name},\n\n${customMessage}🔐 OTP: ${otp}\n\nThis OTP expires in 5 minutes.\n\nThank you,\nOnnBit Team`,
        });
        return res.status(200).json({
            status: true,
            message: "OTP sent successfully!",
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "An error occurred. Please try again.",
            errors: error.message,
        });
    }
};
export const validateSendSmsOtp = [
    body("phone_number")
        .notEmpty().withMessage("phone_number is required")
        .matches(/^\+?[1-9]\d{1,14}$/).withMessage("Invalid phone number format"),
    body("country_code")
        .notEmpty().withMessage("country_code is required")
        .isString(),
    // body("recaptcha_token").notEmpty().withMessage("recaptcha_token required"),
];
// ===============================
// CONTROLLER FUNCTION
// ===============================
export const sendSmsOTP = async (req, res) => {
    try {
        // Validate fields
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: "Invalid phone number format.",
                errors: errors.array(),
            });
        }
        const { phone_number, country_code } = req.body;
        const phone = country_code + phone_number;
        const firebaseApiKey = process.env.FIREBASE_API_KEY;
        const url = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/sendVerificationCode?key=${firebaseApiKey}`;
        // ===============================
        // FIREBASE API CALL
        // ===============================
        const response = await axios.post(url, {
            phoneNumber: phone,
            // clientType: "CLIENT_TYPE_WEB",
            // recaptchaToken: req.body.recaptcha_token,
        });
        return res.status(200).json({
            status: true,
            message: "OTP sent successfully.",
            data: response.data,
        });
    }
    catch (err) {
        console.error("Firebase OTP Error:", err?.response?.data || err.message);
        return res.status(500).json({
            status: false,
            message: "Failed to send OTP.",
            error: err?.response?.data || err.message,
        });
    }
};
