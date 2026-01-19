import prisma from '../../config/prismaClient.js';
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import fs from "fs";
import path from "path";
import multer from "multer";
import moment from 'moment';

const storageDir = path.join("storage", "app", "public", "images", "webside", "admin");
fs.mkdirSync(storageDir, { recursive: true });

// ✅ Multer config (Laravel-style)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storageDir),
  filename: (req, file, cb) => {
    const adminId = req.admin?.id || "unknown";
    const timestamp = moment().format("DDMMYYYYHHmm");
    const ext = path.extname(file.originalname);
    cb(null, `${adminId}_${timestamp}${ext}`);
  },
});



export const uploadMultiple = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only jpeg, png, jpg files are allowed"));
    }
    cb(null, true);
  },
}).fields([
  { name: "logo", maxCount: 1 },
  { name: "favicon", maxCount: 1 },
]);


export const updateNameUrlTitle = async (req, res) => {
  const admin = req.admin;
  const { name, url, title } = req.body;

  try {
    if (!name && !url && !title) {
      return res.status(422).json({
        status: false,
        message: 'Validation failed',
        errors: { fields: ['At least one field is required.'] },
      });
    }

    const websiteDetails = await prisma.website_details.findUnique({
      where: { website_details_id: 1 },
    });

    if (!websiteDetails) {
      return res.status(404).json({
        status: false,
        message: 'Website details not found.',
      });
    }

    // ✅ Prepare updatable data
    const updateData = {};
    if (name) updateData.website_name = name;
    if (url) updateData.website_url = url;
    if (title) updateData.website_title = title;

    // Store who updated (optional)
    updateData.updated_by = JSON.stringify(admin || {});

    // ✅ Update record
    await prisma.website_details.update({
      where: { website_details_id: 1 },
      data: updateData,
    });

    return res.status(200).json({
      status: true,
      message: 'Website details have been updated successfully.',
    });

  } catch (error) {
    console.error('Error updating website details:', error);
    return res.status(500).json({
      status: false,
      message: 'Unable to update the setting.',
      errors: error.message,
    });
  }
};

export const getWebsiteDetails = async (req, res) => {
  try {
    const websiteDetails = await prisma.website_details.findUnique({
      where: { website_details_id: BigInt(1) },
      select: {
        website_details_id: true,
        website_name: true,
        website_url: true,
        website_title: true,
        updated_by: true,
        logo_image: true,
        favicon_image: true,
        created_at: true,
        updated_at: true,

      },
    });

    if (!websiteDetails) {
      return res.status(404).json({
        status: false,
        message: 'Website details not found.',
      });
    }
    const safeData = convertBigIntToString(websiteDetails);

    return res.status(200).json({
      status: true,
      message: 'Website details fetched successfully.',
      data: safeData,
    });

  } catch (error) {
    console.error('Error fetching website details:', error);
    return res.status(500).json({
      status: false,
      message: 'Unable to fetch website details.',
      errors: error.message,
    });
  }
};

export const updateLogoFavicon = async (req, res) => {
  try {
    const admin = req.admin; // assuming middleware sets admin info
    const files = req.files;
    const updatableFields = ["logo", "favicon"];

    // ✅ Validation: at least one image required
    if (!files.logo && !files.favicon) {
      return res.status(422).json({
        status: false,
        message: "At least one field (logo or favicon) is required.",
      });
    }

    // 🔹 Get existing website details
    const websiteDetails = await prisma.website_details.findFirst({
      where: { website_details_id: BigInt(1) },
    });

    const operation = websiteDetails ? "update" : "add";

    // 🔹 Delete old images if new ones are uploaded
    if (websiteDetails) {
      for (const field of updatableFields) {
        if (files[field]) {
          const currentPath = websiteDetails[`${field}_image`];
          if (currentPath && !currentPath.startsWith("http")) {
            const fullPath = path.join("public", currentPath);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          }
        }
      }
    }

    const data = {};
    for (const field of updatableFields) {
      if (files[field]) {
        const imageFile = files[field][0];
        const baseUrl = process.env.APP_URL
        const relativePath = `storage/images/webside/admin/${imageFile.filename}`;
        const fullImageUrl = `${baseUrl}/${relativePath}`;
        data[`${field}_image`] = fullImageUrl;
      }
    }

    data.updated_by = JSON.stringify({
      id: admin?.admin_id || null,
      name: admin?.name || "Admin",
    });

    // 🔹 Create or update record
    await prisma.website_details.upsert({
      where: { website_details_id: 1 },
      update: data,
      create: { website_details_id: 1, ...data },
    });

    return res.status(operation === "add" ? 201 : 200).json({
      status: true,
      message: `Images ${operation === "add" ? "added" : "updated"} successfully.`,
    });
  } catch (error) {
    console.error("Error updating logo/favicon:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to update images.",
      error: error.message,
    });
  }
};