import express from "express";
import prisma from "../../config/prismaClient.js";
import moment from "moment";
import axios from "axios";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";
import path from "path";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { userDetails } from "./CryptoAdController.js";
import { trades_trade_status } from "@prisma/client";
import { rdb } from "../../config/firebaseAdmin.js";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);
// Controller function
// 🔝 Sabse upar rakho


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
    console.log("user", user)

    const userDetails = await getUserDetails(user, true);
    const [totalLikes, totalDislikes] = await Promise.all([
      prisma.feedback.count({
        where: { user_id: BigInt(userId), like: true },
      }),
      prisma.feedback.count({
        where: { user_id: BigInt(userId), dislike: true },
      }),
    ]);
    const userIdStr = userId.toString();

    const tradesReleased = await prisma.trades.count({
      where: {
        OR: [
          { seller_id: userIdStr },
          { buyer_id: userIdStr },
        ],
        trade_status: {
          in: ["success", "disputedSuccess"],
        },
      },
    });
    const sellerPartners = await prisma.trades.findMany({
      where: {
        buyer_id: userIdStr,
      },
      distinct: ["seller_id"],
      select: { seller_id: true },
    });

    const buyerPartners = await prisma.trades.findMany({
      where: {
        seller_id: userIdStr,
      },
      distinct: ["buyer_id"],
      select: { buyer_id: true },
    });

    const tradePartners =
      sellerPartners.length + buyerPartners.length;
    const successfulTrades = await prisma.trades.count({
      where: {
        OR: [
          { seller_id: userIdStr },
          { buyer_id: userIdStr },
        ],
        trade_status: {
          in: ["success", "disputedSuccess"],
        },
      },
    });

    // 2️⃣ Failed Trades
    const failedTrades = await prisma.trades.count({
      where: {
        OR: [
          { seller_id: userIdStr },
          { buyer_id: userIdStr },
        ],
        trade_status: {
          in: ["reject", "cancel", "expired"],
        },
      },
    });

    const totalCompletedTrades = successfulTrades + failedTrades;

    // 3️⃣ Final Percentage
    const tradeSuccess =
      totalCompletedTrades > 0
        ? ((successfulTrades / totalCompletedTrades) * 100).toFixed(1)
        : "0.0";
    const trades = await prisma.trades.findMany({
      where: {
        buyer_id: userIdStr,
        paid_at: { not: null },
        created_at: { not: null },
        trade_status: {
          in: ["success", "disputedSuccess"],
        },
      },
      select: {
        created_at: true,
        paid_at: true,
      },
    });

    let totalMilliseconds = 0;
    let validTrades = 0;

    trades.forEach((trade) => {
      const created = new Date(trade.created_at).getTime();
      const paid = new Date(trade.paid_at).getTime();

      if (paid > created) {
        totalMilliseconds += (paid - created);
        validTrades++;
      }
    });

    const avgMilliseconds =
      validTrades > 0
        ? totalMilliseconds / validTrades
        : 0;

    // Convert properly
    const totalSeconds = Math.floor(avgMilliseconds / 1000);

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const avgTimeToPayment = `${minutes}m ${seconds}s`;
    const avgTimeToRelease = await getAvgTimeToRelease(userId);
    const avgTradeVolume = await getTradeVolumeRange(userId);
    const getBlocked = await getBlockedByCount(userId);
    const hasBlocked = await getHasBlockedCount(userId);
    res.status(200).json({
      status: true,
      response: {
        ...userDetails,
        feedback: {
          total_likes: totalLikes,
          total_dislikes: totalDislikes,
        },
        additional_info: {
          trades_released: tradesReleased,
          trade_partners: tradePartners,
          trade_success_rate: tradeSuccess,
          avgTimeToPayment: avgTimeToPayment,
          avgTimeToRelease: avgTimeToRelease,
          avgTradeVolume: avgTradeVolume,
          BlockedBy: getBlocked,
          hasBlocked: hasBlocked
        },
      },
    });

    if (user.country !== userDetails.country?.toLowerCase()) {
      prisma.users.update({
        where: { user_id: BigInt(userId) },
        data: { country: userDetails.country.toLowerCase() },
      }).catch(err => console.error("Country update failed:", err));
    }

  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to fetch user's details",
      errors: error.message,
    });
  }
};

