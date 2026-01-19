import prisma from "../../config/prismaClient.js";

export const getFeedback = async (req, res) => {
    try {
        const perPage = Number(req.query.per_page) || 10;
        const page = Number(req.query.page) || 1;

        let where = {};

        // ==============================
        // APPLY FILTERS
        // ==============================
        if (req.query.user_id) {
            where.user_id = Number(req.query.user_id);
        }

        if (req.query.id) {
            where.feedback_id = Number(req.query.id);
        }

        // Offer_id => trade.crypto_ad_id
        if (req.query.offer_id) {
            where.trade_id = Number(req.query.offer_id); // manual filtering
        }

        // ==============================
        // TOTAL FEEDBACK COUNT
        // ==============================
        const totalFeedback = await prisma.feedback.count();

        // ==============================
        // FILTERED FEEDBACK COUNT
        // ==============================
        const totalFilteredFeedback = await prisma.feedback.count({ where });

        // ==============================
        // LIKE / DISLIKE SUM
        // ==============================
        const totalLikes = await prisma.feedback.count({
            where: { ...where, like: true },
        });

        const totalDislikes = await prisma.feedback.count({
            where: { ...where, dislike: true },
        });

        const totalReactions = totalLikes + totalDislikes;
        const starRating =
            totalReactions > 0
                ? Number(((totalLikes / totalReactions) * 5).toFixed(2))
                : 0;

        const halfStarRating = Math.round(starRating * 2) / 2;

        // ==============================
        // FETCH FEEDBACK (WITHOUT RELATIONS)
        // ==============================
        const feedbackRows = await prisma.feedback.findMany({
            where,
            include: {
                user: true, // only user relation exists
            },
            orderBy: { feedback_id: "desc" },
            skip: (page - 1) * perPage,
            take: perPage,
        });

        // ==============================
        // MANUAL RELATION HANDLING
        // ==============================
        const requiredFeedback = await Promise.all(
            feedbackRows.map(async (data) => {
                let fromUser = null;
                let fromAdmin = null;
                let trade = null;

                // feedback_from = user
                if (data.feedback_from === "user") {
                    fromUser = await prisma.users.findUnique({
                        where: { user_id: data.feedback_from_id },
                    });
                }

                // feedback_from = admin
                if (data.feedback_from === "admin") {
                    fromAdmin = await prisma.admins.findUnique({
                        where: { admin_id: data.feedback_from_id },
                    });
                }

                // trade details
                if (data.trade_id) {
                    trade = await prisma.trades.findUnique({
                        where: { trade_id: data.trade_id },
                    });
                }

                const sender =
                    data.feedback_from === "admin" ? fromAdmin : fromUser;

                return {
                    feedback: {
                        feedback_id: data.feedback_id,
                        like: data.like,
                        dislike: data.dislike,
                        review: data.review,
                        feedback_from: data.feedback_from,
                        created_at: data.created_at,
                    },

                    userDetails: userDetails(data.user, false),

                    feedbackFrom:
                        data.feedback_from === "admin"
                            ? adminDetails(sender)
                            : userDetails(sender, false),

                    tradeDetails: trade,
                };
            })
        );

        // ==============================
        // PAGINATION META
        // ==============================
        const pagination = {
            current_page: page,
            per_page: perPage,
            total: totalFilteredFeedback,
            last_page: Math.ceil(totalFilteredFeedback / perPage),
            next_page_url:
                page < Math.ceil(totalFilteredFeedback / perPage)
                    ? `?page=${page + 1}&per_page=${perPage}`
                    : null,
            prev_page_url:
                page > 1
                    ? `?page=${page - 1}&per_page=${perPage}`
                    : null,
        };

        // ==============================
        // FINAL RESPONSE
        // ==============================
        return res.status(200).json({
            status: true,
            message: "Feedback fetched successfully.",
            feedbackData: requiredFeedback,
            pagination,
            analytics: {
                totalFeedback,
                totalFilteredFeedback,
                totalLikes,
                totalDislikes,
                starRating,
                halfStarRating,
            },
        });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to fetch feedback.",
            errors: error.message,
        });
    }
};
export const createFeedbackFromAdmin = async (req, res) => {
    try {
        const admin = req.admin; // middleware se aa raha hai

        const { user_id, likeDislike, review } = req.body;

        // ==============================
        // VALIDATION
        // ==============================
        if (!user_id || isNaN(user_id)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { user_id: ["User ID is required and must be numeric."] }
            });
        }

        if (!["like", "dislike"].includes(likeDislike)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { likeDislike: ["Must be 'like' or 'dislike'."] }
            });
        }

        // Check user exists
        const userExists = await prisma.users.findUnique({
            where: { user_id: BigInt(user_id) }
        });

        if (!userExists) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { user_id: ["User does not exist."] }
            });
        }

        // ==============================
        // CHECK EXISTING FEEDBACK
        // ==============================
        const existingFeedback = await prisma.feedback.findFirst({
            where: {
                user_id: BigInt(user_id),
                feedback_from: "user",
                feedback_from_id: Number(admin.admin_id)
            }
        });

        if (existingFeedback) {
            return res.status(409).json({
                status: false,
                message: "You have already given feedback to this user.",
            });
        }

        // ==============================
        // CREATE FEEDBACK
        // ==============================
        const data = await prisma.feedback.create({
            data: {
                user_id: BigInt(user_id),
                feedback_from: "user",
                feedback_from_id: Number(admin.admin_id),
                like: likeDislike === "like",
                dislike: likeDislike === "dislike",
                review: review || null
            }
        });

        // ==============================
        // RESPONSE
        // ==============================
        return res.status(201).json({
            status: true,
            message: "Feedback created successfully.",
            data
        });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to make feedback.",
            errors: error.message
        });
    }
};









export function userDetails(user, showExtra = false) {
    if (!user) return null;
    return {
        user_id: user.user_id,
        name: user.name,
        username: user.username,
        username_changed: user.username_changed,
        email: user.email,
        dialing_code: user.dialing_code,
        phone_number: user.phone_number,
        email_verified: user.email_verified,
        phone_verified: user.phone_verified,
        id_verified: user.id_verified,
        address_verified: user.address_verified,
        twoFactorAuth: user.twoFactorAuth,
        profile_image_url: user.profile_image_url,
        country: user.country,
        country_code: user.country_code,
        city: user.city,
        country_flag_url: user.country_flag_url,
        preferred_currency: user.preferred_currency,
        preferred_timezone: user.preferred_timezone,
        bio: user.bio,
        login_with: user.login_with,
        login_status: user.login_status,
        last_login: user.last_login,
        last_seen_at: user.last_seen_at,
        last_login_duration: user.last_login_duration,
        user_status: user.user_status
    };
}

export function adminDetails(admin) {
    if (!admin) return null;
    return {
        id: admin.admin_id,
        name: admin.name,
        email: admin.email
    };
}
