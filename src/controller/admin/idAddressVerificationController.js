import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import prisma from '../../config/prismaClient.js';
import { convertBigIntToString } from '../../config/convertBigIntToString.js';



dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);



export const getAddressVerificationDetails = async (req, res) => {
  try {
    const perPage = parseInt(req.query.per_page) || 10;
    const page = parseInt(req.query.page) || 1;
    const { user_id, status, residence_country } = req.query;

    // Base query
    let whereClause = {};
    if (user_id) whereClause.user_id = Number(user_id);
    if (status) whereClause.status = status;
    if (residence_country) whereClause.residence_country = String(residence_country);


    // Analytics
    const totalAddressVerification = await prisma.address_verifications.count();
    const totalPending = await prisma.address_verifications.count({ where: { status: "pending" } });
    const totalVerified = await prisma.address_verifications.count({ where: { status: "verified" } });
    const totalRejected = await prisma.address_verifications.count({ where: { status: "reject" } });
    const totalFilteredData = await prisma.address_verifications.count({ where: whereClause });

    // Pagination & Fetch
    const addressDetails = await prisma.address_verifications.findMany({
      where: whereClause,
      orderBy: { addVer_id: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    // Format images and duration
    const formattedDetails = addressDetails.map((item) => ({
      ...item,
      document_front_image: item.document_front_image
        ? `${process.env.APP_URL}/storage/${item.document_front_image}`
        : null,
      document_back_image: item.document_back_image
        ? `${process.env.APP_URL}/storage/${item.document_back_image}`
        : null,
      duration: dayjs(item.created_at).tz("Asia/Kolkata").fromNow(), // like diffForHumans
    }));

    // Pagination metadata
    const pagination = {
      current_page: page,
      per_page: perPage,
      total: totalFilteredData,
      last_page: Math.ceil(totalFilteredData / perPage),
      from: (page - 1) * perPage + 1,
      to: (page - 1) * perPage + formattedDetails.length,
    };
    const safeData = convertBigIntToString(formattedDetails);
    return res.status(200).json({
      status: true,
      message: "Address verification details fetched successfully.",
      data: safeData,
      pagination,
      analytics: {
        total_address_verification: totalAddressVerification,
        total_pending: totalPending,
        total_verified: totalVerified,
        total_rejected: totalRejected,
        total_filtered_data: totalFilteredData,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to fetch the address verification details.",
      errors: error.message,
    });
  }
};

export const getIdVerificationDetails = async (req, res) => {
  try {
    const perPage = parseInt(req.query.per_page) || 10;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * perPage;

    const filters = {};
    if (req.query.user_id) filters.user_id = Number(req.query.user_id);
    if (req.query.status) filters.status = req.query.status;
        if (req.query.residence_country) filters.residence_country = req.query.residence_country;


    // Total counts
    const totalIdVerification = await prisma.addresses.count();
    const totalPending = await prisma.addresses.count({ where: { status: "pending" } });
    const totalVerified = await prisma.addresses.count({ where: { status: "verified" } });
    const totalRejected = await prisma.addresses.count({ where: { status: "reject" } });

    // Filtered count
    const totalFilteredData = await prisma.addresses.count({ where: filters });

    // Paginated data
    const idDetailsRaw = await prisma.addresses.findMany({
      where: filters,
      orderBy: { address_id: "desc" },
      skip,
      take: perPage,
    });

    // Format data (images + duration)
    const BASE_URL = process.env.BASE_URL || "https://api.onnbit.com"; // set your API base URL
    const idDetails = idDetailsRaw.map(item => ({
      ...item,
      document_front_image: item.document_front_image ? `${BASE_URL}/storage/${item.document_front_image}` : null,
      document_back_image: item.document_back_image ? `${BASE_URL}/storage/${item.document_back_image}` : null,
      duration: dayjs(item.created_at).fromNow(),
    }));

    // Pagination object
    const pagination = {
      current_page: page,
      per_page: perPage,
      total: totalFilteredData,
      last_page: Math.ceil(totalFilteredData / perPage),
      from: skip + 1,
      to: skip + idDetails.length,
    };
    const safeData = convertBigIntToString(idDetails);
    return res.status(200).json({
      status: true,
      message: "ID verification details fetched successfully.",
      data: safeData,
      pagination,
      analytics: {
        total_id_verification: totalIdVerification,
        total_pending: totalPending,
        total_verified: totalVerified,
        total_rejected: totalRejected,
        total_filtered_data: totalFilteredData,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to fetch the id verification details.",
      errors: error.message,
    });
  }
};


export const verifyAddress = async (req, res) => {
  try {
    const { id, status, remark } = req.body;

    // Validation
    if (!id || isNaN(id)) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: { id: ["The id field is required and must be numeric."] },
      });
    }


    if (!["pending", "verified", "reject"].includes(status)) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: { status: ["The status must be pending, verified, or reject."] },
      });
    }
    if (status === "pending") {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: { status: ["Pending status cannot be updated."] },
      });
    }


    if (status === "reject" && (!remark || remark.trim() === "")) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: { remark: ["The remark field is required when status is reject."] },
      });
    }

    // Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      const addressVerificationDetails = await tx.address_verifications.findUnique({
        where: { addVer_id: Number(id) },
      });

      if (!addressVerificationDetails) {
        throw new Error("No Id details found for the given id.");
      }

      const finalRemark = remark || "Address Verified.";

      await tx.address_verifications.update({
        where: { addVer_id: Number(id) },
        data: {
          status: status,
          remark: finalRemark,
        },
      });

      // Update user table
      if (status === "verified") {
        await tx.users.update({
          where: { user_id: addressVerificationDetails.user_id },
          data: { address_verified_at: new Date() },
        });
      } else {
        await tx.users.update({
          where: { user_id: addressVerificationDetails.user_id },
          data: { address_verified_at: null },
        });
      }

      const title =
        status === "verified"
          ? "Address verified successfully"
          : "Address verification rejected";

      const message =
        status === "verified"
          ? "Your address is successfully verified."
          : finalRemark;

  const notification  =  await tx.notifications.create({
        data: {
          user_id: addressVerificationDetails.user_id,
          title: title,
          message: message,
          type: "account_activity",
          is_read: false,
          created_at: new Date()

        },
      });
    io.to(notification.user_id.toString()).emit("new_notification", notification);

    });

    return res.status(200).json({
      status: true,
      message: "Address verification status updated successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to verify the address verification.",
      errors: error.message,
    });
  }
};

