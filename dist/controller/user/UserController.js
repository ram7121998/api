import express from "express";
import prisma from "../../config/prismaClient.js";
import moment from "moment";
import axios from "axios";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";
import path from "path";
// Controller function
export const userDetail = async (req, res) => {
    try {
        let userId;
        let user;
        if (req.user && req.user.user_id) {
            userId = req.user.user_id;
            user = await prisma.users.findUnique({ where: { user_id: BigInt(userId) } });
        }
        if (req.query.user_id && req.query.user_id.trim() !== "") {
            userId = req.query.user_id;
            user = await prisma.users.findUnique({ where: { user_id: BigInt(userId) } });
        }
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "User not found",
            });
        }
        const userDetails = getUserDetails(user);
        const [totalLikes, totalDislikes] = await Promise.all([
            prisma.feedback.count({
                where: { user_id: BigInt(userId), like: true },
            }),
            prisma.feedback.count({
                where: { user_id: BigInt(userId), dislike: true },
            }),
        ]);
        res.status(200).json({
            status: true,
            response: {
                ...userDetails,
                feedback: {
                    total_likes: totalLikes,
                    total_dislikes: totalDislikes,
                },
            },
        });
        if (user.country !== userDetails.country?.toLowerCase()) {
            prisma.users.update({
                where: { user_id: BigInt(userId) },
                data: { country: userDetails.country.toLowerCase() },
            }).catch(err => console.error("Country update failed:", err));
        }
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to fetch user's details",
            errors: error.message,
        });
    }
};
// Example getUserDetails function
// async function getUserDetails(user, includeSensitive = false) {
//     const cleanedUser = JSON.parse(JSON.stringify(user, (_, value) => typeof value === "bigint" ? value.toString() : value));
//     // Remove sensitive fields if needed
//     delete cleanedUser.password;
//     delete cleanedUser.remember_token;
//     return cleanedUser;
// }
export function getUserDetails(user) {
    return {
        user_id: user.user_id,
        name: user.name,
        username: user.username,
        username_changed: user.username_changed,
        email: user.email,
        dialing_code: user.dialing_code,
        phone_number: user.phone_number,
        email_verified: user.email_verified,
        phone_verified: user.phone_verified,
        id_verified: user.id_verified,
        address_verified: user.address_verified,
        twoFactorAuth: user.twoFactorAuth,
        profile_image: user.profile_image,
        country: user.country,
        country_code: user.country_code,
        city: user.city,
        country_flag_url: user.country_flag_url,
        preferred_currency: user.preferred_currency,
        preferred_timezone: user.preferred_timezone,
        bio: user.bio,
        display_name_preference: user.display_name_preference,
        login_with: user.login_with,
        login_status: user.login_status,
        last_login: user.last_login,
             last_seen_at: user.last_seen
                        ? dayjs(user.last_seen).fromNow()
                        : "online",
        last_login_duration: user.last_login_duration,
        user_status: user.user_status
    };
}
export const getReferralLink = async (req, res) => {
    try {
        const userId = req.user?.user_id;
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: "User not found",
            });
        }
        // Fetch user from Prisma
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(userId) }
        });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "User not found",
            });
        }
        const referralCode = user.my_referral_code;
        const referralLink = `http://localhost:5173/signup?refer=${referralCode}`;
        return res.status(200).json({
            status: true,
            message: "Referral link generated successfully",
            referralLink: referralLink,
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to generate referral link",
            errors: error.message,
        });
    }
};
export const loginHistory = async (req, res) => {
    try {
        const userId = req.user?.user_id;
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: "User not found.",
            });
        }
        // Fetch user
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(userId) },
        });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "User not found.",
            });
        }
        // Fetch login history
        const loginDetails = await prisma.user_login_details.findMany({
            where: { user_id: BigInt(userId) },
            orderBy: { logged_in_at: "desc" },
        });
        if (!loginDetails || loginDetails.length === 0) {
            return res.status(404).json({
                status: false,
                message: "User's login history were not found.",
            });
        }
        const timezone = user.preferred_timezone || "Asia/Kolkata";
        const requiredData = await Promise.all(loginDetails.map(async (loginHistory) => {
            const loginAt = moment(loginHistory.logged_in_at)
                .tz(timezone)
                .format("YYYY-MM-DD hh:mm A");
            const loginDuration = moment(loginHistory.logged_in_at)
                .tz(timezone)
                .fromNow();
            // Get location from IP
            let countryData = {};
            try {
                const response = await axios.get(`http://ip-api.com/json/${loginHistory.ip_address}`);
                countryData = response.data || {};
            }
            catch (err) {
                countryData = {};
            }
            // Check if this session/token is current
            const isCurrent = loginHistory.token_id === req.user?.token_id;
            return {
                loginDetailsId: loginHistory.login_details_id.toString(),
                ipAddress: loginHistory.ip_address,
                deviceDetails: loginHistory.device_details,
                device: loginHistory.device,
                browser: loginHistory.browser,
                os: loginHistory.os,
                osVersion: loginHistory.os_version,
                loginStatus: loginHistory.login_status,
                loginAt,
                loginDuration,
                countryName: countryData.country || "N/A",
                countryCity: countryData.city || "N/A",
                current: isCurrent,
            };
        }));
        return res.status(200).json({
            status: true,
            message: "Login Details found successfully.",
            data: requiredData,
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong",
            errors: error.message,
        });
    }
};
// Controller
export const updateUsername = async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: errors.array(),
            });
        }
        const { username } = req.body;
        const userId = req.user.user_id; // your auth middleware should set user.user_id
        // Fetch user
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(userId) },
        });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "User not found",
            });
        }
        if (user.username_changed) {
            return res.status(422).json({
                status: false,
                message: "You have already changed your username.",
            });
        }
        // Check if username already exists
        const existingUser = await prisma.users.findFirst({
            where: { username },
        });
        if (existingUser) {
            return res.status(422).json({
                status: false,
                message: "Username already taken",
            });
        }
        // Update username
        const updatedUser = await prisma.users.update({
            where: { user_id: userId },
            data: {
                username,
                username_changed: true,
            },
        });
        return res.status(200).json({
            status: true,
            message: "Username updated successfully!",
            username: updatedUser.username,
            username_changed: updatedUser.username_changed,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: "Unable to update username",
            errors: err.message,
        });
    }
};
// Controller
export const changePassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: "validation failed",
            errors: errors.array(),
        });
    }
    const { current_password, new_password } = req.body;
    const userId = req.user.user_id; // set from auth middleware
    try {
        // Fetch user
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(userId) },
        });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "User not found",
            });
        }
        // Check current password
        const isCurrentPasswordValid = await bcrypt.compare(current_password, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(422).json({
                status: false,
                message: "Invalid current password",
            });
        }
        // Check if new password is same as current
        const isSameAsCurrent = await bcrypt.compare(new_password, user.password);
        if (isSameAsCurrent) {
            return res.status(422).json({
                status: false,
                message: "The new password cannot be the same as the current password",
            });
        }
        // Hash new password
        const hashedPassword = await bcrypt.hash(new_password, 10);
        // Use transaction for password update + notification
        await prisma.$transaction(async (prismaTx) => {
            // Update user password
            await prismaTx.users.update({
                where: { user_id: userId },
                data: { password: hashedPassword },
            });
            // Create notification
            const notification = await prismaTx.notifications.create({
                data: {
                    user_id: userId,
                    title: "Password changed successfully.",
                    message: "You have successfully changed your password.",
                    type: "security",
                    is_read: false,
                    created_at: new Date()
                },
            });
            io.to(notification.user_id.toString()).emit("new_notification", notification);
        });
        return res.status(200).json({
            status: true,
            message: "Password changed successfully!",
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: "Unable to update password",
            errors: err.message,
        });
    }
};
export const updateBio = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: "Validation failed",
            errors: errors.array(),
        });
    }
    const { bio } = req.body;
    const userId = req.user.user_id; // set by your auth middleware
    try {
        // Check line count (max 3 lines)
        const lines = bio.trim().split(/\r\n|\r|\n/);
        if (lines.length > 3) {
            return res.status(422).json({
                status: false,
                message: "Bio should not be more than 3 lines.",
            });
        }
        // Update bio in a transaction (optional, but keeps consistent with Laravel DB::transaction)
        await prisma.$transaction(async (tx) => {
            await tx.users.update({
                where: { user_id: BigInt(userId) },
                data: { bio },
            });
        });
        return res.status(200).json({
            status: true,
            message: "Bio updated successfully!",
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: "Unable to update bio.",
            errors: err.message,
        });
    }
};
export const securityQuestion = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            status: false,
            message: "Validation failed",
            errors: errors.array(),
        });
    }
    const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
    const userId = req.user.user_id;
    let operation = "create";
    try {
        const questionOrders = questions.map((q) => q.question_order);
        if (new Set(questionOrders).size !== questionOrders.length) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { question_order: ["Each question order must be unique."] },
            });
        }
        const questionTexts = questions.map((q) => q.question.toLowerCase().trim());
        if (new Set(questionTexts).size !== questionTexts.length) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { question: ["Each question must be unique."] },
            });
        }
        await prisma.$transaction(async (tx) => {
            const existing = await tx.security_questions.findMany({ where: { user_id: userId } });
            if (existing.length) {
                operation = "update";
                await tx.security_questions.deleteMany({ where: { user_id: userId } });
            }
            for (const q of questions) {
                await tx.security_questions.create({
                    data: {
                        user_id: userId,
                        question_order: q.question_order,
                        question: q.question,
                        answer: q.answer,
                    },
                });
            }
            const notification = await tx.notifications.create({
                data: {
                    user_id: userId,
                    title: "Security questions updated successfully.",
                    message: "You have successfully updated your security questions.",
                    type: "security",
                    is_read: false,
                    created_at: new Date()
                },
            });
            io.to(notification.user_id.toString()).emit("new_notification", notification);
        });
        return res.status(operation === "update" ? 200 : 201).json({
            status: true,
            message: `Security questions ${operation}d successfully.`,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: `Unable to ${operation} security question`,
            errors: [err.message],
        });
    }
};
export const getSecurityQuestion = async (req, res) => {
    try {
        const userId = req.user.user_id; // assuming auth middleware sets req.user
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: "User not found",
            });
        }
        const securityQuestions = await prisma.security_questions.findMany({
            where: { user_id: BigInt(userId) },
            orderBy: { question_order: "asc" },
            select: {
                question_order: true,
                question: true,
                answer: true,
            },
        });
        if (!securityQuestions || securityQuestions.length === 0) {
            return res.status(200).json({
                status: true,
                message: "There are no security questions added.",
            });
        }
        return res.status(200).json({
            status: true,
            message: "Security questions fetched successfully",
            security_question: securityQuestions,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: "Unable to retrieve security questions",
            errors: [err.message], // wrap in array to ensure valid JSON
        });
    }
};
export const updateProfileImage = async (req, res) => {
    const imageFile = req.file;
    const user = req.user; // Auth middleware must populate
    if (!user) {
        return res.status(401).json({ status: "unauthorized", message: "User not found." });
    }
    if (!imageFile) {
        return res.status(422).json({
            status: false,
            message: "Validation failed",
            errors: { profile_image: "Profile image is required" },
        });
    }
    try {
        // Delete old image if exists
        if (user.profile_image && !user.profile_image.startsWith("http")) {
            const oldPath = path.join("storage", user.profile_image);
            if (fs.existsSync(oldPath))
                fs.unlinkSync(oldPath);
        }
        // Store only relative path
        // Save relative path
        const relativePath = path.join("images", "profile_image", imageFile.filename).replace(/\\/g, "/");
        // Build URL
        const profileImageUrl = `${req.protocol}://${req.get("host")}/storage/${relativePath}`;
        // Update user in database
        const updatedUser = await prisma.users.update({
            where: { user_id: user.user_id },
            data: { profile_image: profileImageUrl },
        });
        return res.status(200).json({
            status: true,
            message: "Profile image updated successfully.",
            profile_image_url: profileImageUrl,
        });
    }
    catch (error) {
        console.error("Error updating profile image:", error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong. Please try again later!",
            errors: error.message,
        });
    }
};
export const preferredCurrency = async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: errors.array(),
            });
        }
        const user = req.user; // Populated by your authenticateUser middleware
        const { preferred_currency } = req.body;
        // Update user's preferred currency
        const updatedUser = await prisma.users.update({
            where: { user_id: BigInt(user.user_id) },
            data: { preferred_currency },
        });
        return res.status(200).json({
            status: true,
            message: "Preferred currency updated successfully!",
            preferred_currency: updatedUser.preferred_currency,
        });
    }
    catch (error) {
        console.error("❌ ERROR =>", error);
        return res.status(500).json({
            status: false,
            message: "Unable to update preferred currency.",
            errors: error.message || error,
        });
    }
};
export const preferredTimezone = async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: errors.array(),
            });
        }
        const user = req.user; // Populated by your authenticateUser middleware
        const { preferred_timezone } = req.body;
        // Update user's preferred timezone
        const updatedUser = await prisma.users.update({
            where: { user_id: BigInt(user.user_id) },
            data: { preferred_timezone },
        });
        return res.status(200).json({
            status: true,
            message: "Preferred timezone updated successfully!",
            timezone: updatedUser.preferred_timezone,
        });
    }
    catch (error) {
        console.error("❌ ERROR =>", error);
        return res.status(500).json({
            status: false,
            message: "Unable to update preferred timezone.",
            errors: error.message || error,
        });
    }
};