export const blockUser = async (req, res) => {
  try {
    const blocked_by = String(req.user.user_id); // ✅ fixed
    const { blocked_user } = req.body;

    // 1️⃣ Check blocked_user required
    if (!blocked_user) {
      return res.status(400).json({
        success: false,
        message: "Blocked user id required",
      });
    }

    // 2️⃣ Self block check
    if (blocked_by === String(blocked_user)) {
      return res.status(400).json({
        success: false,
        message: "You cannot block yourself",
      });
    }

    // 3️⃣ Create block entry
    await prisma.user_blocks.create({
      data: {
        blocked_by,
        blocked_user: String(blocked_user),
      },
    });

    return res.status(201).json({   // ✅ 201 better for create
      success: true,
      message: "User blocked successfully",
    });

  } catch (error) {

    // 4️⃣ Unique constraint error (Already blocked)
    if (error.code === "P2002") {
      return res.status(409).json({   // ✅ 409 Conflict better
        success: false,
        message: "User already blocked",
      });
    }

    console.error("Block User Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const unblockUser = async (req, res) => {
  try {
    const loggedInUserId = req.user.user_id.toString(); // logged-in user
    const { blocked_user } = req.body;

    if (!blocked_user) {
      return res.status(422).json({
        status: false,
        message: "Validation failed",
        errors: "blocked_user is required",
      });
    }
    console.log("loggedInUserId", loggedInUserId)
    console.log("blocked_user", blocked_user)


    // Check if user is actually blocked
    const blockRecord = await prisma.user_blocks.findFirst({
      where: {
        blocked_by: loggedInUserId,
        blocked_user: blocked_user.toString(),
      },
    });

    if (!blockRecord) {
      return res.status(404).json({
        status: false,
        message: "User is not blocked",
      });
    }

    // Delete block record → unblock user
    await prisma.user_blocks.delete({
      where: { id: blockRecord.id },
    });

    return res.status(200).json({
      status: true,
      message: "User successfully unblocked",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Something went wrong",
      errors: error.message,
    });
  }
};
export const getBlockedUsers = async (req, res) => {
  try {
    const userId = BigInt(req.user.user_id); // logged-in user

    // fetch blocked users with user details
    const blockedUsers = await prisma.user_blocks.findMany({
      where: { blocked_by: userId },
      select: {
        id: true,
        blocked_user: true,
        created_at: true,
        blockedUser: userDetails(userId)
      },
    });

    return res.status(200).json({
      status: true,
      message: "Blocked users fetched successfully",
      data: blockedUsers,
    });

  } catch (error) {
    console.error("Get Blocked Users Error:", error);
    return res.status(500).json({
      status: false,
      message: "Something went wrong",
      errors: error.message
    });
  }
};


// // Example getUserDetails function
async function getUserDetails(user, includeSensitive = false) {
  const cleanedUser = JSON.parse(
    JSON.stringify(user, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );

  // Remove sensitive fields if needed
  delete cleanedUser.password;
  delete cleanedUser.remember_token;

  return cleanedUser;
}


// export function getUserDetails(user) {
//     return {
//         user_id: user.user_id,
//         name: user.name,
//         username: user.username,
//         username_changed: user.username_changed,
//         email: user.email,
//         dialing_code: user.dialing_code,
//         phone_number: user.phone_number,
//         email_verified: user.email_verified,
//         phone_verified: user.phone_verified,
//         id_verified: user.id_verified,
//         address_verified: user.address_verified,
//         twoFactorAuth: user.twoFactorAuth,
//         profile_image: user.profile_image,
//         country: user.country,
//         country_code: user.country_code,
//         city: user.city,
//         country_flag_url: user.country_flag_url,
//         preferred_currency: user.preferred_currency,
//         preferred_timezone: user.preferred_timezone,
//         bio: user.bio,
//         login_with: user.login_with,
//         login_status: user.login_status,
//         last_login: user.last_login,
//              last_seen_at: user.last_seen
//                         ? dayjs(user.last_seen).fromNow()
//                         : "online",
//         last_login_duration: user.last_login_duration,
//         user_status: user.user_status
//     };
// }


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

  } catch (error) {
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
        console.log("ip-api response", response.data);
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    console.error("❌ ERROR =>", error);
    return res.status(500).json({
      status: false,
      message: "Unable to update preferred timezone.",
      errors: error.message || error,
    });
  }
};

export const updateDisplayNamePreference = async (req, res) => {
  try {
    const userId = req.user.user_id; // auth middleware se
    const { display_name_preference } = req.body;

    const allowedValues = ["firstName", "fullName", "hide"];

    if (!allowedValues.includes(display_name_preference)) {
      return res.status(400).json({
        status: false,
        message: "Invalid display name preference",
      });
    }

    const updatedUser = await prisma.users.update({
      where: { user_id: userId },
      data: {
        display_name_preference,
      },
    });


    return res.json({
      status: true,
      message: "Display name preference updated successfully",
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};

const getAvgTimeToRelease = async (userId) => {
  try {
    const userIdStr = userId.toString();

    // 1️⃣ Fetch relevant trades
    const releaseTrades = await prisma.trades.findMany({
      where: {
        seller_id: userIdStr,
        paid_at: { not: null },
        asset_send_at: { not: null },
        trade_status: {
          in: ["success", "disputedSuccess"],
        },
      },
      select: {
        paid_at: true,
        asset_send_at: true,
      },
    });

    if (!releaseTrades.length) {
      return "0m 0s";
    }

    // 2️⃣ Calculate total time difference
    let totalMilliseconds = 0;
    let validTrades = 0;

    releaseTrades.forEach((trade) => {
      const paidTime = new Date(trade.paid_at).getTime();
      const releasedTime = new Date(trade.asset_send_at).getTime();

      if (releasedTime > paidTime) {
        totalMilliseconds += (releasedTime - paidTime);
        validTrades++;
      }
    });

    if (!validTrades) {
      return "0m 0s";
    }

    // 3️⃣ Calculate average
    const avgMilliseconds = totalMilliseconds / validTrades;

    const totalSeconds = Math.floor(avgMilliseconds / 1000);

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}m ${seconds}s`;

  } catch (error) {
    console.error("Error calculating Avg Time To Release:", error);
    return "0m 0s";
  }
};
const getTradeVolumeRange = async (userId) => {
  try {
    const userIdStr = userId.toString();

    const result = await prisma.trades.aggregate({
      _min: {
        buy_value: true,
      },
      _max: {
        buy_value: true,
      },
      where: {
        seller_id: userIdStr,
        trade_status: {
          in: ["success", "disputedSuccess"],
        },
        buy_value: {
          gt: 0, // ✅ zero ignore karega
        },
      },
    });

    const minVolume = Number(result._min.buy_value || 0);
    const maxVolume = Number(result._max.buy_value || 0);

    if (!minVolume && !maxVolume) {
      return "0 - 0 USD";
    }

    return `${minVolume} - ${maxVolume} USD`;

  } catch (error) {
    console.error("Error calculating trade volume range:", error);
    return "0 - 0 USD";
  }
};
async function getBlockedByCount(userId) {
  try {
    const count = await prisma.user_blocks.count({
      where: {
        blocked_user: userId.toString(),
      },
    });

    return count === 1 ? "1 USER" : `${count} USERS`;

  } catch (error) {
    console.error(error);
    return "0 USERS";
  }
}

async function getHasBlockedCount(userId) {
  try {
    const count = await prisma.user_blocks.count({
      where: {
        blocked_by: userId.toString(),
      },
    });

    return count === 1 ? "1 USER" : `${count} USERS`;

  } catch (error) {
    console.error(error);
    return "0 USERS";
  }
}

export const getP2PStats = async (req, res) => {
  try {

    // 🔥 1️⃣ Get Online Users from Firebase
    const snapshot = await rdb.ref("userPresence").once("value");
    console.log("snapshot", snapshot)
    const presenceData = snapshot.val();

    let onlineUsers = 0;

    if (presenceData) {
      Object.values(presenceData).forEach(user => {
        if (user.onlineState?.isOnline) {
          onlineUsers++;
        }
      });
    }

    // 2️⃣ Active offers
    const userOffers = await prisma.crypto_ads.count({
      where: { is_active: true }
    });

    // 3️⃣ 24h trade volume
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const trades24h = await prisma.trades.aggregate({
      _sum: { amount: true },
      where: {
        created_at: { gte: yesterday },
        trade_status: trades_trade_status.success
      }
    });

    const trade24hVolume = trades24h._sum.amount || 0;

    // 4️⃣ Total liquidity
    const totalLiquidityAgg = await prisma.crypto_ads.aggregate({
      _sum: { remaining_trade_limit: true },
      where: { is_active: true }
    });

    const totalLiquidity = totalLiquidityAgg._sum.remaining_trade_limit || 0;

    return res.status(200).json({
      status: true,
      message: "P2P marketplace stats fetched successfully",
      data: {
        explore: "P2P Marketplace",
        onlineUsers,
        userOffers,
        trade24hVolumeUSD: trade24hVolume,
        totalLiquidityUSD: Number(totalLiquidity).toFixed(2)
      }
    });

  } catch (error) {
    console.error("Get P2P Stats Error:", error);
    return res.status(500).json({
      status: false,
      message: "Something went wrong",
      errors: error.message
    });
  }
};

export const getAccountInfo = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const user = await prisma.users.findUnique({
      where: { user_id: userId },

      select: {
        email_verified_at: true,
        number_verified_at: true,
        id_verified_at: true,
        address_verified_at: true,
        user_level: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const level = calculateUserLevel(user);
    const limit = getAccountLimit(user.user_level);
    const levelName = getLevelName(user.user_level);
    const levelMessage = getLevelMessage(user.user_level, limit);

    return res.status(200).json({
      success: true,
      data: {
        accountLevel: user.user_level,
        levelName: levelName,
        accountLimit: limit,
        levelMessage: levelMessage
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};



function calculateUserLevel(user) {
  const isBasicVerified =
    user.email_verified_at && user.number_verified_at;

  const isIdVerified =
    isBasicVerified && user.id_verified_at;

  const isAddressVerified =
    isIdVerified && user.address_verified_at;

  if (isAddressVerified) return 3;
  if (isIdVerified) return 2;
  if (isBasicVerified) return 1;

  return 0;
}


export function getAccountLimit(level) {
  switch (level) {
    case 0: // Guest
      return 0; // Daily limit 0 INR
    case 1: // Basic
      return 40000; // Minimum daily limit ₹40,000
    case 2: // Standard
      return 4000000; // Minimum daily limit ₹40,00,000
    case 3: // Advanced / Merchant
      return 16000000; // Minimum daily limit ₹1,60,00,000
    default:
      return 0;
  }
}

function getLevelMessage(level, limit) {
  switch (level) {
    case 0:
      return "You are a Guest (Level 0). P2P trading is disabled. Please complete Basic KYC.";
    case 1:
      return `Basic verified (Level 1). Limited P2P access (up to ₹${limit.toLocaleString()}/day).`;
    case 2:
      return `Standard verified (Level 2). Full P2P access (up to ₹${limit.toLocaleString()}/day).`;
    case 3:
      return `Advanced verified (Level 3). High P2P limits (₹${limit.toLocaleString()}/day).`;
    default:
      return "Merchant/VIP account with custom limits and priority access.";
  }
}

function getLevelName(level) {
  switch (level) {
    case 0: return "Guest";
    case 1: return "Basic";
    case 2: return "Standard";
    case 3: return "Advanced";
    default: return "Unknown";
  }
}

export const updatePhoneVerify = async (req, res) => {
  try {
    const { phone } = req.body;
    const userId = req.user.user_id; // auth middleware se aayega

    // Validate input
    if (!phone) {
      return res.status(422).json({
        status: false,
        message: "Phone number is required",
      });
    }

    // Fetch user
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    // Update phone and number_verify_at
    const updatedUser = await prisma.users.update({
      where: { user_id: BigInt(userId) },
      data: {
        phone_number: phone,
        number_verified_at: new Date(), // current timestamp
      },
    });

    return res.status(200).json({
      status: true,
      message: "Phone verified successfully!",
      phone: updatedUser.phone,
      number_verify_at: updatedUser.number_verify_at,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: false,
      message: "Unable to update phone verification",
      errors: err.message,
    });
  }
};
