// authMiddleware.js
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export const authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ status: false, message: "No token provided" });
        }
        const token = authHeader.split(" ")[1]; // Bearer <token>
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
        // Validate payload
        if (!decoded.adminId) {
            return res.status(401).json({
                status: false,
                message: "Invalid token payload",
            });
        }
        const currentToken = await prisma.personal_access_tokens.findFirst({
            where: {
                tokenable_type: "admin",
                tokenable_id: decoded.userId,
                token: token,
            },
        });
        console.log(currentToken);
        if (!currentToken) {
            return res.status(401).json({ status: false, message: "admin is not authenticated" });
        }
        const admins = await prisma.admins.findUnique({
            where: { admin_id: BigInt(decoded.adminId) },
            select: {
                admin_id: true,
                name: true,
                email: true,
                phone_number: true,
                role: true,
                profile_image: true,
                user_status: true,
                created_at: true,
                permissions: true
            }
        });
        if (!admins) {
            return res.status(401).json({
                status: false,
                message: "Admin not found"
            });
        }
        // Set admin info on request
        req.admin = {
            admin_id: decoded.adminId,
            role: admins.role,
            token: token,
            permissions: admins.permissions
        };
        next();
    }
    catch (err) {
        return res.status(401).json({
            status: false,
            message: "Unauthorized",
            errors: err.message,
        });
    }
};
export const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader)
            return res.status(401).json({ status: false, message: "No token provided" });
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
        // Validate token payload
        if (!decoded.userId) {
            return res.status(401).json({
                status: false,
                message: "Invalid token payload",
            });
        }
        const currentToken = await prisma.personal_access_tokens.findFirst({
            where: {
                tokenable_type: "users",
                tokenable_id: BigInt(decoded.userId),
                token: token, // JWT from request
            },
        });
        if (!currentToken) {
            return res.status(401).json({ status: false, message: "User is not authenticated" });
        }
        const loginDetail = await prisma.user_login_details.findFirst({
            where: { user_id: BigInt(decoded.userId), token_id: currentToken.id.toString(), login_status: "login" },
        });
        if (!loginDetail) {
            return res.status(401).json({ status: false, message: "User is not authenticated" });
        }
        const users = await prisma.users.findUnique({
            where: { user_id: BigInt(decoded.userId) },
            select: {
                user_id: true,
                password: true,
                email: true,
                email_verified_at: true,
                address_verified_at: true,
            }
        });
        if (!users) {
            return res.status(401).json({
                status: false,
                message: "Admin not found"
            });
        }
        req.user = {
            user_id: Number(decoded.userId),
            email: users.email,
            email_verified_at: users.email_verified_at || null,
            password: users.password,
            token,
            tokenId: loginDetail.token_id
        };
        next();
    }
    catch (err) {
        console.log(err);
        return res.status(401).json({ status: false, message: "Invalid token" });
    }
};
