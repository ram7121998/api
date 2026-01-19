// adminController.js
import bcrypt from "bcryptjs";
import prisma from "../../config/prismaClient.js";
import path from "path";
import fs from "fs";
export const adminDetail = async (req, res) => {
    try {
        const adminId = req.admin?.admin_id; // Assuming admin is attached to req
        if (!adminId) {
            return res.status(404).json({
                status: false,
                message: "Unable to fetch admin details",
            });
        }
        // Fetch admin from Prisma
        const admin = await prisma.admins.findUnique({
            where: { admin_id: BigInt(adminId) },
        });
        if (!admin) {
            return res.status(404).json({
                status: false,
                message: "Admin not found",
            });
        }
        // Prepare response data
        const data = getAdminDetails(admin);
        return res.status(200).json({
            status: true,
            message: "Admin details fetched successfully",
            data,
        });
    }
    catch (err) {
        console.error("Admin detail fetch failed:", err);
        return res.status(500).json({
            status: false,
            message: "Unable to fetch admin details",
            errors: err.message,
        });
    }
};
// Helper function to format admin data
const getAdminDetails = (admin) => {
    // let profileImage = admin.profile_image;
    // if (profileImage && !/^https?:\/\//i.test(profileImage)) {
    //   profileImage = `${process.env.BASE_URL || "http://localhost:3000"}/storage/${profileImage}`;
    // }
    return {
        admin_id: admin.admin_id.toString(), // convert BigInt to string
        name: admin.name,
        email: admin.email,
        phone_number: admin.phone_number,
        profile_image: admin.profile_image,
        role: admin.role,
        login_with: admin.login_with,
        login_status: admin.login_status,
        login_count: admin.login_count,
        last_login: admin.last_login,
        logged_in_device: admin.logged_in_device,
        loggedIn_device_ip: admin.loggedIn_device_ip,
        admin_status: admin.user_status,
        permissions: admin.permissions,
    };
};
export const getAllAdmin = async (req, res) => {
    try {
        // 1. Analytics: count admins by role
        const allAdmins = await prisma.admins.findMany();
        const roleCounts = allAdmins.reduce((acc, admin) => {
            if (admin.role === "super_admin")
                acc.super_admin += 1;
            else if (admin.role === "admin")
                acc.admin += 1;
            else if (admin.role === "sub_admin")
                acc.sub_admin += 1;
            return acc;
        }, { super_admin: 0, admin: 0, sub_admin: 0 });
        // 2. Filtering by role
        const roleFilter = req.query.role || undefined;
        // 3. Pagination
        const perPage = parseInt(req.query.per_page) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * perPage;
        const where = roleFilter ? { role: roleFilter } : {};
        const [admins, total] = await Promise.all([
            prisma.admins.findMany({
                where,
                skip,
                take: perPage,
                orderBy: { admin_id: "asc" },
            }),
            prisma.admins.count({ where }),
        ]);
        // 4. Format admin data
        const formattedAdmins = admins.map((admin) => getAdminDetails(admin));
        // 5. Prepare pagination info
        const pagination = {
            current_page: page,
            per_page: perPage,
            total,
            last_page: Math.ceil(total / perPage),
        };
        // 6. Return response
        return res.status(200).json({
            status: true,
            message: "All admin fetched successfully.",
            data: formattedAdmins,
            pagination,
            analytics: {
                totalAllAdmin: roleCounts.super_admin + roleCounts.admin + roleCounts.sub_admin,
                totalSuperAdmin: roleCounts.super_admin,
                totalAdmin: roleCounts.admin,
                totalSubAdmin: roleCounts.sub_admin,
            },
        });
    }
    catch (err) {
        console.error("Error fetching all admins:", err);
        return res.status(500).json({
            status: false,
            message: "Something went wrong while fetching all admin's details.",
            errors: err.message,
        });
    }
};
export const changePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { message: "current_password and new_password are required" },
            });
        }
        // ✅ Fetch admin with password
        const admin = await prisma.admins.findUnique({
            where: { admin_id: BigInt(req.admin.admin_id) }, // 👈 use correct unique field
            select: { admin_id: true, password: true }, // ensure password is included
        });
        if (!admin) {
            return res.status(404).json({
                status: false,
                message: "Admin not found",
            });
        }
        // Check current password
        const validPassword = await bcrypt.compare(current_password, admin.password);
        if (!validPassword) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { current_password: ["Invalid current password."] },
            });
        }
        // Password validation
        if (new_password.length < 8) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { new_password: ["The password must be at least 8 characters."] },
            });
        }
        if (!/[A-Z]/.test(new_password)) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { new_password: ["The password must contain at least one Uppercase letter."] },
            });
        }
        if (!/[a-z]/.test(new_password)) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { new_password: ["The password must contain at least one lowercase letter."] },
            });
        }
        if (!/[0-9]/.test(new_password)) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { new_password: ["The password must contain at least one number."] },
            });
        }
        if (!/[!@#$%^&*(),.?":{}|<>_]/.test(new_password)) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { new_password: ["The password must contain at least one special character."] },
            });
        }
        // Check if same as current
        const isSame = await bcrypt.compare(new_password, admin.password);
        if (isSame) {
            return res.status(422).json({
                status: false,
                message: "validation failed",
                errors: { new_password: ["The new password can not be the same as the current password."] },
            });
        }
        // Update password
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await prisma.admins.update({
            where: { admin_id: admin.admin_id },
            data: { password: hashedPassword },
        });
        return res.status(200).json({
            status: true,
            message: "Password changed successfully!",
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
export const updateProfile = async (req, res) => {
    const admin = req.admin; // set by middleware
    if (!admin) {
        return res.status(401).json({
            status: false,
            message: "Admin not authenticated",
        });
    }
    try {
        const { name, email } = req.body;
        const imageFile = req.file;
        // 🧩 Validation
        if (!name || !email || !imageFile) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: {
                    name: !name ? "Name is required" : undefined,
                    email: !email ? "Email is required" : undefined,
                    profile_image: !imageFile ? "Profile image is required" : undefined,
                },
            });
        }
        // ✅ Check if email already exists (unique check)
        const existingAdmin = await prisma.admins.findFirst({
            where: {
                email,
                NOT: { admin_id: admin.admin_id },
            },
        });
        if (existingAdmin) {
            return res.status(422).json({
                status: false,
                message: "Email already in use.",
            });
        }
        // 🧹 Delete old image (if exists)
        if (admin.profile_image) {
            // Convert full URL → relative path
            const oldRelative = admin.profile_image.replace(`${process.env.APP_URL}/storage/`, "");
            const oldPath = path.join("storage", "app", "public", oldRelative);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }
        // Save only relative path
        const relativePath = path
            .join("images", "profile_image", imageFile.filename)
            .replace(/\\/g, "/");
        // 🔗 Create full URL for database
        const fullImageUrl = `${process.env.APP_URL}/storage/${relativePath}`;
        // Update database
        await prisma.admins.update({
            where: { admin_id: admin.admin_id },
            data: {
                name,
                email,
                profile_image: fullImageUrl, // save only relative path
            },
        });
        return res.status(200).json({
            status: true,
            message: "Admin profile updated successfully.",
            profile_imageUrl: fullImageUrl,
        });
    }
    catch (error) {
        console.error("Error updating profile:", error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: error.message,
        });
    }
};
