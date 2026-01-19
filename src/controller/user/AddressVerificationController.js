import { convertBigIntToString } from "../../config/convertBigIntToString.js";
import prisma from "../../config/prismaClient.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";

dayjs.extend(relativeTime);
export const addressVerification = async (req, res) => {
    try {
        const user = req.user;

        if (!user.email_verified_at) {
            return res.status(403).json({
                status: false,
                message: "Please verify your email before proceeding.",
            });
        }

        // Check if already submitted
        const existing = await prisma.address_verifications.findFirst({
            where: { user_id: user.user_id },
        });

        if (existing) {
            if (existing.status === "verified") {
                return res.json({
                    status: true,
                    message: "You have already verified your address.",
                });
            }
            if (existing.status === "pending") {
                return res.json({
                    status: true,
                    message: "Your address verification is still pending.",
                });
            }
        }

        // Validate fields (Node.js validation)
        const {
            doc,
            country,
            state,
            city,
            address1,
            address2,
            zip,
        } = req.body;

        if (!doc || !["bank statement", "credit card", "electricity bill", "utility bill"].includes(doc.trim().toLowerCase())) {
            return res.status(422).json({ status: false, message: "Invalid doc type" });
        }

        if (!req.files || !req.files.front_document) {
            return res.status(422).json({ status: false, message: "Front document is required" });
        }

        // Multer already saved files
        const frontFile = req.files.front_document[0];
        const backFile = req.files.back_document?.[0];

        // Store only paths used in DB (like Laravel)
        const frontPath = `images/doc_file/${frontFile.filename}`;
        const backPath = backFile ? `images/doc_file/${backFile.filename}` : null;

        // Save in Prisma DB
        await prisma.address_verifications.create({
            data: {
                user_id: BigInt(user.user_id),
                doc_type: doc,
                residence_country: country,
                residence_State: state,
                residence_city: city,
                address_line1: address1,
                address_line2: address2 || null,
                residence_zip: zip,
                document_front_image: frontPath,
                document_back_image: backPath,
                status: "pending",
                created_at: new Date(),
            },
        });

        return res.json({
            status: true,
            message: "Details stored successfully for address verification.",
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: "Unable to store the details for address verification.",
            errors: error.message,
        });
    }
};

export const getAddressVerification = async (req, res) => {
    try {
        const user = req.user; // Logged-in user from middleware

        if (!user) {
            return res.status(401).json({
                status: false,
                message: "User not authenticated",
            });
        }

        // ✅ Fetch latest address verification by addVer_id DESC
        const addressDetails = await prisma.address_verifications.findFirst({
            where: { user_id: BigInt(user.user_id) },
            orderBy: { addVer_id: "desc" },
        });

        let data = {};

        if (addressDetails) {
            // Laravel asset("storage/...") equivalent:
            const baseUrl = `${req.protocol}://${req.get("host")}`;

            const frontImage = addressDetails.document_front_image
                ? `${baseUrl}/storage/${addressDetails.document_front_image}`
                : null;

            const backImage = addressDetails.document_back_image
                ? `${baseUrl}/storage/${addressDetails.document_back_image}`
                : null;

            data = {
                addVer_id: addressDetails.addVer_id,
                user_id: addressDetails.user_id,
                doc_type: addressDetails.doc_type,
                residence_country: addressDetails.residence_country,
                residence_State: addressDetails.residence_State,
                residence_city: addressDetails.residence_city,
                address_line1: addressDetails.address_line1,
                address_line2: addressDetails.address_line2,
                residence_zip: addressDetails.residence_zip,
                document_front_image: frontImage,
                document_back_image: backImage,
                status: addressDetails.status,
                remark: addressDetails.remark,
                created_at: addressDetails.created_at,
                duration: addressDetails.created_at
                    ? moment(addressDetails.created_at).fromNow()
                    : null,
            };
        }
        const safeData = convertBigIntToString(data)

        return res.status(200).json({
            status: true,
            message: "Address verification details retrieved successfully",
            address_verification_status: addressDetails?.status ?? null,
            address_data: safeData,
        });
    } catch (e) {
        return res.status(500).json({
            status: false,
            message: "Unable to retrieve address verification details.",
            errors: e.message,
        });
    }
};



