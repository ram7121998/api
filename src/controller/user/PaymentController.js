import prisma from "../../config/prismaClient.js";
import { convertBigIntToString } from "../../config/convertBigIntToString.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import relativeTime from "dayjs/plugin/relativeTime.js";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import moment from "moment";
import { validationResult, body } from "express-validator";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);
export const storePaymentDetails = async (req, res) => {
    const user = req.user; // from auth middleware

    try {
        // ------------------- Input Normalization -------------------
        req.body.bank_account_country = req.body.bank_account_country?.toLowerCase();
        req.body.ifsc_code = req.body.ifsc_code?.toUpperCase();
        req.body.swift_bic_code = req.body.swift_bic_code?.toUpperCase();
        req.body.account_type = req.body.account_type?.toLowerCase();
        req.body.is_primary = req.body.is_primary ? true : false;

        // ------------------- Validations -------------------
        const errors = {};

        const requiredFields = [
            "account_type",
            "bank_account_country",
            "currency",
            "bank_name",
            "account_holder_name",
            "account_number",
        ];

        requiredFields.forEach((field) => {
            if (!req.body[field]) {
                errors[field] = [`${field} is required`];
            }
        });

        // Validate account type
        if (req.body.account_type && !["personal", "business"].includes(req.body.account_type)) {
            errors["account_type"] = ["account_type must be personal or business"];
        }

        // Validate IFSC (if provided)
        if (req.body.ifsc_code) {
            const ifscRegex = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
            if (!ifscRegex.test(req.body.ifsc_code)) {
                errors["ifsc_code"] = ["Invalid IFSC code format"];
            }
        }

        // India requires IFSC
        if (req.body.bank_account_country === "india" && !req.body.ifsc_code) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { ifsc_code: ["The IFSC code is mandatory for bank accounts in India."] },
            });
        }

        // account_number numeric validation
        if (!/^[0-9]+$/.test(req.body.account_number)) {
            errors["account_number"] = ["Account number must contain only digits"];
        }

        // Unique account_number validation (Prisma equivalent of Laravel)
        const existingAcc = await prisma.payment_details.findFirst({
            where: { account_number: req.body.account_number },
        });

        if (existingAcc) {
            errors["account_number"] = ["This account number already exists"];
        }

        if (Object.keys(errors).length > 0) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors,
            });
        }

        // ------------------- Prisma Transaction -------------------
        const result = await prisma.$transaction(async (tx) => {

            // If primary account selected → remove old primary
            if (req.body.is_primary === true) {
                await tx.payment_details.updateMany({
                    where: { user_id: BigInt(user.user_id), is_primary: true },
                    data: { is_primary: false },
                });
            }

            // ---- Create Payment Details ----
            const payment = await tx.payment_details.create({
                data: {
                    user_id: BigInt(user.user_id),
                    account_type: req.body.account_type,
                    bank_account_country: req.body.bank_account_country,
                    currency: req.body.currency,
                    bank_name: req.body.bank_name,
                    account_holder_name: req.body.account_holder_name,
                    custom_bank_details: req.body.custom_bank_details || null,
                    ifsc_code: req.body.ifsc_code || null,
                    account_number: req.body.account_number,
                    swift_bic_code: req.body.swift_bic_code || null,
                    residence_country: req.body.residence_country || null,
                    state_region: req.body.state_region || null,
                    city: req.body.city || null,
                    zip_code: req.body.zip_code || null,
                    address: req.body.address || null,
                    status: "pending",
                    is_primary: req.body.is_primary ? true : false,
                },
            });

            // ---- Create Notification ----
         const notification=   await tx.notifications.create({
                data: {
                    user_id: BigInt(user.user_id),
                    title: "Payment details added successfully.",
                    message: "You have successfully added your payment details.",
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()

                },
            });
        io.to(notification.user_id.toString()).emit("new_notification", notification);


            return payment;
        });

        return res.status(201).json({
            status: true,
            message: "Payment details added successfully.",
            is_primary: req.body.is_primary,
        });

    } catch (err) {
        console.log("storePaymentDetails ERROR:", err);

        return res.status(500).json({
            status: false,
            message: "Unable to add payment details.",
            errors: err.message,
        });
    }
};

