import prisma from "../../config/prismaClient.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import crypto from "crypto";

dayjs.extend(relativeTime);

export const getAllNotifications = async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                status: false,
                message: "User not found",
            });
        }

        // ─────────────────────────────────────────────
        // DATE FILTERS
        // ─────────────────────────────────────────────
        let startDate = null;
        let endDate = null;

        if (req.query.start_date) {
            startDate = dayjs(req.query.start_date, "DD-MM-YYYY").startOf("day").toDate();
        }

        if (req.query.end_date) {
            endDate = dayjs(req.query.end_date, "DD-MM-YYYY").endOf("day").toDate();
        }

        const perPage = Number(req.query.per_page) || user.per_page || 10;
        const page = Number(req.query.page) || 1;
        const skip = (page - 1) * perPage;

        // ─────────────────────────────────────────────
        // 1️⃣ TOTAL NOTIFICATIONS
        // ─────────────────────────────────────────────
        const totalNotifications = await prisma.notifications.count({
            where: {
                created_at: { gte: user.created_at },
                OR: [
                    { user_id: user.user_id },
                    { user_id: null }
                ]
            }
        });

        // ─────────────────────────────────────────────
        // 2️⃣ UNREAD NOTIFICATIONS
        // ─────────────────────────────────────────────

        // → user-specific unread
        const unreadUser = await prisma.notifications.count({
            where: {
                user_id: user.user_id,
                is_read: false,
                created_at: { gte: user.created_at }
            }
        });

        // → global unread: using RAW SQL (same as Laravel NOT EXISTS)
        const unreadGlobal = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS count
            FROM notifications n
            WHERE n.user_id IS NULL
            AND n.created_at >= ?
            AND NOT EXISTS (
                SELECT 1 FROM notification_reads nr
                WHERE nr.notification_id = n.notification_id
                AND nr.user_id = ?
            )
        `, user.created_at, user.user_id);

        const unreadNotifications =
            unreadUser + Number(unreadGlobal[0]?.count || 0);

        // ─────────────────────────────────────────────
        // 3️⃣ MAIN QUERY
        // ─────────────────────────────────────────────
        let where = {
            created_at: { gte: user.created_at },
            OR: [
                { user_id: user.user_id },
                { user_id: null }
            ]
        };

        // Status filter
        if (req.query.status === "unread") where.is_read = false;
        if (req.query.status === "read") where.is_read = true;

        // Date filters
        if (startDate && endDate) {
            where.created_at = { gte: startDate, lte: endDate };
        } else if (startDate) {
            where.created_at = { gte: startDate };
        } else if (endDate) {
            where.created_at = { lte: endDate };
        }

        const notifications = await prisma.notifications.findMany({
            where,
            skip,
            take: perPage,
            orderBy: { notification_id: "desc" },
        });

        if (!notifications.length) {
            return res.status(404).json({
                status: false,
                message: "No notifications found matching your criteria.",
                data: [],
                analytics: {
                    totalNotifications,
                    totalUnreadNotification: unreadNotifications,
                },
            });
        }

        // ─────────────────────────────────────────────
        // 4️⃣ FORMAT DATA
        // ─────────────────────────────────────────────
        const data = await Promise.all(
            notifications.map(async (n) => {
                let is_read;

                if (n.user_id) {
                    is_read = n.is_read;
                } else {
                    // global notification read check
                    const read = await prisma.notification_reads.findFirst({
                        where: {
                            notification_id: n.notification_id,
                            user_id: user.user_id,
                        }
                    });

                    is_read = !!read;
                }

                return {
                    notification_id: n.notification_id,
                    user_id: n.user_id,
                    title: n.title,
                    message: n.message,
                    operation_type: n.operation_type,
                    operation_id: n.operation_id,
                    type: n.type,
                    is_read,
                    created_at: n.created_at,
                    time_duration: dayjs(n.created_at).fromNow(),
                };
            })
        );

        // ─────────────────────────────────────────────
        // 5️⃣ PAGINATION
        // ─────────────────────────────────────────────
        const total = await prisma.notifications.count({ where });

        const pagination = {
            current_page: page,
            per_page: perPage,
            total,
            last_page: Math.ceil(total / perPage),
            next_page_url: page < Math.ceil(total / perPage) ? `?page=${page + 1}` : null,
            prev_page_url: page > 1 ? `?page=${page - 1}` : null,
        };

        // ─────────────────────────────────────────────
        return res.status(200).json({
            status: true,
            message: "Notifications fetched successfully",
            data,
            pagination,
            analytics: {
                totalNotifications,
                totalUnreadNotification: unreadNotifications,
            },
        });

    } catch (e) {
        return res.status(500).json({
            status: false,
            message: "Unable to fetch notifications.",
            errors: e.message,
        });
    }
};

export const getPerticularNotification = async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                status: false,
                message: "User not found",
            });
        }

        const notificationId = BigInt(req.params.id);

        // 🔍 Find Notification
        const notification = await prisma.notifications.findUnique({
            where: { notification_id: notificationId },
        });

        if (!notification) {
            return res.status(404).json({
                status: false,
                message: "Notification not found.",
            });
        }

        // 🔐 Unauthorized Check (Private Notification)
        if (
            notification.user_id !== null &&
            notification.user_id !== BigInt(user.user_id)
        ) {
            return res.status(403).json({
                status: false,
                message: "Unauthorized access to this notification.",
            });
        }

        // ==============================
        // 🔵 HANDLE READ LOGIC
        // ==============================
        if (notification.user_id === null) {
            // 🌍 Global notification
            const alreadySeen = await prisma.notification_reads.findFirst({
                where: {
                    notification_id: notification.notification_id,
                    user_id: BigInt(user.user_id),
                },
            });

            if (!alreadySeen) {
                await prisma.notification_reads.create({
                    data: {
                        user_id: BigInt(user.user_id),
                        notification_id: notification.notification_id,
                        seen_at: new Date(),
                    },
                });
            }
        } else {
            // 👤 User-specific notification
            if (!notification.is_read) {
                await prisma.notifications.update({
                    where: { notification_id: notification.notification_id },
                    data: { is_read: true },
                });
            }
        }
        console.log("notification", notification)

        // ==============================
        // 📦 Prepare Response Data
        // ==============================
        const cipher = crypto.createCipheriv(
            "aes-256-ecb",
            Buffer.from(process.env.ENCRYPTION_KEY, "utf8"),
            null
        );

        const idString = notification.notification_id.toString(); // convert BigInt to string
        const encryptedId = cipher.update(idString, "utf8", "base64") + cipher.final("base64");
        const responseData = {
            notification_id: encryptedId,
            title: notification.title,
            message: notification.message,
            operation_type: notification.operation_type,
            operation_id: notification.operation_id,
            type: notification.type,
            created_at: notification.created_at,
            duration: dayjs(notification.created_at).fromNow(true),
        };

        return res.status(200).json({
            status: true,
            message: "Notification fetched successfully!!",
            data: responseData,
        });
    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to fetch notification.",
            errors: error.message,
        });
    }
};

export const markAsRead = async (req, res) => {
    const user = req.user; // assuming req.user is set after authentication

    if (!user) {
        return res.status(401).json({
            status: false,
            message: "User not found",
        });
    }

    const prismaTransaction = await prisma.$transaction(async (tx) => {
        // 1️⃣ Mark all user-specific unread notifications as read
        await tx.notifications.updateMany({
            where: {
                user_id: BigInt(user.user_id),
                is_read: false,
            },
            data: {
                is_read: true,
            },
        });

        // 2️⃣ Fetch global unread notifications
        const unreadGlobalNotifications = await tx.notifications.findMany({
            where: {
                user_id: null,
                NOT: {
                    notification_reads: {
                        some: {
                            user_id: BigInt(user.user_id),
                        },
                    },
                },
            },
        });

        // 3️⃣ Mark global notifications as read in notification_reads
        const globalReadsData = unreadGlobalNotifications.map((notif) => ({
            notification_id: notif.notification_id,
            user_id: BigInt(user.user_id),
            seen_at: new Date(),
        }));

        if (globalReadsData.length > 0) {
            await tx.notification_reads.createMany({
                data: globalReadsData,
                skipDuplicates: true,
            });
        }

        // 4️⃣ Analytics: total & unread notifications
        const totalNotifications = await tx.notifications.count({
            where: {
                OR: [
                    { user_id: BigInt(user.user_id) },
                    { user_id: null },
                ],
            },
        });

        const unreadNotifications = await tx.notifications.count({
            where: {
                OR: [
                    {
                        user_id: BigInt(user.user_id),
                        is_read: false,
                    },
                    {
                        user_id: null,
                        NOT: {
                            notification_reads: {
                                some: { user_id: BigInt(user.user_id) },
                            },
                        },
                    },
                ],
            },
        });

        return { totalNotifications, unreadNotifications };
    });

    return res.status(200).json({
        status: true,
        message: "All unread notifications marked as read successfully.",
        analytics: prismaTransaction,
    });
};