export const storeAddress = async (req, res) => {
    let tx;
    console.log(req.body)
    try {
        const user = req.user; // coming from auth middleware
        // enum mapping (frontend -> prisma)
        const idTypeMap = {
            "passport": "passport",
            "driving licence": "driving_licence",
            "id card": "id_card"
        };

        // normalize input
        const userIdType = req.body.id_type?.toLowerCase()?.trim();

        // check valid
        if (!idTypeMap[userIdType]) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    id_type: ["id_type must be passport, driving licence, or id card"]
                },
            });
        }

        req.body.id_type = idTypeMap[userIdType]; // convert for Prisma


        // ---------------- Email Verification Check ----------------
        if (!user.email_verified_at) {
            return res.status(403).json({
                status: false,
                message: "Please verify your email before proceeding.",
            });
        }

        // ---------------- Find Existing Address ----------------
        const existingAddress = await prisma.addresses.findFirst({
            where: { user_id: user.user_id },
        });

        if (existingAddress) {
            if (user.id_verified_at || existingAddress.status === "verified") {
                return res.status(200).json({
                    status: true,
                    message: "You have already verified your ID.",
                });
            }

            if (existingAddress.status === "pending") {
                return res.status(200).json({
                    status: true,
                    message: "Your ID verification is still pending.",
                });
            }
        }

        // ---------------- Validation ----------------
        const requiredFields = [
            "issuing_country",
            "id_type",
            "residence_country",
            "residence_state",
            "residence_city",
            "address_line1",
            "residence_zip",
        ];

        for (const field of requiredFields) {
            if (!req.body[field]) {
                return res.status(422).json({
                    status: false,
                    message: "Validation failed.",
                    errors: { [field]: [`${field} is required`] },
                });
            }
        }

        const validIdTypes = ["passport", "driving licence", "id card"];
        req.body.id_type = req.body.id_type?.toLowerCase();

        if (!validIdTypes.includes(req.body.id_type)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    id_type: ["id_type must be passport, driving licence, or id card"],
                },
            });
        }

        // ---------------- File Validation ----------------
        if (!req.files.document_front_image || !req.files.document_back_image) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    images: ["Front and back images are required"],
                },
            });
        }

        const frontImage = req.files.document_front_image[0].filename;
        const backImage = req.files.document_back_image[0].filename;

        // ---------------- Transaction ----------------
        tx = await prisma.$transaction(async (tx) => {
            await tx.addresses.create({
                data: {
                    user_id: user.user_id,
                    issuing_country: req.body.issuing_country,
                    id_type: req.body.id_type,
                    residence_country: req.body.residence_country,
                    residence_State: req.body.residence_state,
                    residence_city: req.body.residence_city,
                    address_line1: req.body.address_line1,
                    address_line2: req.body.address_line2 || null,
                    residence_zip: req.body.residence_zip,
                    document_front_image: `images/id_image/${frontImage}`,
                    document_back_image: `images/id_image/${backImage}`,
                    status: "pending",
                },
            });

        const notification  =  await tx.notifications.create({
                data: {
                    user_id: user.user_id,
                    title: "Id verification successfully initiated.",
                    message:
                        "You have successfully added your address details. It will verify in sometime. Please wait.",
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()
                },
            });
          io.to(notification.user_id.toString()).emit("new_notification", notification);

        });

        return res.status(201).json({
            status: true,
            message: "Address added successfully.",
        });
    } catch (err) {
        console.log("storeAddress ERROR:: ", err);

        return res.status(500).json({
            status: false,
            message: "Unable to add address.",
            errors: err.message,
        });
    }
};

export const getIdDetails = async (req, res) => {
    try {
        const user = req.user; // from auth middleware

        // -------- Fetch Latest ID Record --------
        const idData = await prisma.addresses.findFirst({
            where: { user_id: BigInt(user.user_id) },
            orderBy: { address_id: "desc" },
        });

        let data = {};

        if (idData) {
            // Build absolute URLs
            const frontImageUrl = `${req.protocol}://${req.get("host")}/storage/${idData.document_front_image}`;
            const backImageUrl = `${req.protocol}://${req.get("host")}/storage/${idData.document_back_image}`;

            data = {
                address_id: idData.address_id,
                issuing_country: idData.issuing_country,
                id_type: idData.id_type,
                residence_country: idData.residence_country,
                residence_state: idData.residence_state,
                residence_city: idData.residence_city,
                address_line1: idData.address_line1,
                address_line2: idData.address_line2,
                residence_zip: idData.residence_zip,
                document_front_image: frontImageUrl,
                document_back_image: backImageUrl,
                status: idData.status,
                created_at: idData.created_at,
                duration: dayjs(idData.created_at).fromNow(),
            };
        }
        const safeData = convertBigIntToString(data)
        return res.status(200).json({
            status: true,
            message: "Address details retrieved successfully",
            id_verification_status: idData?.status || null,
            id_data: safeData,
        });
    } catch (err) {
        console.log("getIdDetails ERROR :: ", err);

        return res.status(500).json({
            status: false,
            message: "Unable to retrieve address details",
            errors: err.message,
        });
    }
};