export const getPaymentDetails = async (req, res) => {
    try {
        const user = req.user;     // Authenticated user from middleware
        const paymentType = req.query.payment_type;

        let requiredPaymentDetails = [];
        let requiredUpiDetails = [];

        // ---------------- BANK DETAILS ----------------
        if (!paymentType || paymentType === "bank") {
            const paymentDetails = await prisma.payment_details.findMany({
                where: { user_id: BigInt(user.user_id) }
            });

            if (paymentDetails.length > 0) {
                requiredPaymentDetails = paymentDetails.map(detail => ({
                    pd_id: detail.pd_id,
                    account_type: detail.account_type,
                    bank_account_country: detail.bank_account_country,
                    currency: detail.currency,
                    bank_name: detail.bank_name,
                    account_holder_name: detail.account_holder_name,
                    custom_bank_details: detail.custom_bank_details,
                    ifsc_code: detail.ifsc_code || null,
                    account_number: detail.account_number,
                    swift_bic_code: detail.swift_bic_code || null,
                    residence_country: detail.residence_country || null,
                    state_region: detail.state_region || null,
                    city: detail.city || null,
                    zip_code: detail.zip_code || null,
                    address: detail.address || null,
                    status: detail.status,
                    is_primary: detail.is_primary ? true : false
                }));
            }
        }

        // ---------------- UPI DETAILS ----------------
        if (!paymentType || paymentType === "upi") {
            const upiDetails = await prisma.upi_details.findMany({
                where: { user_id: BigInt(user.user_id) }
            });

            if (upiDetails.length > 0) {
                requiredUpiDetails = upiDetails.map(details => {
                    const createdAtIST = moment(details.created_at)
                        .tz("Asia/Kolkata")
                        .format("YYYY-MM-DD HH:mm:ss A");

                    return {
                        id: details.id,
                        user_id: details.user_id,
                        upi_name: details.upi_name,
                        upi_id: details.upi_id,
                        qr_code_url: details.qr_code
                            ? `${process.env.BASE_URL}/uploads/${details.qr_code}`
                            : null,
                        caption: details.caption,
                        is_primary: details.is_primary,
                        created_at: createdAtIST,
                        created_at_duration: moment(details.created_at)
                            .tz("Asia/Kolkata")
                            .fromNow()
                    };
                });
            }
        }

        const safeData = convertBigIntToString(requiredPaymentDetails)
        return res.status(200).json({
            status: true,
            message: "Payment details retrieved successfully",
            payment_details: safeData,
            upi_details: requiredUpiDetails
        });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to retrieve payment details",
            errors: error.message
        });
    }
};

