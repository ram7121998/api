import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export const checkUserStatus = async (req, res, next) => {
    try {
        const userId = req.user?.user_id;
        if (!userId) {
            return res.status(401).json({
                status: false,
                message: "Unauthenticated",
            });
        }
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(userId) },
            select: { user_status: true },
        });
        if (!user)
            return res.status(404).json({ status: false, message: "User not found" });
        if (user.user_status.toLowerCase() !== "active") {
            const message = user.user_status === "block" ? "Blocked" : "Terminated";
            return res.status(403).json({
                status: false,
                message: `User is ${message}. Please contact support.`,
            });
        }
        next();
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong",
            error: err.message,
        });
    }
};
