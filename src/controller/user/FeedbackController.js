import prisma from "../../config/prismaClient.js";
import { getAdminDetails, userDetail } from "../../config/ReusableCode.js";
import { userDetails } from "../admin/FeedbackController.js";
export const getFeedback = async (req, res) => {
    try {
        const user = req.user; // Logged in user
        const perPage = Number(req.query.per_page) || 10;
        const page = Number(req.query.page) || 1;

        let where = {
            user_id: Number(user.user_id)
        };

        if (req.query.id) {
            where.feedback_id = Number(req.query.id);
        }

        // ==============================
        // TOTAL FEEDBACK AGGREGATES
        // ==============================
        const totalFeedback = await prisma.feedback.count({ where });

        const totalLikes = await prisma.feedback.count({
            where: { ...where, like: true }
        });

        const totalDislikes = await prisma.feedback.count({
            where: { ...where, dislike: true }
        });

        const total = totalLikes + totalDislikes;

        const rawRating = total > 0 ? (totalLikes / total) * 5 : 0;
        const starRating = Number(rawRating.toFixed(2));
        const halfStarRating = Math.round(rawRating * 2) / 2;

        // ==============================
        // FETCH FEEDBACK WITH PAGINATION
        // ==============================
        const feedbackRows = await prisma.feedback.findMany({
            where,
            orderBy: { feedback_id: "desc" },
            skip: (page - 1) * perPage,
            take: perPage
        });

        // ==============================
        // MANUAL RELATIONS
        // ==============================
        const requiredFeedback = await Promise.all(
            feedbackRows.map(async (data) => {

                let sender = null;

                if (data.feedback_from === "admin") {
                    sender = await prisma.admins.findUnique({
                        where: { admin_id: data.feedback_from_id }
                    });
                } else {
                    sender = await prisma.users.findUnique({
                        where: { user_id: data.feedback_from_id }
                    });
                }

                return {
                    feedback: data,
                    feedbackFrom:
                        data.feedback_from === "admin"
                            ? getAdminDetails(sender)
                            : userDetails(sender, false),
                };
            })
        );

        // ==============================
        // PAGINATION RESPONSE 
        // ==============================
        const totalRecords = totalFeedback;
        const lastPage = Math.ceil(totalRecords / perPage);

        const pagination = {
            current_page: page,
            from: (page - 1) * perPage + 1,
            to: (page - 1) * perPage + feedbackRows.length,
            total: totalRecords,
            first_page_url: `?page=1&per_page=${perPage}`,
            next_page_url:
                page < lastPage ? `?page=${page + 1}&per_page=${perPage}` : null,
            last_page: lastPage,
            last_page_url: `?page=${lastPage}&per_page=${perPage}`,
            per_page: perPage,
            prev_page_url:
                page > 1 ? `?page=${page - 1}&per_page=${perPage}` : null,
            path: req.path,
            links: []
        };

        return res.status(200).json({
            status: true,
            message: "Feedback fetched successfully.",
            feedbackData: requiredFeedback,
            pagination,
            analytics: {
                total_feedback: totalFeedback,
                total_likes: totalLikes,
                total_dislikes: totalDislikes,
                star_rating: starRating,
                half_star_rating: halfStarRating,
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

export const createFeedback = async (req, res) => {
    const user = req.user;

    try {
        let { user_id, like, review } = req.body;

        // VALIDATION
        if (!user_id) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { user_id: ["The user_id field is required."] },
            });
        }

        if (isNaN(user_id)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { user_id: ["The user_id must be numeric."] },
            });
        }

        // Check user exists
        const checkUser = await prisma.users.findUnique({
            where: { user_id: BigInt(user_id) },  // users.user_id is BigInt
        });

        if (!checkUser) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { user_id: ["User does not exist."] },
            });
        }

        // convert like to boolean
        like = (like === true || like === "true");

        // CHECK EXISTING FEEDBACK
        const existingFeedback = await prisma.feedback.findFirst({
            where: {
                user_id: BigInt(user_id),        // BigInt OK
                feedback_from: "user",
                feedback_from_id: Number(user.user_id),  // MUST BE Int
            },
        });

        if (existingFeedback) {
            return res.status(409).json({
                status: false,
                message: "You have already submitted feedback for this user.",
            });
        }

        // CREATE FEEDBACK
        const feedbackData = {
            user_id: BigInt(user_id),                 // BigInt OK
            feedback_from: "user",
            feedback_from_id: Number(user.user_id),   // FIXED — Int required
            like: like,
            dislike: !like,
            review: review || null,
            created_at: new Date()
        };

        const data = await prisma.feedback.create({
            data: feedbackData,
        });

        return res.status(201).json({
            status: true,
            message: "Feedback created successfully.",
            data,
        });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to make feedback.",
            errors: error.message,
        });
    }
};


export const giveCryptoFeedback = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: false,
        message: "User not found"
      });
    }

    const { crypto_ad_id, like } = req.query;

    if (!crypto_ad_id) {
      return res.status(422).json({
        status: false,
        message: "Validation failed",
        errors: "crypto_ad_id is required"
      });
    }

    // Build dynamic where condition
    const whereCondition = {
      crypto_ad_id: BigInt(crypto_ad_id)
    };

    // Optional like filter
    if (like !== undefined) {
      const likeBool = like === true || like === "true";
      whereCondition.like = likeBool;
    }

    // Fetch all feedbacks for this crypto ad
    const cryptoFeedbacks = await prisma.feedback.findMany({
      where: whereCondition
    });

    if (!cryptoFeedbacks || cryptoFeedbacks.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No feedback found for this crypto ad"
      });
    }

    // Map through feedbacks and attach user details
    const feedbackWithDetails = await Promise.all(
      cryptoFeedbacks.map(async (feedback) => {
        const userDetails = await prisma.users.findUnique({
          where: { user_id: BigInt(feedback.feedback_from_id) }
        });

        return {
          ...feedback,
          feedback_id: feedback.feedback_id.toString(),
          like: feedback.like ? 1 : 0,
          dislike: feedback.dislike ? 1 : 0,
                userDetails: userDetail(userDetails)
        
        };
      })
    );

    // Counts
    const totalFeedback = cryptoFeedbacks.length;
    const positiveFeedback = cryptoFeedbacks.filter(f => f.like).length;
    const negativeFeedback = cryptoFeedbacks.filter(f => f.dislike).length;

    return res.status(200).json({
      status: true,
      message: "Feedback retrieved successfully.",
      data: {
        feedbacks: feedbackWithDetails,
        counts: {
          totalFeedback,
          positiveFeedback,
          negativeFeedback
        }
      }
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch feedback",
      errors: error.message
    });
  }
};