export const addUpiDetails = async (req, res) => {

    const user = req.user;
    let qr_code = null;

    try {
        const { upi_name, upi_id, caption, is_primary } = req.body;

        // VALIDATION
        const validUpiNames = ["phonepe", "google pay", "paytm", "amazon pay"];
        if (!upi_name || !validUpiNames.includes(upi_name.trim().toLowerCase())) {
            return res.status(422).json({ status: false, message: "Invalid upi_name" });
        }
        if (!upi_id || typeof upi_id !== "string") {
            return res.status(422).json({ status: false, message: "upi_id is required" });
        }

        // CHECK IF UPI ID EXISTS
        const existUpi = await prisma.upi_details.findFirst({ where: { upi_id: upi_id.trim() } });
        if (existUpi) {
            return res.status(422).json({ status: false, message: "upi_id already exists" });
        }

        const isPrimaryValue = is_primary === "true" || is_primary === true;

        // START TRANSACTION
        const tx = await prisma.$transaction(async (prismaTx) => {
            // Reset previous primary
            if (isPrimaryValue) {
                await prismaTx.upi_details.updateMany({
                    where: { user_id: BigInt(user.user_id), is_primary: true },
                    data: { is_primary: false },
                });
            }

            // PROCESS FILE
            if (req.file) {
                const file = req.file;
                const extension = file.mimetype.split("/")[1];
                const fileName = `${user.user_id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
                // 1️⃣ Save the file to storage/app/public/images/qr_code
                const fullPath = path.join("storage", "app", "public", "images", "qr_code", fileName);
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });

                // Save/compress the file
                await sharp(file.buffer)
                    .toFormat(extension === "png" ? "png" : "jpeg", { quality: 75 })
                    .toFile(fullPath);

                // 2️⃣ Set qr_code path for DB so it works with /storage route
                qr_code = `${req.protocol}://${req.get("host")}/storage/images/qr_code/${fileName}`; // Remove storage/app/public


            }

            // INSERT UPI DETAILS
            const created = await prismaTx.upi_details.create({
                data: {
                    user_id: BigInt(user.user_id),
                    upi_name: upi_name.trim(),
                    upi_id: upi_id.trim(),
                    qr_code,
                    caption: caption || "",
                    is_primary: isPrimaryValue,
                    status: "pending",
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            });

            // INSERT NOTIFICATION
        const notification  =  await prismaTx.notifications.create({
                data: {
                    user_id: BigInt(user.user_id),
                    title: "UPI details added successfully.",
                    message: "You have successfully added your UPI details.",
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()

                },
            });
                   io.to(notification.user_id.toString()).emit("new_notification", notification);


            return created;
        });

        // PREPARE RESPONSE
        const data = {
            ...tx,
            id: tx.id.toString(),
            user_id: tx.user_id.toString(),
            created_at: dayjs(tx.created_at).format("YYYY-MM-DD hh:mm:ss A"),
            created_at_duration: dayjs(tx.created_at).fromNow(),
            qr_code_url: tx.qr_code ? tx.qr_code : null,
        };

        return res.status(201).json({ status: true, message: "UPI details added successfully.", data });

    } catch (error) {
        console.log("❌ ERROR =>", error);

        if (qr_code) {
            const filePath = path.join("public", qr_code);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        return res.status(500).json({ status: false, message: "Unable to add payment details.", errors: error.message || error });
    }
};


export const getUpiDetails = async (req, res) => {
    try {
        const user = req.user; // assuming req.user is set via auth middleware

        const upiDetails = await prisma.upi_details.findMany({
            where: { user_id: BigInt(user.user_id) },
        });

        const requiredData = upiDetails.map((details) => ({
            id: details.id,
            user_id: details.user_id,
            upi_name: details.upi_name,
            upi_id: details.upi_id,
            qr_code_url: details.qr_code ? `${process.env.BASE_URL}/storage/${details.qr_code}` : null,
            caption: details.caption,
            is_primary: details.is_primary,
            created_at: dayjs(details.created_at)
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD hh:mm:ss A"),
            created_at_duration: dayjs(details.created_at)
                .tz("Asia/Kolkata")
                .fromNow(),
        }));
        const safeData = convertBigIntToString(requiredData)
        return res.status(200).json({
            status: true,
            message: "Upi details fetched successfully.",
            data: safeData,
        });
    } catch (error) {
        console.error("Error fetching UPI details:", error);
        return res.status(500).json({
            status: false,
            message: "Unable to fetch Upi details.",
            errors: error.message,
        });
    }
};


export const updatePaymentDetails = async (req, res) => {
    const user = req.user;

    try {
        // -------------------- PRE-PROCESS INPUT --------------------
        req.body.bank_account_country = req.body.bank_account_country?.toLowerCase();
        req.body.ifsc_code = req.body.ifsc_code?.toUpperCase();
        req.body.swift_bic_code = req.body.swift_bic_code?.toUpperCase();
        req.body.account_type = req.body.account_type?.toLowerCase();

        // -------------------- VALIDATION RULES --------------------
        const requiredFields = [
            "id",
            "account_type",
            "bank_name",
            "account_holder_name",
            "account_number"
        ];

        for (const field of requiredFields) {
            if (!req.body[field]) {
                return res.status(422).json({
                    status: false,
                    message: "Validation failed.",
                    errors: { [field]: [`${field} is required`] }
                });
            }
        }

        // Account type check
        const validAccountTypes = ["personal", "business"];
        if (!validAccountTypes.includes(req.body.account_type)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    account_type: ["account_type must be personal or business"]
                }
            });
        }

        // IFSC check (only if provided)
        if (req.body.ifsc_code) {
            const ifscRegex = /^[A-Za-z]{4}[0-9]{7}$/;
            if (!ifscRegex.test(req.body.ifsc_code)) {
                return res.status(422).json({
                    status: false,
                    message: "Validation failed.",
                    errors: {
                        ifsc_code: ["Invalid IFSC format"]
                    }
                });
            }
        }

        // account_number numeric check
        if (!/^[0-9]+$/.test(req.body.account_number)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    account_number: ["account_number must be numeric"]
                }
            });
        }

        // -------------------- FETCH PAYMENT DETAIL --------------------
        const paymentDetail = await prisma.payment_details.findFirst({
            where: {
                user_id: BigInt(user.user_id),
                pd_id: Number(req.body.id)
            }
        });

        if (!paymentDetail) {
            return res.status(404).json({
                status: false,
                message: "No payment details found for the provided id."
            });
        }

        // -------------------- IFSC required for India --------------------
        if (
            paymentDetail.bank_account_country === "india" &&
            !req.body.ifsc_code
        ) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    ifsc_code: ["The IFSC code is mandatory for bank accounts in India."]
                }
            });
        }

        // -------------------- UNIQUE account_number CHECK --------------------
        const existingAccount = await prisma.payment_details.findFirst({
            where: {
                account_number: req.body.account_number,
                NOT: { pd_id: Number(req.body.id) } // ignore current record
            }
        });

        if (existingAccount) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    account_number: ["account_number already exists"]
                }
            });
        }

        // -------------------- START TRANSACTION --------------------
        await prisma.$transaction(async (tx) => {
            await tx.payment_details.update({
                where: { pd_id: Number(req.body.id) },
                data: {
                    account_type: req.body.account_type,
                    bank_name: req.body.bank_name,
                    account_holder_name: req.body.account_holder_name,
                    custom_bank_details: req.body.custom_bank_details || null,
                    ifsc_code: req.body.ifsc_code || null,
                    account_number: req.body.account_number,
                    swift_bic_code: req.body.swift_bic_code || null,
                    residence_country: req.body.residence_country || null,
                    state_region: req.body.state_region || null,
                    city: req.body.city || null,
                    zip_code: req.body.zip_code || null,
                    address: req.body.address || null,
                    status: "pending"
                }
            });

            // Create notification
          const notification  =  await tx.notifications.create({
                data: {
                    user_id: user.user_id,
                    title: "Bank payment details updated.",
                    message: "You have successfully updated your bank payment details.",
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()

                }
            });
        io.to(notification.user_id.toString()).emit("new_notification", notification);

        });

        return res.status(200).json({
            status: true,
            message: "Bank payment details updated successfully."
        });

    } catch (err) {
        console.log("updatePaymentDetails ERROR:: ", err);

        return res.status(500).json({
            status: false,
            message: "Unable to update bank payment details.",
            errors: err.message
        });
    }
};


