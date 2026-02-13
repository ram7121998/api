import express from "express";
import jwt from "jsonwebtoken";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { sendEmailOtp, sendSmsOTP, verifyEmailOtp } from "../controller/OtpController.js";
import { addNumber, login, logout, logoutFromOtherToken, passwordVerification, register, resetPassword, sendResetLink, updateTwoFA, updateTwoFaSet } from "../controller/user/authController.js";
import { blockUser, changePassword, getBlockedUsers, getReferralLink, getSecurityQuestion, loginHistory, preferredCurrency, preferredTimezone, securityQuestion, unblockUser, updateBio, updateDisplayNamePreference, updateProfileImage, updateUsername, userDetail } from "../controller/user/UserController.js";
import { addressVerification, getAddressVerification, getIdDetails, storeAddress } from "../controller/user/AddressVerificationController.js";
import { singelUpload, upload, uploadAttachments } from "../middleware/upload.js";
import { addUpiDetails, deleteMethod, getPaymentDetails, getUpiDetails, storePaymentDetails, updateIsPrimary, updatePaymentDetails, updateUpiDetails } from "../controller/user/PaymentController.js";
import { formData, validateBio, validateChangePassword, validatePreferredCurrency, validatePreferredTimezone, validateSecurityQuestions, validateUpiUpdate, validateUsername } from "../middleware/validation.js";
import { uploadImage } from "./adminRoutes.js";
import { createCryptoAd, getCryptoAd, getFavoriteCryptoOffer, getMyCryptoAd, toggleFavoriteCryptoOffer, updateAllCryptoAdIsActive, updateCryptoAd, updateCryptoAdIsActive } from "../controller/user/CryptoAdController.js";
import { getAllNotifications, getPerticularNotification, markAsRead } from "../controller/user/NotificationController.js";
import { getParticularTicket } from "../controller/admin/supportTicketController.js";
import { activeUserTradeHistory, authenticatedUserTradeHistory, buyerUpdateTrade, cancelTrade, getTradeFeedback, getTradeHistory, giveFeedback, initiateTrade, sellerUpdateTrade, sendReleaseOtp, tradeExpired, updateDispute, updateTradeFeedback, UserTradeHistory, verifyReleaseOtp } from "../controller/user/TradeController.js";
import { closeTicket, getParticularTickets, getTickets, replySupportTicket, storeTicket } from "../controller/user/UserSupportTicketController.js";
import { convertAsset, feeCalculation, getTransactionDetails, sendAsset, transactionUsingAddress, updateTransactions, updateTransactionUsingAddress } from "../controller/user/TransactionController.js";
import { createWeb3Wallet, decryptedData, fetchUserByUsernameAndAddress, getWalletKeyPhrase, getWeb3WalletDetails, updateWeb3Wallet } from "../controller/user/Web3WalletController.js";
import { sendWelcomeEmail } from "../controller/EmailController.js";
import { getReport, getUsersReport, storeReport } from "../controller/ReportController.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import { ensureEmailVerified } from "../middleware/ensureEmailVerified.js";
import { sendOtp } from "../controller/user/SandboxController.js";
import { createFeedback, getFeedback, giveCryptoFeedback } from "../controller/user/FeedbackController.js";
import { getCountries, getCountriesCurrency, getCountriesDialingCode, getTimezone } from "../controller/CountryController.js";
import { sendBnb, sendBtc, sendEth, sendUsdt } from "../controller/user/sendEth.js";
import passport from "../config/password.js";
import DeviceDetector from "device-detector-js";
import prisma from "../config/prismaClient.js";
import dayjs from "dayjs";

