import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import prisma from '../../config/prismaClient.js';

export const storeNotification = async (req, res) => {
    try {
        // ✅ Admin authentication check
        const admin = req.admin;
        if (!admin) {
            return res.status(401).json({
                status: false,
                message: 'Unauthorized access!!',
            });
        }

        // ✅ Safe destructuring
        const { title, message, type, user_id } = req.body || {};
        console.log('Notification request body:', req.body);

        // ✅ Validation
        const validTypes = [
            'account_activity',
            'transaction',
            'security',
            'other',
            'admin_announcement',
            'trade',
            'support',
        ];

        if (!title || typeof title !== 'string' || title.length > 100) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: { title: ['Title is required and must be under 100 chars.'] },
            });
        }

        if (!message || typeof message !== 'string') {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: { message: ['Message is required.'] },
            });
        }

        if (!type || !validTypes.includes(type.toLowerCase())) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: {
                    type: [
                        'Type must be one of: account_activity, transaction, security, other, admin_announcement, trade, support',
                    ],
                },
            });
        }

        const user = req.user;

        // ✅ Create notification (enum-safe)
        const notification = await prisma.notifications.create({
            data: {
                user_id: user?.user_id || user_id || null,
                title,
                message,
                type: type.toLowerCase(), // must match your Prisma enum exactly
                is_read: false,
                created_at: new Date()
            },
        });
      io.to(notification.user_id.toString()).emit("new_notification", notification);

        const safeData = convertBigIntToString(notification);

        return res.status(201).json({
            status: true,
            message: 'Notification created successfully',
            data: safeData,
        });
    } catch (error) {
        console.error('Notification creation error:', error);
        return res.status(500).json({
            status: false,
            message: 'Unable to create notification.',
            errors: error.message,
        });
    }
};
export const deleteNotification = async (req, res) => {
    try {
        // ✅ Admin authentication check
        const admin = req.admin;
        if (!admin) {
            return res.status(401).json({
                status: false,
                message: 'Admin not found.',
            });
        }

        const { id } = req.params;

        // ✅ Find notification by ID
        const notification = await prisma.notifications.findUnique({
            where: { notification_id: BigInt(id)},
        });
        // ✅ Check if notification exists
        if (!notification) {
            return res.status(404).json({
                status: false,
                message: 'Notification not found for this request.',
            });
        }

       
        // ✅ Delete the notification
        await prisma.notifications.delete({
            where: { notification_id: BigInt(id) },
        });

        return res.status(200).json({
            status: true,
            message: 'Notification deleted successfully.',
        });
    } catch (error) {
        console.error('Delete notification error:', error);
        return res.status(500).json({
            status: false,
            message: 'Unable to delete notification.',
            errors: error.message,
        });
    }
};