export const verifyId = async (req, res) => {
  const admin = req.admin; // assuming middleware sets admin user

  try {
    const { id, status, remark } = req.body;

    // 🔹 Validate request
    if (!id || isNaN(id)) {
      return res.status(422).json({ status: false, message: 'Invalid or missing ID' });
    }

    if (!['pending', 'verified', 'reject'].includes(status)) {
      return res.status(422).json({ status: false, message: 'Invalid status value' });
    }

    if (status === "pending") {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: { status: ["Pending status cannot be updated."] },
      });
    }

    if (status === 'reject' && (!remark || remark.trim() === '')) {
      return res.status(422).json({ status: false, message: 'Remark is required when status is reject' });
    }

    // 🔹 Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      const idDetails = await tx.addresses.findUnique({
        where: { address_id: Number(id) },
      });

      if (!idDetails) {
        throw new Error('No Id details found for the given id.');
      }

      const updateRemark = remark || 'ID Verified.';

      // 🔹 Update address status & remark
      await tx.addresses.update({
        where: { address_id: Number(id) },
        data: {
          status,
          remark: updateRemark,
        },
      });

      // 🔹 Update user verification date
      await tx.users.update({
        where: { user_id: idDetails.user_id },
        data: {
          id_verified_at: status === 'verified' ? new Date() : null,
        },
      });

      // 🔹 Notification
      const title =
        status === 'verified'
          ? 'ID verified successfully'
          : 'ID verification rejected';

      const message =
        status === 'verified'
          ? 'Your ID is successfully verified. Now you can trade and create wallet.'
          : updateRemark;

     const notification = await tx.notifications.create({
        data: {
          user_id: idDetails.user_id,
          title,
          message,
          type: 'account_activity',
          is_read: false,
          created_at: new Date()

        },
      });
       io.to(notification.user_id.toString()).emit("new_notification", notification);


      return true;
    });

    return res.status(200).json({
      status: true,
      message: 'Id verification status updated successfully.',
    });
  } catch (err) {
    console.error('verifyId error:', err);
    return res.status(500).json({
      status: false,
      message: 'Unable to verify the id.',
      errors: err.message,
    });
  }
};