const router = express.Router();
router.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);
router.get(
  "/auth/google/callback",
  passport.authenticate("google", { session: false }),
  async (req, res) => {
    try {
      const user = req.user;

      if (!user) {
        return res.redirect("http://localhost:5173/login");
      }

      // ------------------------
      // CHECK USER STATUS
      // ------------------------
      if (user.user_status === "block") {
        return res.redirect("http://localhost:5173/login?error=blocked");
      }

      if (user.user_status === "terminate") {
        return res.redirect("http://localhost:5173/login?error=terminated");
      }

      // ------------------------
      // GET IP & DEVICE
      // ------------------------
      const ipAddress =
        req.headers["x-forwarded-for"] ||
        req.headers["cf-connecting-ip"] ||
        req.headers["x-real-ip"] ||
        req.ip;

      const detector = new DeviceDetector();
      const userAgent = req.headers["user-agent"] || "";
      const device = detector.parse(userAgent);

      // ------------------------
      // UPDATE USER LOGIN INFO
      // ------------------------
      await prisma.users.update({
        where: { user_id: BigInt(user.user_id) },
        data: {
          login_with: "google",
          login_status: "login",
          last_seen: new Date(),
          login_count: user.login_count + 1,
          last_login: new Date(),
          logged_in_device: userAgent,
          loggedIn_device_ip: ipAddress,
        },
      });

      // ------------------------
      // GENERATE JWT TOKEN
      // ------------------------
      const token = jwt.sign(
        { userId: user.user_id.toString() },
        process.env.JWT_SECRET || "secret",
        { expiresIn: "7d" }
      );

      // ------------------------
      // SAVE TOKEN
      // ------------------------
      const tokenRecord = await prisma.personal_access_tokens.create({
        data: {
          tokenable_type: "users",
          tokenable_id: BigInt(user.user_id),
          name: "Google User Token",
          token: token,
          abilities: "login_by:google",
          created_at: new Date(),
        },
      });

      // ------------------------
      // SAVE LOGIN DETAILS
      // ------------------------
      const deviceData = {
        clientInfo: device.client || {},
        osInfo: device.os || {},
        device: device.device?.type || "desktop",
        brand: device.device?.brand || null,
        model: device.device?.model || null,
      };

      await prisma.user_login_details.create({
        data: {
          user_id: BigInt(user.user_id),
          token_id: tokenRecord.id.toString(),
          ip_address: ipAddress === "::1" ? "49.36.208.251" : ipAddress,
          device_details: JSON.stringify(deviceData),
          device: deviceData.device,
          browser: device.client?.name || null,
          os: device.os?.name || null,
          os_version: device.os?.version || null,
          login_status: "login",
          logged_in_at: new Date(),
          created_at: new Date(),
        },
      });

      // ------------------------
      // KEEP LAST 10 LOGIN RECORDS
      // ------------------------
      const oldLogins = await prisma.user_login_details.findMany({
        where: { user_id: BigInt(user.user_id) },
        orderBy: { login_details_id: "desc" },
        skip: 9,
        take: 1,
      });

      if (oldLogins.length > 0) {
        const cutoffId = oldLogins[0].login_details_id;

        await prisma.user_login_details.deleteMany({
          where: {
            user_id: BigInt(user.user_id),
            login_details_id: { lt: cutoffId },
          },
        });
      }

      // ------------------------
      // OPTIONAL 2FA (Same Logic)
      // ------------------------
      // if (user.two_factor_auth) {
      //   const otp = Math.floor(100000 + Math.random() * 900000);

      //   await prisma.email_otps.upsert({
      //     where: { user_id: BigInt(user.user_id) },
      //     update: {
      //       otp,
      //       expires_at: dayjs().add(5, "minute").toDate(),
      //     },
      //     create: {
      //       user_id: BigInt(user.user_id),
      //       email: user.email,
      //       otp,
      //       expires_at: dayjs().add(5, "minute").toDate(),
      //     },
      //   });

      //   await sendTradeEmail("OTP_SEND", user.email, {
      //     user_name: user.name,
      //     otp_code: otp,
      //     otp_expiry_minutes: 5,
      //   });
      // }

      // ------------------------
      // REDIRECT FRONTEND WITH TOKEN
      // ------------------------
      return res.redirect(
        `http://localhost:5173/auth/google/callback?token=${token}`
      );

    } catch (error) {
      console.error("Google Login Error:", error);
      return res.redirect("http://localhost:5173/login?error=server");
    }
  }
);

router.post("/auth/register", formData, register);
router.post("/auth/login", formData, login);
router.post("/verify-email-otp", formData, authenticateUser, checkUserStatus, verifyEmailOtp);
router.post("/send-email-otp", formData, authenticateUser, checkUserStatus, sendEmailOtp);
router.post("/send-sms-otp", authenticateUser, checkUserStatus, sendSmsOTP);
router.post("/send-release-otp", authenticateUser, checkUserStatus, sendReleaseOtp);
router.post("/verify-release-otp", formData, authenticateUser, checkUserStatus, verifyReleaseOtp);
router.post("/display-name-preference", authenticateUser, updateDisplayNamePreference);
router.get("/user-details", authenticateUser, checkUserStatus, userDetail);
router.post("/block-user", authenticateUser, checkUserStatus, blockUser);
router.post("/unblock-user", authenticateUser, checkUserStatus, unblockUser);
router.get("/user/get-blocked-users", authenticateUser, checkUserStatus, getBlockedUsers);

