import { convertBigIntToString } from "../../config/convertBigIntToString.js";
import prisma from "../../config/prismaClient.js";
import { getCryptoLogo } from "../../config/ReusableCode.js";
export const getMyCryptoAd = async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user.user_id) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized user.",
            });
        }
        let { txn_type, is_active, cryptocurrency, per_page = 10, page = 1, } = req.query;
        per_page = Number(per_page);
        page = Number(page);
        // Base filter
        let filters = {
            user_id: BigInt(user.user_id),
        };
        if (txn_type)
            filters.transaction_type = txn_type.toLowerCase();
        if (is_active)
            filters.is_active = is_active === "true";
        if (cryptocurrency)
            filters.cryptocurrency = cryptocurrency.toLowerCase();
        // Count total ads
        const count = await prisma.crypto_ads.count({ where: filters });
        // Pagination
        const skip = (page - 1) * per_page;
        // Fetch ads
        const cryptoAds = await prisma.crypto_ads.findMany({
            where: filters,
            orderBy: { crypto_ad_id: "desc" },
            skip,
            take: per_page,
        });
        // Add parsed offer_tags + logo
        const updatedAds = cryptoAds.map(ad => ({
            ...ad,
            offer_tags: (() => {
                try {
                    return typeof ad.offer_tags === "string"
                        ? JSON.parse(ad.offer_tags)
                        : ad.offer_tags;
                }
                catch {
                    return [];
                }
            })(),
            cryptocurrencyLogo: getCryptoLogo(ad.cryptocurrency, req),
        }));
        // Count User Sell & Buy Ads
        const totalUserSellAds = await prisma.crypto_ads.count({
            where: {
                user_id: BigInt(user.user_id),
                transaction_type: "sell"
            }
        });
        const totalUserBuyAds = await prisma.crypto_ads.count({
            where: {
                user_id: BigInt(user.user_id),
                transaction_type: "buy"
            }
        });
        // Pagination structure
        const lastPage = Math.ceil(count / per_page);
        const pagination = {
            current_page: page,
            from: skip + 1,
            to: skip + updatedAds.length,
            total: count,
            first_page_url: `${req.protocol}://${req.get("host")}${req.path}?page=1`,
            last_page: lastPage,
            last_page_url: `${req.protocol}://${req.get("host")}${req.path}?page=${lastPage}`,
            next_page_url: page < lastPage
                ? `${req.protocol}://${req.get("host")}${req.path}?page=${page + 1}`
                : null,
            per_page,
            prev_page_url: page > 1
                ? `${req.protocol}://${req.get("host")}${req.path}?page=${page - 1}`
                : null,
            links: [],
            path: `${req.protocol}://${req.get("host")}${req.path}`,
        };
        const safeData = convertBigIntToString(updatedAds);
        return res.status(200).json({
            status: true,
            message: "Crypto advertisements fetched successfully.",
            data: safeData,
            pagination,
            analytics: {
                total_ads: count,
                totalUserSellAds,
                totalUserBuyAds
            },
            logo: getCryptoLogo(null, req),
        });
    }
    catch (error) {
        console.error("GET MY CRYPTO AD ERROR:", error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: error.message,
        });
    }
};
export const createCryptoAd = async (req, res) => {
    let user = req.user; // user from middleware
    console.log(req.body.price_type);
    try {
        if (!user) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized. User not found."
            });
        }
        // Convert fields similar to Laravel merge()
        req.body.require_verification =
            req.body.require_verification === "true" || req.body.require_verification === true;
        req.body.preferred_currency = req.body.preferred_currency?.toLowerCase();
        req.body.country = req.body.country?.toLowerCase();
        // ---------------------------
        // VALIDATION (MANUAL LIKE LARAVEL)
        // ---------------------------
        const required = (field) => {
            if (!req.body[field])
                throw `${field} is required`;
        };
        required("cryptocurrency");
        required("transaction_type");
        required("payment_type");
        required("paymentMethod");
        required("price_type");
        required("price");
        required("min_trade_limit");
        required("max_trade_limit");
        required("offer_time_limit");
        if (req.body.max_trade_limit <= req.body.min_trade_limit)
            throw "max_trade_limit must be greater than min_trade_limit";
        if (req.body.new_user_limit &&
            req.body.new_user_limit <= req.body.min_trade_limit)
            throw "new_user_limit must be greater than minimum trade limit";
        // ---------------------------
        // PAYMENT METHOD CHECK
        // ---------------------------
        let paymentMethod = null;
        if (req.body.payment_type === "bank") {
            paymentMethod = await prisma.payment_details.findFirst({
                where: {
                    user_id: BigInt(user.user_id),
                    pd_id: Number(req.body.payment_method_id || 0)
                }
            });
        }
        else if (req.body.payment_type === "upi") {
            paymentMethod = await prisma.upi_details.findFirst({
                where: {
                    user_id: BigInt(user.user_id),
                    id: Number(req.body.payment_method_id || 0)
                }
            });
        }
        if (!paymentMethod) {
            return res.status(400).json({
                status: false,
                message: "Payment details not found."
            });
        }
        const payment_method_json = {
            payment_method: req.body.paymentMethod,
            payment_details: paymentMethod
        };
        offer_tags: req.body.offer_tags
            ? JSON.stringify(req.body.offer_tags)
            : null,
            // ---------------------------
            // CREATE AD (TRANSACTION)
            // ---------------------------
            await prisma.$transaction(async (tx) => {
                await tx.crypto_ads.create({
                    data: {
                        user_id: BigInt(user.user_id),
                        cryptocurrency: req.body.cryptocurrency,
                        transaction_type: req.body.transaction_type,
                        payment_type: req.body.payment_type,
                        payment_method: JSON.stringify(payment_method_json),
                        preferred_currency: req.body.preferred_currency,
                        country: req.body.country,
                        pricing_type: req.body.price_type, // ✅ REQUIRED FIELD
                        price: Number(req.body.price),
                        offer_margin: req.body.offer_margin ? Number(req.body.offer_margin) : null,
                        min_trade_limit: Number(req.body.min_trade_limit),
                        max_trade_limit: Number(req.body.max_trade_limit),
                        remaining_trade_limit: Number(req.body.max_trade_limit),
                        offer_time_limit: Number(req.body.offer_time_limit),
                        offer_tags: req.body.offer_tags
                            ? JSON.stringify(req.body.offer_tags)
                            : null,
                        offer_label: req.body.offer_label || null,
                        offer_terms: req.body.offer_terms || null,
                        require_verification: req.body.require_verification,
                        visibility: req.body.visibility,
                        min_trade_requirement: req.body.min_trades_required
                            ? Number(req.body.min_trades_required)
                            : null,
                        new_user_limit: req.body.new_user_limit
                            ? Number(req.body.new_user_limit)
                            : null
                    }
                });
                const notification = await tx.notifications.create({
                    data: {
                        user_id: BigInt(user.user_id),
                        title: "Crypto Ad created successfully.",
                        message: `You have successfully created your Crypto Advertisement to ${req.body.transaction_type} ${req.body.cryptocurrency}.`,
                        type: "account_activity",
                        is_read: false,
                        created_at: new Date()
                    }
                });
                io.to(notification.user_id.toString()).emit("new_notification", notification);
                // 🚨 FIX: Return nothing (undefined)
                return;
            });
        // This will run now
        console.log("result: crypto ad created");
        return res.status(201).json({
            status: true,
            message: "Crypto advertisement created successfully."
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Failed to create advertisement.",
            errors: error?.message || error
        });
    }
};
export const getCryptoAd = async (req, res) => {
    try {
        const user = req.user;
        const { ad_id, txn_type, cryptocurrency, paymentMethod, offerLocation, traderLocation, activeTrader, user_id, maxAmount, } = req.query;
        const perPage = Number(req.query.per_page) || 10;
        // =====================================================
        // MULTI FILTER LIST
        // =====================================================
        let filters = {
            is_active: true,
            remaining_trade_limit: { gt: 0 },
        };
        // ad_id filter
        if (ad_id)
            filters.crypto_ad_id = BigInt(ad_id);
        if (txn_type)
            filters.transaction_type = txn_type.toLowerCase();
        if (cryptocurrency)
            filters.cryptocurrency = cryptocurrency.toLowerCase();
        if (offerLocation)
            filters.country = offerLocation.toLowerCase();
        if (user_id)
            filters.user_id = BigInt(user_id);
        if (paymentMethod) {
            filters.payment_method = {
                contains: `"payment_method":"${paymentMethod.toLowerCase()}"`,
            };
        }
        // USER nested filters
        let userWhere = {};
        if (traderLocation)
            userWhere.country = traderLocation.toLowerCase();
        if (activeTrader === "true")
            userWhere.last_seen = { gte: moment().subtract(10, "minutes").toDate() };
        if (Object.keys(userWhere).length > 0) {
            filters.user = userWhere;
        }
        // =====================================================
        // COUNT & PAGINATION
        // =====================================================
        const totalAds = await prisma.crypto_ads.count({ where: filters });
        const page = Number(req.query.page) || 1;
        const skip = (page - 1) * perPage;
        let ads = await prisma.crypto_ads.findMany({
            where: filters,
            include: { user: true },
            orderBy: { crypto_ad_id: "desc" },
            skip,
            take: perPage,
        });
        // ads = ads.map((ad) => ({
        //     ...ad,
        //     offer_tags: (() => {
        //         try {
        //             return typeof ad.offer_tags === "string"
        //                 ? JSON.parse(ad.offer_tags)
        //                 : ad.offer_tags;
        //         } catch {
        //             return [];
        //         }
        //     })(),
        //     cryptocurrencyLogo: logo(ad.cryptocurrency),
        //     user: ad.user ? userDetails(ad.user, false) : null,
        // }));
        const feedbacks = await prisma.feedback.findMany({});
        ads = ads.map(ad => {
            const adFeedbacks = feedbacks.filter(f => f.user_id === ad.user_id);
            const totalLikes = adFeedbacks.filter(f => f.like).length;
            const totalDislikes = adFeedbacks.filter(f => f.dislike).length;
            const userFeedback = user
                ? adFeedbacks.find(f => f.user_id === BigInt(user.user_id))
                : null;
            return {
                ...ad,
                offer_tags: (() => {
                    try {
                        return typeof ad.offer_tags === "string"
                            ? JSON.parse(ad.offer_tags)
                            : ad.offer_tags;
                    }
                    catch {
                        return [];
                    }
                })(),
                cryptocurrencyLogo: logo(ad.cryptocurrency),
                user: ad.user
                    ? {
                        ...userDetails(ad.user, false),
                        total_likes: totalLikes,
                        total_dislikes: totalDislikes,
                    }
                    : null,
            };
        });
        return res.json({
            status: true,
            message: "Crypto advertisements fetched successfully.",
            data: ads,
            pagination: {
                current_page: page,
                from: skip + 1,
                to: skip + ads.length,
                total: totalAds,
                per_page: perPage,
                last_page: Math.ceil(totalAds / perPage),
                next_page_url: page < Math.ceil(totalAds / perPage) ? `?page=${page + 1}` : null,
                prev_page_url: page > 1 ? `?page=${page - 1}` : null,
            },
            analytics: totalCount(user_id ?? null, totalAds),
            logo: logo(),
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: err.message,
        });
    }
};
export const updateCryptoAdIsActive = async (req, res) => {
    const user = req.user;
    try {
        let { id, is_active } = req.body;
        // Convert is_active to boolean (like Laravel $request->boolean())
        is_active = String(is_active) === "true" ? true : false;
        // ===========================
        // VALIDATION
        if (!id || isNaN(id)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { id: ["id is required and must be numeric"] },
            });
        }
        if (typeof is_active !== "boolean") {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { is_active: ["is_active must be boolean"] },
            });
        }
        // ===========================
        // TRANSACTION
        // ===========================
        const updatedAd = await prisma.$transaction(async (tx) => {
            // Find ad of logged-in user
            const cryptoAd = await tx.crypto_ads.findFirst({
                where: {
                    crypto_ad_id: Number(id),
                    user_id: user.user_id,
                },
            });
            if (!cryptoAd) {
                throw new Error("Crypto Ad not found.");
            }
            if (cryptoAd.is_accepted) {
                throw new Error("The selected ad is currently involved in an active trade. Please try again once the trade is completed.");
            }
            // Update status
            return await tx.crypto_ads.update({
                where: { crypto_ad_id: BigInt(id) },
                data: { is_active },
            });
        });
        return res.status(200).json({
            status: true,
            message: `The Crypto ad is now ${updatedAd.is_active ? "active" : "inactive"}`,
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to update the crypto ad.",
            errors: err.message
        });
    }
};
export const updateAllCryptoAdIsActive = async (req, res) => {
    const user = req.user;
    try {
        // Convert string to boolean (same as Laravel ->boolean())
        let { is_active } = req.body;
        is_active = String(is_active) === "true" ? true : false;
        // -----------------------
        // Validation
        // -----------------------
        if (typeof is_active !== "boolean") {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { is_active: ["is_active must be boolean"] },
            });
        }
        // -----------------------
        // Transaction
        // -----------------------
        const result = await prisma.$transaction(async (tx) => {
            // Get all crypto ads for user
            const cryptoAds = await tx.crypto_ads.findMany({
                where: { user_id: BigInt(user.user_id) },
            });
            if (!cryptoAds.length) {
                throw new Error("Crypto Ad not found.");
            }
            const acceptedErrors = [];
            for (const ad of cryptoAds) {
                // If ad is accepted & user is trying to turn OFF -> error
                if (ad.is_accepted && is_active === false) {
                    acceptedErrors.push({
                        crypto_ad_id: ad.crypto_ad_id,
                        errors: "The ad is currently involved in an active trade. Please try again once the trade is completed.",
                    });
                }
                else {
                    // Update status
                    await tx.crypto_ads.update({
                        where: { crypto_ad_id: BigInt(ad.crypto_ad_id) },
                        data: { is_active: is_active },
                    });
                }
            }
            return acceptedErrors;
        });
        return res.status(200).json({
            status: true,
            message: `All the Crypto ads are now ${is_active ? "active" : "inactive"}`,
            errors: result, // list of accepted errors
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to update the crypto ads.",
            errors: err.message,
        });
    }
};
export const updateCryptoAd = async (req, res) => {
    const user = req.user;
    try {
        const { cryptoAd_id, min_trade_limit, max_trade_limit, offer_margin, offer_time_limit } = req.body;
        // Convert all numeric fields
        const minLimit = min_trade_limit !== undefined ? Number(min_trade_limit) : undefined;
        const maxLimit = max_trade_limit !== undefined ? Number(max_trade_limit) : undefined;
        const margin = offer_margin !== undefined ? Number(offer_margin) : undefined;
        const timeLimit = offer_time_limit !== undefined ? Number(offer_time_limit) : undefined;
        const errors = {};
        // ---------------------------
        // VALIDATION
        // ---------------------------
        // cryptoAd_id required and numeric
        if (!cryptoAd_id || isNaN(Number(cryptoAd_id))) {
            errors.cryptoAd_id = ["cryptoAd_id is required and must be numeric"];
        }
        // min_trade_limit >= 50 (Laravel rule)
        if (min_trade_limit !== undefined && (isNaN(minLimit) || minLimit < 50)) {
            errors.min_trade_limit = ["min_trade_limit must be numeric and >= 50"];
        }
        // max_trade_limit >= min_trade_limit
        if (max_trade_limit !== undefined) {
            if (isNaN(maxLimit)) {
                errors.max_trade_limit = ["max_trade_limit must be numeric"];
            }
            else if (minLimit !== undefined && maxLimit < minLimit) {
                errors.max_trade_limit = ["max_trade_limit must be >= min_trade_limit"];
            }
        }
        // offer_margin >= 1
        if (offer_margin !== undefined && (isNaN(margin) || margin < 1)) {
            errors.offer_margin = ["offer_margin must be numeric and >= 1"];
        }
        // offer_time_limit >= 10
        if (offer_time_limit !== undefined && (isNaN(timeLimit) || timeLimit < 10)) {
            errors.offer_time_limit = ["offer_time_limit must be >= 10"];
        }
        // If any validation failed
        if (Object.keys(errors).length > 0) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors,
            });
        }
        // ---------------------------
        // CHECK AT LEAST ONE FIELD
        // ---------------------------
        const updatableFields = [
            "min_trade_limit",
            "max_trade_limit",
            "offer_margin",
            "offer_time_limit"
        ];
        const atLeastOne = updatableFields.some((f) => req.body[f] !== undefined && req.body[f] !== "");
        if (!atLeastOne) {
            return res.status(400).json({
                status: false,
                message: "At least one field is required.",
            });
        }
        // ---------------------------
        // DATABASE TRANSACTION
        // ---------------------------
        await prisma.$transaction(async (tx) => {
            // Find ad
            const cryptoAd = await tx.crypto_ads.findFirst({
                where: {
                    crypto_ad_id: Number(cryptoAd_id),
                    user_id: user.user_id,
                },
            });
            if (!cryptoAd)
                throw new Error("Crypto Ad not found for this id.");
            if (cryptoAd.is_accepted) {
                throw new Error("The selected ad is currently involved in an active trade. Please try again once the trade is completed.");
            }
            if (cryptoAd.is_active) {
                throw new Error("The selected ad is currently active. Please deactivate it first before proceeding.");
            }
            // Build update object
            const updateData = {};
            if (minLimit !== undefined)
                updateData.min_trade_limit = minLimit;
            if (maxLimit !== undefined)
                updateData.max_trade_limit = maxLimit;
            if (margin !== undefined)
                updateData.offer_margin = margin;
            if (timeLimit !== undefined)
                updateData.offer_time_limit = timeLimit;
            // Update ad
            const updatedAd = await tx.crypto_ads.update({
                where: { crypto_ad_id: Number(cryptoAd_id) },
                data: updateData,
            });
            // Create notification
            const notification = await tx.notifications.create({
                data: {
                    user_id: user.user_id,
                    title: "Crypto Ad updated successfully.",
                    message: `You have successfully updated your Crypto Advertisement to ${updatedAd.transaction_type} ${updatedAd.cryptocurrency}.`,
                    type: "account_activity",
                    is_read: false,
                    created_at: new Date()
                },
            });
            io.to(notification.user_id.toString()).emit("new_notification", notification);
        });
        // ---------------------------
        // SUCCESS RESPONSE
        // ---------------------------
        return res.status(200).json({
            status: true,
            message: "Crypto advertisement updated successfully.",
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Failed to update crypto advertisement.",
            errors: err.message,
        });
    }
};
export const toggleFavoriteCryptoOffer = async (req, res) => {
    try {
        const user = req.user;
        const { ad_id } = req.body;
        // ============================
        //  VALIDATION
        // ============================
        if (!ad_id || isNaN(ad_id)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    ad_id: ["The ad_id field is required and must be numeric."]
                }
            });
        }
        // Check if crypto ad exists (similar to exists:crypto_ads,crypto_ad_id)
        const cryptoAd = await prisma.crypto_ads.findUnique({
            where: { crypto_ad_id: Number(ad_id) }
        });
        if (!cryptoAd) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: {
                    ad_id: ["Selected ad_id does not exist."]
                }
            });
        }
        // ============================
        // CHECK EXISTING FAVORITE
        // ============================
        const existingFavorite = await prisma.favorite_offers.findFirst({
            where: {
                user_id: user.user_id,
                crypto_ad_id: Number(ad_id),
            }
        });
        if (existingFavorite) {
            // Remove from favorites
            await prisma.favorite_offers.delete({
                where: { fo_id: BigInt(existingFavorite.fo_id) }
            });
            return res.status(200).json({
                status: true,
                message: "Crypto offer removed from favorite offer.",
                favorite_status: false
            });
        }
        // ============================
        // ADD NEW FAVORITE
        // ============================
        await prisma.favorite_offers.create({
            data: {
                user_id: user.user_id,
                crypto_ad_id: Number(ad_id),
                created_at: new Date(),
                updated_at: new Date()
            }
        });
        return res.status(201).json({
            status: true,
            message: "Crypto offer added to favorite offer.",
            favorite_status: true
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to toggle the favorite offer.",
            errors: error.message
        });
    }
};
export const getFavoriteCryptoOffer = async (req, res) => {
    try {
        const user = req.user;
        const perPage = Number(req.query.per_page) || 10;
        const trade_type = req.query.trade_type;
        // Validate trade_type
        if (trade_type && !["buy", "sell"].includes(trade_type)) {
            return res.status(400).json({
                status: false,
                message: "Invalid trade type. It should be either buy or sell"
            });
        }
        // RELATION FILTER
        const baseWhere = {
            user_id: BigInt(user.user_id),
            ...(trade_type ? { crypto_ad: { transaction_type: trade_type } } : {})
        };
        // Analytics
        const [totalFavoriteOffer, totalBuyFavoriteOffer, totalSellFavoriteOffer] = await Promise.all([
            prisma.favorite_offers.count({ where: { user_id: BigInt(user.user_id) } }),
            prisma.favorite_offers.count({
                where: {
                    user_id: BigInt(user.user_id),
                    crypto_ad: { transaction_type: "buy" }
                }
            }),
            prisma.favorite_offers.count({
                where: {
                    user_id: BigInt(user.user_id),
                    crypto_ad: { transaction_type: "sell" }
                }
            })
        ]);
        // Pagination
        const page = Number(req.query.page) || 1;
        const skip = (page - 1) * perPage;
        const [favoriteOffers, totalOffers] = await Promise.all([
            prisma.favorite_offers.findMany({
                where: baseWhere,
                orderBy: { fo_id: "desc" },
                skip,
                take: perPage,
                include: {
                    crypto_ad: true
                }
            }),
            prisma.favorite_offers.count({ where: baseWhere })
        ]);
        const lastPage = Math.ceil(totalOffers / perPage);
        const pagination = {
            current_page: page,
            from: skip + 1,
            to: skip + favoriteOffers.length,
            total: totalOffers,
            per_page: perPage,
            last_page: lastPage,
            next_page_url: page < lastPage ? `?page=${page + 1}` : null,
            prev_page_url: page > 1 ? `?page=${page - 1}` : null,
            first_page_url: `?page=1`,
            last_page_url: `?page=${lastPage}`,
            path: req.originalUrl.split("?")[0]
        };
        return res.json({
            status: true,
            message: "Favorite crypto offers retrieved successfully.",
            favorite_offers: favoriteOffers,
            pagination,
            analytics: {
                totalFavoriteOffer,
                totalBuyFavoriteOffer,
                totalSellFavoriteOffer
            }
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to fetch favorite crypto offer",
            errors: error.message
        });
    }
};
function logo(currency = null, req = null) {
    const baseUrl = process.env.APP_URL;
    return currency ? `${baseUrl}/storage/images/crypto_logo/${currency}.png` : "/icons/default.png";
}
export function userDetails(user) {
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
function totalCount(userId, count) {
    return {
        trader: userId,
        adsCount: count,
    };
}
