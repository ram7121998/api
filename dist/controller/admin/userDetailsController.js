import prisma from '../../config/prismaClient.js';
import { getCountryData } from '../../config/getCountryData.js';
import { formatUserDetails } from '../../config/formatUserDetails.js';
import { userDetail } from '../../config/ReusableCode.js';
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { pagination } from '../../config/pagination.js';
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);
export const getUser = async (req, res) => {
    const { id } = req.params;
    const admin = req.admin; // middleware se attach
    const ADMIN_TZ = admin?.preferred_timezone || "Asia/Kolkata";
    try {
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(id) },
            include: {
                user_login_details: true, // login history
                addresses: true, // addresses
            },
        });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "No user were found",
            });
        }
        // Profile image
        let profileImage = null;
        if (user.profile_image) {
            profileImage = user.profile_image.startsWith("http")
                ? user.profile_image
                : `${process.env.BASE_URL}/storage/${user.profile_image}`;
        }
        // KYC & verification
        const email_verified = Boolean(user.email_verified_at);
        const phone_verified = Boolean(user.number_verified_at);
        const kycVerified = user.addresses?.some(a => a.status === "verified");
        // Successful address
        const addressData = user.addresses?.find(a => a.status === "success") || null;
        // User object
        const userData = {
            user_id: user.user_id,
            name: user.name,
            username: user.username,
            email: user.email,
            dialing_code: user.dialing_code,
            phone_number: user.phone_number,
            email_verified,
            phone_verified,
            kyc_verified: kycVerified,
            profile_image_url: profileImage,
            country: user.country || null,
            preferred_currency: user.preferred_currency,
            preferred_timezone: user.preferred_timezone,
            login_with: user.login_with,
            login_status: user.login_status,
            login_count: user.login_count,
            last_login: user.last_login
                ? dayjs(user.last_login).tz(ADMIN_TZ).format("YYYY-MM-DD hh:mm A")
                : null,
            last_login_duration: user.last_login
                ? dayjs(user.last_login).fromNow()
                : null,
            logged_in_device: user.logged_in_device,
            loggedIn_device_ip: user.loggedIn_device_ip,
            user_status: user.user_status,
            joined_at: dayjs(user.created_at).tz(ADMIN_TZ).format("YYYY-MM-DD hh:mm A"),
            joined_duration: dayjs(user.created_at).fromNow(),
            last_seen_at: user.last_seen ? dayjs(user.last_seen).fromNow() : null,
            password: user.password
        };
        // Login history
        let loginDetails = [];
        if (user.user_login_details?.length) {
            loginDetails = await Promise.all(user.user_login_details.map(async (loginHistory) => ({
                loginDetailsId: loginHistory.login_details_id,
                ipAddress: loginHistory.ip_address,
                deviceDetails: loginHistory.device_details ? JSON.parse(loginHistory.device_details) : null,
                device: loginHistory.device,
                browser: loginHistory.browser,
                os: loginHistory.os,
                osVersion: loginHistory.os_version,
                loginStatus: loginHistory.login_status,
                loginAt: loginHistory.logged_in_at
                    ? dayjs(loginHistory.logged_in_at).tz(ADMIN_TZ).format("YYYY-MM-DD hh:mm A")
                    : null,
                loginDuration: loginHistory.logged_in_at
                    ? dayjs(loginHistory.logged_in_at).fromNow()
                    : null,
                countryData: await getCountryData(loginHistory.ip_address),
            })));
        }
        const safeData = convertBigIntToString({
            user: userData,
            login_details: loginDetails,
            address: addressData,
        });
        const [depositsCount, withdrawalsCount, totalTransactions] = await Promise.all([
            // Deposits = transactions jisme credit_amount > 0
            prisma.transactions.count({
                where: {
                    user_id: BigInt(id),
                    credit_amount: { gt: 0 },
                },
            }),
            // Withdrawals = transactions jisme debit_amount > 0
            prisma.transactions.count({
                where: {
                    user_id: BigInt(id),
                    debit_amount: { gt: 0 },
                },
            }),
            // Total transactions
            prisma.transactions.count({
                where: { user_id: BigInt(id) },
            }),
        ]);
        const totalAds = await prisma.crypto_ads.count({
            where: { user_id: BigInt(id) },
        });
        return res.status(200).json({
            status: true,
            message: "User data fetched successfully",
            data: safeData,
            analytics: {
                deposits: depositsCount,
                withdrawals: withdrawalsCount,
                Transactions: totalTransactions,
                TotalAdvertisements: totalAds,
            },
        });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong while fetching the user's details",
            errors: error.message,
        });
    }
};
export const loginHistory = async (req, res) => {
    try {
        const admin = req.admin;
        const { id } = req.params;
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(id) },
            include: { user_login_details: true },
        });
        if (!user) {
            return res.status(404).json({
                status: false,
                message: "User not found.",
            });
        }
        if (!user.user_login_details || user.user_login_details.length === 0) {
            return res.status(404).json({
                status: false,
                message: "No login details were found.",
            });
        }
        const requiredData = await Promise.all(user.user_login_details.map(async (loginHistory) => {
            const preferredTimezone = admin?.preferred_timezone || "Asia/Kolkata";
            const loginAt = dayjs(loginHistory.logged_in_at)
                .tz(preferredTimezone)
                .format("YYYY-MM-DD hh:mm A");
            const loginDuration = dayjs(loginHistory.logged_in_at)
                .tz(preferredTimezone)
                .fromNow();
            const countryInfo = await getCountryData(loginHistory.ip_address);
            return {
                loginDetailsId: loginHistory.login_details_id,
                ipAddress: loginHistory.ip_address,
                deviceDetails: JSON.parse(loginHistory.device_details || "{}"),
                device: loginHistory.device,
                browser: loginHistory.browser,
                os: loginHistory.os,
                osVersion: loginHistory.os_version,
                loginStatus: loginHistory.login_status,
                loginAt,
                loginDuration,
                countryData: countryInfo,
            };
        }));
        const data = {
            user: userDetail(user),
            loginHistory: requiredData,
        };
        const safeData = convertBigIntToString(data);
        return res.status(200).json({
            status: true,
            message: "Login History fetched successfully.",
            data: safeData,
        });
    }
    catch (error) {
        console.error("Login history error:", error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong.",
            errors: error.message,
        });
    }
};
export const userDetails = async (req, res) => {
    try {
        const admin = req.admin;
        const perPage = parseInt(req.query.per_page) || admin?.per_page || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * perPage;
        let whereClause = {};
        // Filter by user_id
        if (req.query.user_id) {
            whereClause.user_id = BigInt(req.query.user_id);
        }
        // Status filter
        const status = req.query.status || null;
        if (status) {
            switch (status) {
                case "active_users":
                    whereClause.user_status = "active";
                    break;
                case "banned_users":
                    whereClause.user_status = "block";
                    break;
                case "unverified_email_users":
                    whereClause.email_verified_at = null;
                    break;
                case "unverified_number_users":
                    whereClause.number_verified_at = null;
                    break;
                case "unverified_kyc_users":
                    whereClause.addresses = { none: {} };
                    break;
                case "pending_kyc_users":
                    whereClause.addresses = { some: { status: "pending" } };
                    break;
            }
        }
        // Search filter
        if (req.query.search && req.query.search.trim() !== "") {
            const search = req.query.search.trim();
            whereClause.OR = [
                { username: { contains: search, } },
                { email: { contains: search } },
            ];
        }
        // Fetch users + total users + analytics simultaneously
        const [users, total, analytics] = await Promise.all([
            prisma.users.findMany({
                where: whereClause,
                include: {
                    addresses: true,
                    web3_wallets: true,
                },
                orderBy: { user_id: "desc" },
                skip,
                take: perPage,
            }),
            prisma.users.count({ where: whereClause }),
            getAnalytics(), // ⭐ Laravel style analytics
        ]);
        // Format users
        const formattedUsers = await Promise.all(users.map(async (user) => {
            const userData = await formatUserDetails(user, true);
            return {
                user_details: userData,
                address_details: user.addresses,
                wallet_details: user.web3_wallets,
            };
        }));
        const safeData = convertBigIntToString(formattedUsers);
        // Final response
        return res.status(200).json({
            status: true,
            message: users.length === 0
                ? "No users found."
                : "Successfully fetched users' details",
            data: safeData,
            pagination: pagination({ total, page, perPage }),
            analytics: analytics || {}, // ⭐ EXACTLY like Laravel
        });
    }
    catch (error) {
        console.error("❌ Error fetching users:", error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong while fetching users.",
            errors: error.message,
        });
    }
};
export const updateUserStatus = async (req, res) => {
    try {
        const admin = req.admin; // Assuming admin is attached via middleware
        if (!admin) {
            return res.status(401).json({
                status: false,
                message: 'Admin not authenticated',
            });
        }
        // Normalize status to lowercase
        const status = req.body.status?.toLowerCase();
        const { user_id } = req.body;
        // Validation
        const errors = [];
        if (!user_id || isNaN(Number(user_id)))
            errors.push({ user_id: 'User ID is required and must be numeric.' });
        const allowedStatuses = ['active', 'block', 'terminate'];
        if (!status || !allowedStatuses.includes(status))
            errors.push({ status: `Status must be one of ${allowedStatuses.join(', ')}` });
        if (errors.length > 0) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors,
            });
        }
        // Start transaction
        const updatedUser = await prisma.$transaction(async (tx) => {
            const userDetails = await tx.users.findUnique({
                where: { user_id: Number(user_id) },
            });
            if (!userDetails) {
                throw new Error('User not found');
            }
            // Check if status is already the same
            if (userDetails.user_status?.toLowerCase() === status) {
                const error = new Error(`The user is already ${status.charAt(0).toUpperCase() + status.slice(1)}.`);
                error.name = 'ValidationError';
                throw error;
            }
            return tx.users.update({
                where: { user_id: Number(user_id) },
                data: { user_status: status, updated_at: new Date() },
            });
        });
        return res.status(200).json({
            status: true,
            message: "User's status updated successfully.",
            update_status: updatedUser.user_status,
        });
    }
    catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: [error.message],
            });
        }
        return res.status(500).json({
            status: false,
            message: "Unable to update user's status.",
            errors: error.message,
        });
    }
};
const getAnalytics = async () => {
    const [total_users, active_users, banned_users, total_email_unverifiedUsers, total_number_unverifiedUsers, totalUnverifiedKycUsers, totalPendingKyc] = await Promise.all([
        prisma.users.count(),
        prisma.users.count({ where: { user_status: "active" } }),
        prisma.users.count({ where: { user_status: "block" } }),
        prisma.users.count({ where: { email_verified_at: null } }),
        prisma.users.count({ where: { number_verified_at: null } }),
        prisma.users.count({ where: { id_verified_at: null } }),
        prisma.users.count({
            where: { addresses: { some: { status: "pending" } } }
        }),
    ]);
    return {
        total_users,
        active_users,
        banned_users,
        total_email_unverifiedUsers,
        total_number_unverifiedUsers,
        totalUnverifiedKycUsers,
        totalPendingKyc
    };
};