router.get("/get-referral-link", authenticateUser, checkUserStatus, getReferralLink);
router.get("/login-history", authenticateUser, checkUserStatus, loginHistory);
router.post("/address/address-verification", authenticateUser, checkUserStatus, upload.fields([{ name: "front_document", maxCount: 1 }, { name: "back_document", maxCount: 1 }]), addressVerification);
router.get("/address/get-address-verification", authenticateUser, checkUserStatus, getAddressVerification);
router.post("/address/id-verification", authenticateUser, checkUserStatus, upload.fields([{ name: "document_front_image", maxCount: 1 }, { name: "document_back_image", maxCount: 1 }]), storeAddress);
router.get("/address/get-id-verification-details", authenticateUser, checkUserStatus, getIdDetails);
router.post("/payment-details/add-payment-details", formData, authenticateUser, checkUserStatus, storePaymentDetails);
router.get("/payment-details/get-payment-details", authenticateUser, checkUserStatus, getPaymentDetails);
router.post("/payment-details/add-upi-details", authenticateUser, checkUserStatus, singelUpload.single("qr_code"), addUpiDetails);

router.patch("/payment-details/update-upi-details", validateUpiUpdate, authenticateUser, checkUserStatus, updateUpiDetails);
router.delete("/payment-details/delete-payment-method", formData, authenticateUser, checkUserStatus, deleteMethod);

