import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import DeviceDetector from "node-device-detector";
import { validationResult } from "express-validator";
import { body } from "express-validator";
import moment from "moment";
import { convertBigIntToString } from "../../config/convertBigIntToString.js";
import { v4 as uuidv4 } from 'uuid';
import dayjs from "dayjs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { subDays } from "date-fns";
import { sendTradeEmail } from "../EmailController.js";
const prisma = new PrismaClient();
const detector = new DeviceDetector();
export const registerValidation = [
    body("email")
        .notEmpty()
        .withMessage("Email is required")
        .isEmail()
        .withMessage("Invalid email format"),
    body("password")
        .notEmpty()
        .withMessage("Password is required")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters long")
        .custom((value) => {
        if (!/[A-Z]/.test(value))
            throw new Error("Password must contain an uppercase letter");
        if (!/[a-z]/.test(value))
            throw new Error("Password must contain a lowercase letter");
        if (!/[0-9]/.test(value))
            throw new Error("Password must contain a number");
        if (!/[!@#$%^&*(),.?\":{}|<>]/.test(value))
            throw new Error("Password must contain a special character");
        return true;
    }),
    body("referralCode").optional().isString(),
];
// Function to generate username and referral code
const generateUsernameAndReferralCode = async () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const username = `user${randomNum}`;
    const myReferralCode = `REF${randomNum}`;
    return { username, myReferralCode };
};
// Main Register Function
export const register = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: errors.array(),
            });
        }
        const { email, password, referralCode } = req.body;
        const settingData = await prisma.settings.findUnique({
            where: { setting_id: BigInt(1) },
        });
        if (!settingData) {
            return res.status(404).json({
                status: false,
                message: "Setting data not found.",
            });
        }
        if (settingData.user_registration === "disable") {
            return res.status(403).json({
                status: false,
                message: "User registration is temporarily disabled on this platform.",
            });
        }
        const existingUser = await prisma.users.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                status: false,
                message: "Email already exists.",
            });
        }
        const result = await prisma.$transaction(async (tx) => {
            const { username, myReferralCode } = await generateUsernameAndReferralCode();
            const hashedPassword = await bcrypt.hash(password, 10);
            const user = await tx.users.create({
                data: {
                    name: null,
                    username,
                    email,
                    password: hashedPassword,
                    my_referral_code: myReferralCode,
                    referral_code: referralCode || null,
                    user_level: 0,
                    login_with: "email",
                    login_status: "login",
                    login_count: 1,
                    last_login: new Date(),
                    user_status: "active",
                    created_at: new Date(),
                },
            });
            await tx.notifications.create({
                data: {
                    user_id: user.user_id,
                    title: "Signed up successfully.",
                    message: "Congratulations, You have just signed up. Welcome to our platform OnnBit.",
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()
                },
            });
            const ipAddress = req.headers["x-forwarded-for"] ||
                req.headers["cf-connecting-ip"] ||
                req.headers["x-real-ip"] ||
                req.ip;
            const deviceInfo = detector.detect(req.headers["user-agent"] || "");
            const clientInfo = deviceInfo.client || {};
            const osInfo = deviceInfo.os || {};
            const deviceName = deviceInfo.device?.type || null;
            const token = jwt.sign({ userId: user.user_id.toString() }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
            const tokenIds = await prisma.personal_access_tokens.create({
                data: {
                    tokenable_type: "users", // table name ya model
                    tokenable_id: BigInt(user.user_id),
                    name: "User Token",
                    token: token, // JWT jo generate kiya
                    abilities: "logIn_by:user",
                    created_at: new Date(),
                },
            });
            const loginDetail = await tx.user_login_details.create({
                data: {
                    user_id: user.user_id,
                    token_id: tokenIds.toString(), // ✅ Add this line
                    ip_address: ipAddress,
                    device_details: JSON.stringify({ clientInfo, osInfo, device: deviceName }),
                    device: deviceName,
                    browser: clientInfo.name || null,
                    os: osInfo.name || null,
                    os_version: osInfo.version || null,
                    login_status: "login",
                    logged_in_at: new Date(),
                },
            });
            return { user: convertBigIntToString(user), token };
        });
        const safeData = convertBigIntToString(result);
        return res.status(201).json({
            status: true,
            message: "User registered successfully",
            token: safeData.token,
            user: safeData.user,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: "Server error",
            errors: err.message,
        });
    }
};
export const login = async (req, res) => {
    const { username, password } = req.body;
    try {
        // ------------------------
        // VALIDATION
        // ------------------------
        if (!username || !password) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: {
                    username: "Username is required",
                    password: "Password is required",
                },
            });
        }
        // ------------------------
        // DETERMINE LOGIN FIELD
        // ------------------------
        const field = username.includes("@") ? "email" : "phone_number";
        // ------------------------
        // FIND USER
        // ------------------------
        const user = await prisma.users.findFirst({ where: { [field]: username } });
        if (!user) {
            return res.status(401).json({ status: false, message: "Invalid credentials" });
        }
        // ------------------------
        // CHECK PASSWORD
        // ------------------------
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ status: false, message: "Password Wrong" });
        }
        // ------------------------
        // CHECK USER STATUS
        // ------------------------
        if (!["active", "block", "terminate"].includes(user.user_status)) {
            return res.status(403).json({
                status: false,
                message: "Invalid user status. Please contact support.",
            });
        }
        if (user.user_status === "block") {
            return res.status(403).json({ status: false, message: "User is blocked. Please contact support." });
        }
        if (user.user_status === "terminate") {
            return res.status(403).json({ status: false, message: "User account is terminated." });
        }
        // ------------------------
        // ACTIVE USER LOGIN
        // ------------------------
        if (user.user_status === "active") {
            const ipAddress = req.headers["x-forwarded-for"] ||
                req.headers["cf-connecting-ip"] ||
                req.headers["x-real-ip"] ||
                req.ip;
            const detector = new DeviceDetector();
            const device = detector.parseOs(req.headers["user-agent"]);
            // ------------------------
            // UPDATE USER LOGIN INFO
            // ------------------------
            const updatedUser = await prisma.users.update({
                where: { user_id: BigInt(user.user_id) },
                data: {
                    login_with: field === "email" ? "email" : "phone",
                    login_status: "login",
                    login_count: user.login_count + 1,
                    last_login: new Date(),
                    logged_in_device: req.headers["user-agent"],
                    loggedIn_device_ip: ipAddress,
                },
            });
            // ------------------------
            // GENERATE TOKEN
            // ------------------------
            // Convert UUID to numeric hash
            // const tokenId = Array.from(uuidv4())
            //   .reduce((acc, char) => acc + char.charCodeAt(0), 0);
            // console.log(tokenId)
            const token = jwt.sign({
                userId: user.user_id.toString(),
            }, process.env.JWT_SECRET || "secret", { expiresIn: "7d" });
            // ------------------------
            // STORE LOGIN DETAILS
            // ------------------------
            const deviceData = {
                clientInfo: device.client || {},
                osInfo: device.os || {},
                device: device.device?.type || null,
                brand: device.device?.brand || null,
                model: device.device?.model || null,
            };
            const tokenIds = await prisma.personal_access_tokens.create({
                data: {
                    tokenable_type: "users", // table name ya model
                    tokenable_id: BigInt(user.user_id),
                    name: "User Token",
                    token: token, // JWT jo generate kiya
                    abilities: "logIn_by:user",
                    created_at: new Date(),
                },
            });
            const login = await prisma.user_login_details.create({
                data: {
                    user_id: BigInt(user.user_id),
                    token_id: tokenIds.id.toString(),
                    ip_address: ipAddress,
                    device_details: JSON.stringify(deviceData),
                    device: deviceData.device,
                    browser: deviceData.clientInfo?.name || null,
                    os: deviceData.osInfo?.name || null,
                    os_version: deviceData.osInfo?.version || null,
                    login_status: "login",
                    logged_in_at: new Date(),
                },
            });
            console.log("login", login);
            // ------------------------
            // KEEP LAST 10 LOGIN RECORDS
            // ------------------------
            const allLogins = await prisma.user_login_details.findMany({
                where: { user_id: BigInt(user.user_id) },
                orderBy: { login_details_id: "desc" },
                skip: 9,
                take: 1,
            });
            if (allLogins.length > 0) {
                const cutoffId = allLogins[0].login_details_id;
                await prisma.user_login_details.deleteMany({
                    where: { user_id: BigInt(user.user_id), login_details_id: { lt: cutoffId } },
                });
            }
            // ------------------------
            // TWO-FACTOR AUTH (2FA)
            // ------------------------
            if (user.two_factor_auth) {
                const otp = Math.floor(100000 + Math.random() * 900000);
                const existingOtp = await prisma.email_otps.findFirst({ where: { user_id: BigInt(user.user_id) } });
                if (existingOtp) {
                    await prisma.email_otps.update({
                        where: { otp_id: BigInt(existingOtp.otp_id) },
                        data: { otp, expires_at: dayjs().add(5, "minute").toDate() },
                    });
                }
                else {
                    await prisma.email_otps.create({
                        data: {
                            user_id: BigInt(user.user_id),
                            email: user.email,
                            otp,
                            expires_at: dayjs().add(5, "minute").toDate(),
                        },
                    });
                }
                console.log(`Send 2FA email to ${user.email} with OTP: ${otp}`);
            }
            await sendTradeEmail("SAFETY_TIPS", user.email, {
                user_name: user.username
            });
            // ------------------------
            // RETURN RESPONSE
            // ------------------------
            return res.status(200).json({
                status: true,
                message: "Login successful",
                token,
                twoFactorAuth: !!user.two_factor_auth,
                emailVerified: !!user.email_verified_at,
            });
        }
        return res.status(403).json({
            status: false,
            message: "User status is invalid. Please contact support.",
        });
    }
    catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({
            status: false,
            message: "An error occurred. Please try again.",
            errors: error.message,
        });
    }
};
export const updateTwoFA = async (req, res) => {
    try {
        // Logged-in user
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "User not found."
            });
        }
        // ===============================
        // Convert incoming value to real boolean
        // ===============================
        let two_fa = req.body.two_fa;
        if (two_fa === "true")
            two_fa = true;
        else if (two_fa === "false")
            two_fa = false;
        else if (typeof two_fa !== "boolean") {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { two_fa: ["two_fa must be boolean"] }
            });
        }
        // ===============================
        // DB Transaction
        // ===============================
        const result = await prisma.$transaction(async (tx) => {
            // Update user 2FA settings
            const updatedUser = await tx.users.update({
                where: { user_id: user.user_id },
                data: {
                    two_factor_auth: two_fa,
                    two_fa_otp_verified: two_fa
                }
            });
            // Update Login Details
            await tx.user_login_details.updateMany({
                where: { user_id: BigInt(user.user_id) },
                data: { two_fa_otp_verified: two_fa }
            });
            // Notification
            const notificationData = {
                user_id: user.user_id,
                title: two_fa ? "2FA Enabled." : "2FA Disabled.",
                message: two_fa
                    ? "Two Factor Authentication has been enabled."
                    : "Two Factor Authentication has been disabled.",
                type: "security",
                is_read: false,
                created_at: new Date()
            };
            const notification = await tx.notifications.create({ data: notificationData });
            io.to(notification.user_id.toString()).emit("new_notification", notification);
            return updatedUser;
        });
        return res.status(200).json({
            status: true,
            message: "Two-factor authentication updated successfully!!",
            data: {
                storedTwoFactorAuth: result.two_factor_auth,
                inputTwoFactorAuth: two_fa
            }
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to update two-factor authentication.",
            errors: err.message
        });
    }
};
export const updateTwoFaSet = async (req, res) => {
    const user = req.user;
    try {
        // VALIDATION
        const { twoFaValue, action } = req.body;
        const validTwoFaValues = ["buy", "sell"];
        const validActions = ["enable", "disable"];
        if (!validTwoFaValues.includes(twoFaValue)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { twoFaValue: ["twoFaValue must be buy or sell"] }
            });
        }
        if (!validActions.includes(action)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { action: ["action must be enable or disable"] }
            });
        }
        // ------------------------------------
        // PARSE existing DB value (string → array)
        let twoFaSet = [];
        if (user.two_fa_set) {
            try {
                twoFaSet = JSON.parse(user.two_fa_set); // <- FIX
            }
            catch (e) {
                twoFaSet = [];
            }
        }
        // ------------------------------------
        // SAME LOGIC
        const alreadyExists = twoFaSet.includes(twoFaValue);
        if ((alreadyExists && action === "enable") ||
            (!alreadyExists && action === "disable")) {
            return res.status(400).json({
                status: false,
                message: `Two-factor authentication already ${action === "enable" ? "enabled." : "disabled."}`
            });
        }
        if (action === "enable") {
            if (!alreadyExists)
                twoFaSet.push(twoFaValue);
        }
        else {
            twoFaSet = twoFaSet.filter(v => v !== twoFaValue);
        }
        // ------------------------------------
        // SAVE ARRAY AS STRING
        const updatedUser = await prisma.users.update({
            where: { user_id: BigInt(user.user_id) },
            data: {
                two_fa_set: JSON.stringify(twoFaSet) // <- FIX
            }
        });
        return res.status(200).json({
            status: true,
            message: "Two-factor authentication set updated successfully.",
            data: {
                twoFaSet,
                action
            }
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to update two-factor authentication set.",
            errors: error.message
        });
    }
};
export const sendResetLink = async (req, res) => {
    try {
        const { email } = req.body;
        // ------------------------
        // VALIDATION
        if (!email) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { email: ["Email is required"] },
            });
        }
        const user = await prisma.users.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({
                status: "not_found",
                message: "The provided email does not exist in our records.",
            });
        }
        // ------------------------
        // GENERATE TOKEN
        const token = crypto.randomBytes(32).toString("hex");
        // ------------------------
        // SAVE OR UPDATE TOKEN (PRIMARY KEY FIX)
        const existingToken = await prisma.password_reset_tokens.findUnique({
            where: { email },
        });
        if (existingToken) {
            await prisma.password_reset_tokens.update({
                where: { email },
                data: { token, created_at: new Date() },
            });
        }
        else {
            await prisma.password_reset_tokens.create({
                data: { email, token, created_at: new Date() },
            });
        }
        // ------------------------
        // SEND EMAIL
        const transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST,
            port: parseInt(process.env.MAIL_PORT),
            secure: process.env.MAIL_ENCRYPTION === "ssl", // tls ya ssl
            auth: {
                user: process.env.MAIL_USERNAME,
                pass: process.env.MAIL_PASSWORD,
            },
        });
        const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;
        await transporter.sendMail({
            from: process.env.MAIL_FROM_ADDRESS,
            to: user.email,
            subject: "Reset Your Password",
            html: `
        <p>Hello ${user.name || ""},</p>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>If you didn't request a password reset, please ignore this email.</p>
      `,
        });
        return res.status(200).json({
            status: true,
            message: "Password reset link sent to your email.",
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong. Please try again later.",
            errors: error.message,
        });
    }
};
export const resetPassword = async (req, res) => {
    try {
        const { email, token, password } = req.body;
        // ------------------------
        // VALIDATION
        if (!email || !token || !password) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: {
                    email: !email ? ["Email is required"] : undefined,
                    token: !token ? ["Token is required"] : undefined,
                    password: !password ? ["Password is required"] : undefined,
                },
            });
        }
        // Password rules check
        if (!/[A-Z]/.test(password))
            return res.status(422).json({ status: false, message: "Password must contain at least one uppercase letter." });
        if (!/[a-z]/.test(password))
            return res.status(422).json({ status: false, message: "Password must contain at least one lowercase letter." });
        if (!/[0-9]/.test(password))
            return res.status(422).json({ status: false, message: "Password must contain at least one number." });
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
            return res.status(422).json({ status: false, message: "Password must contain at least one special character." });
        // ------------------------
        // FETCH TOKEN DATA
        const tokenData = await prisma.password_reset_tokens.findUnique({
            where: { email },
        });
        if (!tokenData) {
            return res.status(400).json({
                status: "failed",
                message: "Invalid email or token.",
            });
        }
        // ------------------------
        // TOKEN EXPIRY CHECK (60 minutes)
        const tokenCreatedTime = new Date(tokenData.created_at);
        const expiresAt = new Date(tokenCreatedTime.getTime() + 60 * 60 * 1000); // 60 mins
        if (new Date() > expiresAt) {
            return res.status(400).json({
                status: "failed",
                message: "Token has expired.",
            });
        }
        // ------------------------
        // TOKEN MATCH CHECK
        console.log(tokenData.token);
        if (token !== tokenData.token) {
            return res.status(400).json({
                status: "failed",
                message: "The password reset token is invalid.",
            });
        }
        // ------------------------
        // FETCH USER
        const user = await prisma.users.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({
                status: "Unauthorized",
                message: "User not found.",
            });
        }
        // ------------------------
        // UPDATE PASSWORD
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.users.update({
            where: { email },
            data: { password: hashedPassword },
        });
        // OPTIONAL: send notification
        // await sendNotification({
        //   userId: user.user_id,
        //   title: "Password reset successfully.",
        //   message: "Your password has been successfully reset. If you did not perform this action, please secure your account immediately.",
        //   type: "account_activity",
        //   isRead: false,
        // });
        // ------------------------
        // DELETE USED TOKEN
        await prisma.password_reset_tokens.delete({ where: { email } });
        return res.status(200).json({
            status: true,
            message: "Password reset successfully.",
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: error.message,
        });
    }
};
export const passwordVerification = async (req, res) => {
    const user = req.user; // assuming auth middleware sets req.user
    if (!user) {
        return res.status(401).json({
            status: "unauthorized",
            message: "User not authenticated",
        });
    }
    try {
        const { password } = req.body;
        console.log("Received password:", password);
        // -------------------
        // VALIDATION
        if (!password || typeof password !== "string") {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { password: ["Password is required and must be a string"] },
            });
        }
        // -------------------
        // CHECK PASSWORD
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(200).json({
                status: true,
                message: "Password is incorrect",
                passwordVerified: false,
            });
        }
        // -------------------
        // SUCCESS
        return res.status(200).json({
            status: true,
            message: "Password verified successfully.",
            passwordVerified: true,
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: error.message,
        });
    }
};
export const logout = async (req, res) => {
    const user = req.user; // Auth middleware sets req.user
    if (!user) {
        return res.status(401).json({
            status: "unauthorized",
            message: "User not authenticated",
        });
    }
    try {
        await prisma.$transaction(async (tx) => {
            // ------------------------
            // FIND CURRENT TOKEN
            // ------------------------
            const tokenId = user.tokenId;
            // ------------------------
            // DELETE CURRENT TOKEN
            // ------------------------
            const exists = await tx.personal_access_tokens.findUnique({
                where: { id: BigInt(tokenId) }
            });
            if (!exists) {
                throw new Error("Token record not found in personal_access_tokens table");
            }
            await tx.personal_access_tokens.delete({
                where: { id: BigInt(tokenId) }
            });
            // ------------------------
            // UPDATE LOGIN DETAILS
            // ------------------------
            const loginDetail = await tx.user_login_details.updateMany({
                where: { user_id: BigInt(user.user_id), token_id: tokenId },
                data: { login_status: "logout", two_fa_otp_verified: false },
            });
            // ------------------------
            // CHECK ACTIVE TOKENS IN LAST 7 DAYS
            // ------------------------
            const hasActiveTokens = await tx.personal_access_tokens.findFirst({
                where: {
                    tokenable_type: "users",
                    tokenable_id: BigInt(user.user_id),
                    created_at: { gte: subDays(new Date(), 7) },
                },
            });
            if (!hasActiveTokens) {
                // UPDATE USER STATUS IF NO ACTIVE TOKENS
                await tx.users.update({
                    where: { user_id: BigInt(user.user_id) },
                    data: { login_status: "logout", two_fa_otp_verified: false,  last_seen: new Date()},
                });
            }
            // ------------------------
            // SUCCESS RESPONSE
            // ------------------------
            return res.status(200).json({
                status: true,
                message: "Successfully logged out",
            });
        });
    }
    catch (error) {
        return res.status(error.status || 500).json({
            status: false,
            message: error.message || "Something went wrong.",
            errors: error.message,
        });
    }
};
export const logoutFromOtherToken = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "User not found"
            });
        }
        const currentTokenId = user.tokenId; // must be provided by your auth middleware
        await prisma.$transaction(async (tx) => {
            // find other tokens
            const otherTokens = await tx.personal_access_tokens.findMany({
                where: {
                    tokenable_id: user.user_id,
                    id: { not: currentTokenId }
                }
            });
            if (!otherTokens.length) {
                throw new Error("There are no other active tokens available except the current one.");
            }
            // delete all other tokens except current token
            await tx.personal_access_tokens.deleteMany({
                where: {
                    tokenable_id: user.user_id,
                    id: { not: currentTokenId }
                }
            });
            // update user login details for those tokens
            await tx.user_login_details.updateMany({
                where: {
                    user_id: user.user_id,
                    token_id: { not: String(currentTokenId) },
                    updated_at: new Date()
                    // convert to string if field is varchar
                },
                data: {
                    login_status: "logout",
                    two_fa_otp_verified: false
                }
            });
        });
        return res.status(200).json({
            status: true,
            message: "Successfully logout from all the tokens except current one."
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: error.message
        });
    }
};
export const addNumber = async (req, res) => {
    let tx;
    try {
        const user = req.user; // from auth middleware
        // ---------------- Email Verification Check ----------------
        if (!user.email_verified_at) {
            return res.status(403).json({
                status: false,
                message: "Please verify email before adding phone number.",
            });
        }
        // ---------------- Validation ----------------
        const { dialing_code, phone_number, verified } = req.body;
        const errors = {};
        // dialing_code validation
        if (!dialing_code) {
            errors.dialing_code = ["dialing_code is required"];
        }
        else if (!/^\+\d{1,4}$/.test(dialing_code)) {
            errors.dialing_code = ["dialing_code must be like +91, +1, +44"];
        }
        // phone_number validation
        if (!phone_number) {
            errors.phone_number = ["phone_number is required"];
        }
        else if (!/^[1-9]\d{4,14}$/.test(phone_number)) {
            errors.phone_number = [
                "phone_number must be numeric and between 5 to 15 digits",
            ];
        }
        else {
            const exists = await prisma.users.findFirst({
                where: {
                    phone_number,
                    NOT: { user_id: user.user_id },
                },
            });
            if (exists) {
                errors.phone_number = ["phone_number already exists"];
            }
        }
        // verified validation
        const verifiedBool = verified === true || verified === "true" || verified === 1 || verified === "1";
        if (verifiedBool === null || verifiedBool === undefined) {
            errors.verified = ["verified must be boolean"];
        }
        if (Object.keys(errors).length > 0) {
            return res.status(422).json({
                status: false,
                message: "validation failed.",
                errors,
            });
        }
        if (!verifiedBool) {
            return res.status(422).json({
                status: false,
                message: "Verify phone number first",
            });
        }
        // ---------------- Transaction Start ----------------
        await prisma.$transaction(async (tx) => {
            const operation = user.phone_number ? "update" : "add";
            await tx.users.update({
                where: { user_id: user.user_id },
                data: {
                    dialing_code,
                    phone_number,
                    number_verified_at: new Date(),
                    user_level: user.email_verified_at && user.id_verified_at ? 1 : user.user_level,
                },
            });
            // Add notification
            const notification = await tx.notifications.create({
                data: {
                    user_id: user.user_id,
                    title: "Phone number added successfully.",
                    message: "Congractulations, You have just added and verified your phone number.",
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()
                },
            });
            io.to(notification.user_id.toString()).emit("new_notification", notification);
            res.status(operation === "add" ? 201 : 200).json({
                status: true,
                message: `Phone Number ${operation === "add" ? "added" : "updated"} successfully`,
            });
        });
    }
    catch (err) {
        console.log("addNumber ERROR:: ", err);
        return res.status(500).json({
            status: false,
            message: "Unable to add/update phone number.",
            errors: err.message,
        });
    }
};
2;