export const updateIsPrimary = async (req, res) => {
    const user = req.user;

    try {
        // ---------------- VALIDATION ----------------
        const { method, id } = req.body;

        if (!method || !["bank", "upi"].includes(method)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { method: ["method must be bank or upi"] },
            });
        }

        if (!id || isNaN(id)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { id: ["id must be a valid number"] },
            });
        }

        // ---------------- TRANSACTION ----------------
        await prisma.$transaction(async (tx) => {
            if (method === "bank") {
                const exists = await tx.payment_details.findFirst({
                    where: {
                        user_id: BigInt(user.user_id),
                        pd_id: Number(id),
                    },
                });

                if (!exists) {
                    throw new Error(`No ${method.charAt(0).toUpperCase() + method.slice(1)} details found with provided id.`);
                }

                await tx.payment_details.updateMany({
                    where: { user_id: BigInt(user.user_id) },
                    data: { is_primary: false }
                });

                await tx.payment_details.updateMany({
                    where: {
                        user_id: BigInt(user.user_id),
                        pd_id: Number(id)
                    },
                    data: { is_primary: true }
                });
            }

            else if (method === "upi") {
                const exists = await tx.upi_details.findFirst({
                    where: {
                        user_id: BigInt(user.user_id),
                        id: Number(id),
                    },
                });

                if (!exists) {
                    throw new Error(`No Upi details found with provided id.`);
                }

                await tx.upi_details.updateMany({
                    where: { user_id: user.user_id },
                    data: { is_primary: false }
                });

                await tx.upi_details.updateMany({
                    where: { user_id: user.user_id, id: Number(id) },
                    data: { is_primary: true }
                });
            }

            else {
                throw new Error(`Invalid payment method : ${method}`);
            }
        });

        return res.status(200).json({
            status: true,
            message: `The selected ${method.charAt(0).toUpperCase() + method.slice(1)} account has been successfully set as primary.`,
        });

    } catch (err) {
        return res.status(500).json({
            status: false,
            message: `Unable to set the selected ${req.body.method ? req.body.method.charAt(0).toUpperCase() + req.body.method.slice(1) : ""} account as primary.`,
            errors: err.message,
        });
    }
};