router.get("/payment-details/get-upi-details", authenticateUser, checkUserStatus, getUpiDetails);
router.post("/update-username", formData, authenticateUser, checkUserStatus, validateUsername, updateUsername);
router.post("/change-password", formData, authenticateUser, checkUserStatus, validateChangePassword, changePassword);
router.post("/update-bio", formData, authenticateUser, checkUserStatus, validateBio, updateBio);
router.post("/security-questions", authenticateUser, checkUserStatus, securityQuestion);
router.get("/security-questions", authenticateUser, checkUserStatus, getSecurityQuestion);
router.post("/update-profile-image", uploadImage.single("image"), authenticateUser, checkUserStatus, updateProfileImage);
router.get("/crypto-advertisement/my-crypto-ad", authenticateUser, checkUserStatus, getMyCryptoAd);
router.post("/crypto-advertisement/create-crypto-ad", formData, authenticateUser, checkUserStatus, createCryptoAd);
router.get("/crypto-advertisement/crypto-ad", authenticateUser, checkUserStatus, getCryptoAd);
router.post("/crypto-advertisement/toggle-cryptoAd-active", formData, authenticateUser, checkUserStatus, updateCryptoAdIsActive);
router.post("/crypto-advertisement/toggle-all-cryptoAd-active", formData, authenticateUser, checkUserStatus, updateAllCryptoAdIsActive);
router.post("/crypto-advertisement/update-crypto-ad", formData, authenticateUser, checkUserStatus, updateCryptoAd);
router.post("/crypto-advertisement/toggle-favorite-cryptoOffer", formData, authenticateUser, checkUserStatus, toggleFavoriteCryptoOffer);
router.get("/crypto-advertisement/get-favorite-offer", formData, authenticateUser, checkUserStatus, getFavoriteCryptoOffer);
router.get("/notifications", formData, authenticateUser, checkUserStatus, getAllNotifications);
router.get("/notification/:id", formData, authenticateUser, checkUserStatus, getPerticularNotification);
router.patch("/mark-as-read", formData, authenticateUser, checkUserStatus, markAsRead);
router.post("/trade/initiate-trade", formData, authenticateUser, checkUserStatus, initiateTrade);
router.get("/trade/get-trade-history", authenticateUser, checkUserStatus, getTradeHistory);
router.post("/trade/give-feedback", formData, authenticateUser, checkUserStatus, giveFeedback);
router.get("/trade/get-trade-feedback", formData, authenticateUser, checkUserStatus, getTradeFeedback);
router.post("/trade/update-trade-feedback", formData, authenticateUser, checkUserStatus);
router.post("/trade/cancel-trade", formData, authenticateUser, checkUserStatus, cancelTrade);
router.post("/trade/update-trade-dispute", formData, authenticateUser, checkUserStatus, updateDispute);
router.post("/support-tickets/store-ticket", authenticateUser, checkUserStatus, uploadAttachments.array("attachment[]", 5), storeTicket);
router.get("/support-tickets/get-tickets", authenticateUser, checkUserStatus, getTickets);
router.get("/support-tickets/get-particular-ticket/:id", authenticateUser, checkUserStatus, getParticularTickets);
router.post("/support-tickets/reply-support-ticket", authenticateUser, checkUserStatus, uploadAttachments.array("attachment[]", 5), replySupportTicket);
router.post("/support-tickets/close-ticket", formData, authenticateUser, checkUserStatus, closeTicket);
router.get("/transaction/get-transaction", authenticateUser, checkUserStatus, getTransactionDetails);
router.post("/transaction/send-asset", formData, authenticateUser, checkUserStatus, sendAsset);
router.post("/send-crypto", authenticateUser, async (req, res) => {
  try {
    const { asset, toAddress, amount } = req.body;
    if (!asset || !toAddress || !amount)
      return res.status(400).json({ status: false, message: "Missing parameters" });

    let txHash;
    switch (asset.toLowerCase()) {
      case "eth":
        txHash = await sendEth(toAddress, amount);
        break;
      case "bnb":
        txHash = await sendBnb(toAddress, amount);
        break;
      case "usdt":
        txHash = await sendUsdt(toAddress, amount);
        break;
      case "btc":
        txHash = await sendBtc(toAddress, amount);
        break;
      default:
        return res.status(400).json({ status: false, message: "Unsupported asset" });
    }

    return res.json({ status: true, message: "Transaction successful", transactionHash: txHash });
  } catch (err) {
    console.error("Transaction Error:", err);
    return res.status(500).json({ status: false, message: err.message });
  }
});
router.post("/web3-wallet/create-web3-wallet", formData, authenticateUser, checkUserStatus, createWeb3Wallet);
router.get("/web3-wallet/get-walletKeyPhrase", authenticateUser, checkUserStatus, getWalletKeyPhrase);
router.post("/web3-wallet/decrypt-data", formData, authenticateUser, checkUserStatus, decryptedData);
router.get("/web3-wallet/get-web3-wallet", authenticateUser, checkUserStatus, getWeb3WalletDetails);
router.get("/web3-wallet/get-user-detail", authenticateUser, checkUserStatus, fetchUserByUsernameAndAddress);
router.post("/web3-wallet/update-web3-wallet", formData, authenticateUser, checkUserStatus, updateWeb3Wallet);
router.post("/trade/buyer-update-trade", uploadImage.single("image"), authenticateUser, checkUserStatus, buyerUpdateTrade);
router.post("/send-welcome-email", authenticateUser, checkUserStatus, sendWelcomeEmail);
router.post("/report/store-report", formData, authenticateUser, checkUserStatus, storeReport);
router.get("/report/get-report", authenticateUser, checkUserStatus, getReport);
router.get("/admin/report/get-report", authenticateUser, checkUserStatus, ensureEmailVerified, getUsersReport);
router.post("/auth/update-2fa", formData, authenticateUser, checkUserStatus, updateTwoFA);
router.post("/auth/update-2fa-set", formData, authenticateUser, checkUserStatus, updateTwoFaSet);
router.post("/auth/forgot-password", formData, sendResetLink);
router.post("/auth/reset-password", formData, resetPassword);
router.post("/auth/password-verification", formData, authenticateUser, checkUserStatus, passwordVerification);
router.delete("/auth/logout", authenticateUser, checkUserStatus, logout);
router.post("/auth/logout-other-token", authenticateUser, checkUserStatus, logoutFromOtherToken);
router.post("/add-phoneNumber", formData, authenticateUser, checkUserStatus, addNumber);
router.patch("/payment-details/update-payment-details", formData, authenticateUser, checkUserStatus, updatePaymentDetails);
router.post("/payment-details/update-is-primary", formData, authenticateUser, checkUserStatus, updateIsPrimary);
router.post("/preferred-currency", formData, authenticateUser, validatePreferredCurrency, checkUserStatus, preferredCurrency);
router.post("/preferred-timezone", formData, authenticateUser, validatePreferredTimezone, checkUserStatus, preferredTimezone);
router.post("/verification/send-email-otp", formData, authenticateUser, checkUserStatus, sendOtp);
router.post("/trade/seller-update-trade", formData, authenticateUser, checkUserStatus, sellerUpdateTrade);
router.post("/trade/update-trade-expired", formData, authenticateUser, checkUserStatus, tradeExpired);
router.get("/trade/authenticated-user-trade-history", formData, authenticateUser, checkUserStatus, authenticatedUserTradeHistory);
router.get("/trade/active-user-trade", formData, authenticateUser, checkUserStatus, activeUserTradeHistory);
router.get("/trade/complete-user-trade", formData, authenticateUser, checkUserStatus, UserTradeHistory);

router.post("/transaction/convert-asset", formData, authenticateUser, checkUserStatus, convertAsset);

router.post("/transaction/transaction-using-address", formData, authenticateUser, checkUserStatus, transactionUsingAddress);

router.post("/transaction/fee-calculation", formData, authenticateUser, checkUserStatus, feeCalculation);
router.post("/transaction/update-transaction", formData, authenticateUser, checkUserStatus, updateTransactionUsingAddress);
router.get("/feedback/get-feedback", authenticateUser, checkUserStatus, getFeedback);
router.post("/feedback/create-feedback", formData, authenticateUser, checkUserStatus, createFeedback);
router.get("/crypto-advertisement/give-crypto-feedback", authenticateUser, checkUserStatus, giveCryptoFeedback);

router.get("/countries/currency", authenticateUser, getCountriesCurrency);
router.get("/countries/dialing-code", authenticateUser, getCountriesDialingCode);
router.get("/countries/name", authenticateUser, getCountries);
router.get("/countries/timezone", authenticateUser, getTimezone);
export default router;