export const updateUpiDetails = async (req, res) => {
    const user = req.user; // From auth middleware
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ status: false, message: "Validation failed", errors: errors.array() });
    }

    const { id, upi_name, upi_id, caption, is_primary } = req.body;

    try {
        // Check if UPI detail exists for this user
        const upi = await prisma.upi_details.findFirst({
            where: { id: Number(id), user_id: BigInt(user.user_id) },
        });

        if (!upi) {
            return res.status(404).json({ status: false, message: "No UPI details found for this user." });
        }

        // If is_primary is true, reset previous primary UPI
        if (is_primary) {
            await prisma.upi_details.updateMany({
                where: { user_id: BigInt(user.user_id), is_primary: true },
                data: { is_primary: false },
            });
        }

        // Update UPI details
        await prisma.upi_details.update({
            where: { id: Number(id) },
            data: {
                upi_name: upi_name.trim(),
                upi_id: upi_id.trim(),
                caption: caption || null,
                is_primary: !!is_primary,
            },
        });

        return res.status(200).json({ status: true, message: "UPI details updated successfully." });
    } catch (error) {
        console.error("❌ ERROR =>", error);
        return res.status(500).json({ status: false, message: "Unable to update UPI details.", errors: error.message });
    }
};


export const deleteMethod = async (req, res) => {
    try {
        const user = req.user;

        // Read from query instead of body
        const method = (req.query.method || "").toLowerCase();
        const id = Number(req.query.id);

        if (!method || !["bank", "upi"].includes(method)) {
            return res.status(422).json({ status: false, message: "Invalid method" });
        }
        if (!id) {
            return res.status(422).json({ status: false, message: "Invalid id" });
        }

        if (method === "bank") {
            const exists = await prisma.payment_details.findFirst({
                where: { user_id: BigInt(user.user_id), pd_id: BigInt(id) },
            });
            if (!exists) throw new Error("No Bank details found with provided id.");

            await prisma.payment_details.delete({ where: { pd_id: BigInt(id) } });
        } else if (method === "upi") {
            const exists = await prisma.upi_details.findFirst({
                where: { user_id: BigInt(user.user_id), id: BigInt(id) },
            });
            if (!exists) throw new Error("No UPI details found with provided id.");

            await prisma.upi_details.delete({ where: { id: BigInt(id) } });
        }

        return res.status(200).json({
            status: true,
            message: `${method.charAt(0).toUpperCase() + method.slice(1)} Payment method deleted successfully.`,
        });
    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to delete payment method.",
            errors: error.message || error,
        });
    }
};
