import prisma from '../../config/prismaClient.js';
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import { sendTradeEmail } from '../EmailController.js';
import { Prisma } from '@prisma/client';
import { cryptoAsset, fullAssetName, getCurrentTimeInKolkata, network } from '../../config/ReusableCode.js';
import { feeDetails, genTxnHash } from '../user/TradeController.js';

dayjs.extend(utc);
dayjs.extend(timezone);
const dec = (v) => new Prisma.Decimal(v);

function diffForHumans(date) {
    const now = dayjs().tz("Asia/Kolkata");
    const then = dayjs(date).tz("Asia/Kolkata");

    const years = now.diff(then, "year");
    if (years > 0) return `${years} year${years > 1 ? "s" : ""} ago`;

    const months = now.diff(then, "month");
    if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;

    const days = now.diff(then, "day");
    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;

    const hours = now.diff(then, "hour");
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;

    const minutes = now.diff(then, "minute");
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;

    return "just now";
}


// Enable the relativeTime plugin
dayjs.extend(relativeTime);

export const getAllUsersTickets = async (req, res) => {
    try {
        const user = req.user;
        const perPage = parseInt(req.query.per_page) || 10;
        const page = parseInt(req.query.page) || 1;

        let whereCondition = {};

        // Basic Filters
        const filterFields = ["user_id", "status", "ticket_id", "ticket_number"];
        filterFields.forEach((field) => {
            if (req.query[field] && req.query[field] !== "null") {
                whereCondition[field] = req.query[field];
            }
        });

        // ----------------------------------------------------
        // 🔥 TRADE ID SEARCH LOGIC (MOST IMPORTANT FIX)
        // ----------------------------------------------------
        if (req.query.trade_id) {
            const tradeId = Number(req.query.trade_id);

            const trade = await prisma.trades.findUnique({
                where: { trade_id: tradeId },
                select: { support_ticket_number: true },
            });

            // Trade not found OR ticket_number NULL → Stop search
            if (!trade || !trade.support_ticket_number) {
                return res.status(404).json({
                    status: false,
                    message: "No tickets found for this trade ID.",
                    data: [],
                    pagination: { total: 0, last_page: 1 },
                });
            }

            whereCondition.ticket_number = trade.support_ticket_number;
        }

        // ----------------------------------------------------
        // 🚫 PREVENT PRISMA ERROR WHEN TICKET_NUMBER = NULL
        // ----------------------------------------------------
        if (whereCondition.ticket_number === null) {
            return res.status(404).json({
                status: false,
                message: "No tickets found!",
                data: [],
            });
        }

        // ----------------------------------------------------
        // 🔢 TOTAL TICKETS ANALYTICS
        // ----------------------------------------------------
        const totalTickets = await prisma.support_tickets.count();

        const statuses = ["open", "pending", "in_progress", "closed"];
        const analytics = { total_tickets: totalTickets };

        for (const status of statuses) {
            analytics[`total_${status}_tickets`] = await prisma.support_tickets.count({
                where: { status },
            });
        }

        // Total Filtered
        const totalFilteredTickets = await prisma.support_tickets.count({
            where: whereCondition,
        });

        analytics.total_filtered_tickets = totalFilteredTickets;

        // ----------------------------------------------------
        // 📌 FETCH PAGINATED TICKETS
        // ----------------------------------------------------
        const tickets = await prisma.support_tickets.findMany({
            where: whereCondition,
            include: {
                user: true,
            },
            orderBy: { ticket_id: "desc" },
            skip: (page - 1) * perPage,
            take: perPage,
        });

        // If no data found
        if (!tickets || tickets.length === 0) {
            return res.status(404).json({
                status: false,
                message: "No tickets found!",
                data: [],
            });
        }

        // ----------------------------------------------------
        // 🔗 ADD TRADE DETAILS + REPORTER/REPORTED LOGIC
        // ----------------------------------------------------
        const ticketsWithTrades = await Promise.all(
            tickets.map(async (ticket) => {
                let trade = null;
                let sellerDetails = null;
                let buyerDetails = null;

                if (ticket.ticket_number) {
                    trade = await prisma.trades.findFirst({
                        where: { support_ticket_number: ticket.ticket_number },
                    });

                    // Seller Details
                    if (trade?.seller_id) {
                        sellerDetails = await prisma.users.findUnique({
                            where: { user_id: Number(trade.seller_id) },
                        });
                    }

                    // Buyer Details
                    if (trade?.buyer_id) {
                        buyerDetails = await prisma.users.findUnique({
                            where: { user_id: Number(trade.buyer_id) },
                        });
                    }
                }

                // Reporter Logic
                let reporter = null;
                let reported = null;

                if (trade) {
                    const ticketUserId = Number(ticket.user_id);
                    const buyerId = Number(trade.buyer_id);
                    const sellerId = Number(trade.seller_id);

                    if (ticketUserId === buyerId) {
                        reporter = { ...buyerDetails, role: "buyer" };
                        reported = { ...sellerDetails, role: "seller" };
                    } else if (ticketUserId === sellerId) {
                        reporter = { ...sellerDetails, role: "seller" };
                        reported = { ...buyerDetails, role: "buyer" };
                    }
                }

                return {
                    ...ticket,
                    trade_details: trade,
                    reporter_details: reporter,
                    reported_details: reported,
                };
            })
        );

        const safeData = convertBigIntToString(ticketsWithTrades);

        // ----------------------------------------------------
        // 📌 PAGINATION DETAILS
        // ----------------------------------------------------
        const pagination = {
            current_page: page,
            per_page: perPage,
            total: totalFilteredTickets,
            last_page: Math.ceil(totalFilteredTickets / perPage),
        };

        // ----------------------------------------------------
        // ✅ FINAL SUCCESS RESPONSE
        // ----------------------------------------------------
        return res.status(200).json({
            status: true,
            message: "Support tickets retrieved successfully.",
            data: safeData,
            pagination,
            analytics,
        });

    } catch (error) {
        console.error("GET TICKETS ERROR:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to retrieve support tickets.",
            errors: error.message,
        });
    }
};


export const getParticularTicket = async (req, res) => {
    try {
        const { id } = req.params;

        const ticket = await prisma.support_tickets.findUnique({
            where: { ticket_id: BigInt(id) },
            include: {
                support_ticket_messages: {
                    include: { sender: true }, // include full sender object like Laravel
                    orderBy: { stm_id: "desc" },
                },
                user: true, // include full user object like Laravel
            },
        });

        if (!ticket) {
            return res.status(400).json({
                status: false,
                message: "Provide a valid ticket id.",
            });
        }

        // Update status if pending
        if (ticket.status === "pending") {
            await prisma.support_tickets.update({
                where: { ticket_id: BigInt(id) },
                data: { status: "open" },
            });
            ticket.status = "open";
        }
        const createdDuration = diffForHumans(ticket.created_at);

        // Add created_duration to ticket
        const responseTicket = {
            ...ticket,
            created_duration: createdDuration,
        };

        // Convert BigInt to string for IDs
        const data = convertBigIntToString(responseTicket);

        return res.status(200).json({
            status: true,
            message: "Particular Support ticket retrieved successfully.",
            data,
        });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "Failed to retrieve particular ticket.",
            errors: error.message,
        });
    }
};


export const closeTicket = async (req, res) => {
    try {
        const admin = req.admin; // assuming middleware sets admin user
        const { ticket_id } = req.body;

        // 🔹 Validation
        if (!ticket_id) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: { ticket_id: ['ticket_id is required'] },
            });
        }

        // 🔹 Check if ticket exists
        const ticket = await prisma.support_tickets.findUnique({
            where: { ticket_id: ticket_id },
        });

        if (!ticket) {
            return res.status(404).json({
                status: false,
                message: 'Support ticket not found.',
            });
        }

        // 🔹 Update ticket status
        const updatedTicket = await prisma.support_tickets.update({
            where: { ticket_id: ticket_id },
            data: { status: 'closed' },
        });

        if (updatedTicket) {
            return res.status(200).json({
                status: true,
                message: 'Support ticket closed successfully.',
            });
        } else {
            throw new Error('Unable to close support ticket');
        }
    } catch (err) {
        console.error('closeTicket error:', err);
        return res.status(500).json({
            status: false,
            message: 'Failed to close the support ticket.',
            errors: err.message,
        });
    }
};


export const replySupportTicket = async (req, res) => {
    const admin = req.admin; // from auth middleware
    const { ticket_id, message } = req.body;
    const attachments = req.files || [];

    try {
        // 1️⃣ Validation
        const errors = {};
        if (!ticket_id) errors.ticket_id = ['ticket_id is required'];
        if (!message) errors.message = ['Message is required'];
        if (attachments.length > 5) errors.attachments = ['You can upload max 5 attachments'];

        let totalSize = attachments.reduce((acc, file) => acc + file.size, 0);
        if (totalSize > 100 * 1024 * 1024) {
            errors.attachments = ['Total attachment size cannot exceed 100MB.'];
        }

        if (Object.keys(errors).length > 0) {
            return res.status(422).json({ status: false, message: 'Validation failed', errors });
        }

        // 2️⃣ Check ticket existence
        const supportTicket = await prisma.support_tickets.findUnique({
            where: { ticket_id: BigInt(ticket_id) },
        });

        if (!supportTicket) {
            return res.status(404).json({
                status: false,
                message: 'Support ticket not found for the given ticket id.',
            });
        }

        // 3️⃣ Prepare attachment URLs
        const APP_URL = process.env.APP_URL;
        const finalUrls = attachments.map(file => {
            let clean = file.path.replace(/\\/g, '/').replace('storage/app/public/', 'storage/');
            return `${APP_URL}/${clean}`;
        });

        // 4️⃣ Insert message and update ticket in a transaction
        await prisma.$transaction(async (tx) => {
            await tx.support_ticket_messages.create({
                data: {
                    ticket_id: BigInt(ticket_id),
                    sender_type: 'admin',
                    admin_sender_id: BigInt(admin.admin_id),
                    message,
                    attachments: finalUrls.length ? JSON.stringify(finalUrls) : null,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            });

            await tx.support_tickets.update({
                where: { ticket_id: BigInt(ticket_id) },
                data: { status: 'in_progress' },
            });
        });

        return res.status(200).json({
            status: true,
            message: 'Successfully replied to the support ticket.',
        });

    } catch (err) {
        console.error('Reply support ticket failed:', err);
        return res.status(500).json({
            status: false,
            message: 'Failed to reply to the support ticket.',
            errors: err.message,
        });
    }
};


// POST /api/dispute/open
export const disputeOpened = async (req, res) => {
    try {
        const {
            trade_id,
            user_name,
            side,
            counterparty_name,
            dispute_reason,
            email
        } = req.body;

        console.log("dispute distail", trade_id,
            user_name,
            side,
            counterparty_name,
            dispute_reason,
            email)

        // ========== CALL TEMPLATE ==========
        await sendTradeEmail("DISPUTE_INITIATED", email, {
            trade_id,
            user_name,
            side,
            counterparty_name,
            dispute_reason,
        });
        await sendTradeEmail("DISPUTE_UNDER_REVIEW", email, {
            trade_id,
            user_name,
            platform_name: "CryptoXchange",
            eta_hours: 12,        // minimum response time
            eta_hours_max: 24,
            app_path_to_dispute: `/app/disputes/${trade_id}`

        });

        // ========== RESPONSE ================
        return res.json({
            status: true,
            message: "Dispute opened email sent successfully!",
        });

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            status: false,
            message: "Internal error",
        });
    }
};


export const sendEvidenceRequiredEmail = async (req, res) => {
    try {
        const { trade_id, user_id, evidence_deadline_hours } = req.body;

        if (!trade_id || !user_id) {
            return res.status(422).json({
                status: false,
                message: "trade_id and user_id are required"
            });
        }

        const user = await prisma.users.findUnique({ where: { user_id: BigInt(user_id) } });
        const trade = await prisma.trades.findUnique({ where: { trade_id: BigInt(trade_id) } });

        if (!user || !trade) {
            return res.status(404).json({
                status: false,
                message: "User or Trade not found"
            });
        }

        await sendTradeEmail("DISPUTE_EVIDENCE_REQUIRED", user.email, {
            trade_id,
            user_name: user.name,
            platform_name: "CryptoXchange",
            evidence_deadline_hours: evidence_deadline_hours || 24
        });
        const buyerId = trade.buyer_id;
        const sellerId = trade.seller_id;

        // Create notifications
        const buyerNotification = await prisma.notifications.create({
            data: {
                user_id: buyerId,
                title: "Evidence Required",
                message: `Admin has requested additional evidence for Trade #${trade_id}.`,
                type: "support",
                operation_id: trade.trade_id.toString(),
                created_at: new Date(),
            },
        });

        const sellerNotification = await prisma.notifications.create({
            data: {
                user_id: sellerId,
                title: "Evidence Required",
                message: `Admin has requested additional evidence for Trade #${trade_id}.`,
                type: "support",
                operation_id: trade.trade_id.toString(),
                created_at: new Date(),
            },
        });

        // Emit notifications via socket
        io.to(buyerId.toString()).emit("new_notification", buyerNotification);
        io.to(sellerId.toString()).emit("new_notification", sellerNotification);

        return res.json({
            status: true,
            message: "Evidence required email sent successfully."
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: false,
            message: "Internal server error"
        });
    }
};


    export const adminResolveDispute = async (req, res) => {
        const admin = req.user;         // ADMIN
        const D = (n) => new Prisma.Decimal(n);

        try {
            const { trade_id, tradeId, decision, remark } = req.body;
            console.log("tradeId4", tradeId)

            // if (!trade_id || isNaN(trade_id)) {
            //   return res.status(422).json({
            //     status: false,
            //     message: "Trade ID required"
            //   });
            // }
            console.log("trade_id77", trade_id)

            if (!["buyer", "seller"].includes(decision)) {
                return res.status(422).json({
                    status: false,
                    message: "Decision must be buyer or seller"
                });
            }

            // ===============================
            // GET TRADE DETAILS
            // ===============================
            const trade = await prisma.trades.findUnique({
                where: { trade_id: BigInt(trade_id) }
            });

            if (!trade)
                return res.status(404).json({ status: false, message: "Trade not found" });

            if (!trade.is_disputed)
                return res.status(422).json({
                    status: false,
                    message: "No dispute exists for this trade"
                });

            const buyerId = BigInt(trade.buyer_id);
            const sellerId = BigInt(trade.seller_id);

            // ===============================
            // TRANSACTION START
            // ===============================
            await prisma.$transaction(async (tx) => {

                // GET ASSET DETAILS
                const adminAsset = await tx.admin_assets.findFirst({
                    where: {
                        asset: trade.asset,
                        network: fullAssetName(trade.asset)
                    }
                });

                if (!adminAsset) throw new Error("Asset not configured");

                // --------------------------
                // CASE 1: Decision → BUYER (Crypto RELEASE to buyer)
                // --------------------------
                if (decision === "buyer") {
                    const buyerWallet = await tx.web3_wallets.findFirst({
                        where: {
                            user_id: buyerId,
                            asset: cryptoAsset(trade.asset),
                            network: network(trade.asset)
                        }
                    });

                    const sellerWallet = await tx.web3_wallets.findFirst({
                        where: {
                            user_id: sellerId,
                            asset: cryptoAsset(trade.asset),
                            network: network(trade.asset)
                        }
                    });

                    if (!buyerWallet || !sellerWallet)
                        throw new Error("Wallets not found");

                    // Seller → Buyer Asset Transfer
                    const sellerRemaining = D(sellerWallet.remaining_amount).sub(
                        D(trade.hold_asset)
                    );

                    await tx.transactions.create({
                        data: {
                            user_id: sellerId,
                            txn_type: "internal",
                            from_address: sellerWallet.wallet_address,
                            to_address: buyerWallet.wallet_address,
                            txn_hash_id: genTxnHash(sellerId),
                            asset: sellerWallet.asset,
                            network: sellerWallet.network,
                            debit_amount: dec(trade.hold_asset),
                            credit_amount: 0,
                            remaining_amount: sellerRemaining,
                            method: "send",
                            status: "success",
                            remark: "Dispute resolved - admin released asset to buyer",
                            date_time: String(Date.now()),
                            created_at: new Date()
                        }
                    });

                    await tx.web3_wallets.update({
                        where: { wallet_id: BigInt(sellerWallet.wallet_id) },
                        data: {
                            withdrawal_amount:
                                Number(sellerWallet.withdrawal_amount) + Number(trade.hold_asset),
                            remaining_amount: Number(sellerRemaining),
                            hold_asset: Number(sellerWallet.hold_asset) - Number(trade.hold_asset)
                        }
                    });

                    // ADMIN FEE CALC
                    const { transferFee, transferPercentage } = feeDetails(
                        adminAsset.withdrawal_fee_type,
                        adminAsset.withdrawal_fee,
                        trade.hold_asset
                    );

                    const paidAmount = trade.hold_asset - transferFee;

                    const buyerRemaining = D(buyerWallet.remaining_amount).add(
                        D(paidAmount)
                    );

                    await tx.transactions.create({
                        data: {
                            user_id: buyerId,
                            txn_type: "internal",
                            from_address: sellerWallet.wallet_address,
                            to_address: buyerWallet.wallet_address,
                            txn_hash_id: genTxnHash(buyerId),
                            asset: buyerWallet.asset,
                            network: buyerWallet.network,
                            credit_amount: dec(trade.hold_asset),
                            transfer_fee: dec(transferFee),
                            transfer_percentage: transferPercentage,
                            paid_amount: paidAmount,
                            remaining_amount: buyerRemaining,
                            method: "receive",
                            status: "success",
                            date_time: String(Date.now()),
                            remark: "Dispute resolved - asset credited",
                            created_at: new Date()
                        }
                    });

                    await tx.web3_wallets.update({
                        where: { wallet_id: BigInt(buyerWallet.wallet_id) },
                        data: {
                            deposit_amount:
                                Number(buyerWallet.deposit_amount) + Number(paidAmount),
                            internal_deposit:
                                Number(buyerWallet.internal_deposit) + Number(paidAmount),
                            remaining_amount: Number(buyerRemaining)
                        }
                    });
                }

                // --------------------------
                // CASE 2: Decision → SELLER (TRADE CANCEL + ASSET BACK TO SELLER)
                // --------------------------
                if (decision === "seller") {
                    const sellerWallet = await tx.web3_wallets.findFirst({
                        where: {
                            user_id: sellerId,
                            asset: cryptoAsset(trade.asset),
                            network: network(trade.asset)
                        }
                    });

                    if (!sellerWallet) throw new Error("Seller wallet not found");

                    const sellerRemaining = D(sellerWallet.remaining_amount).add(
                        D(trade.hold_asset)
                    );

                    // Return hold amount to seller
                    await tx.web3_wallets.update({
                        where: { wallet_id: BigInt(sellerWallet.wallet_id) },
                        data: {
                            remaining_amount: Number(sellerRemaining),
                            hold_asset:
                                Number(sellerWallet.hold_asset) - Number(trade.hold_asset)
                        }
                    });

                    await tx.transactions.create({
                        data: {
                            user_id: sellerId,
                            txn_type: "internal",
                            credit_amount: dec(trade.hold_asset),
                            debit_amount: 0,
                            asset: sellerWallet.asset,
                            network: sellerWallet.network,
                            from_address: "system",
                            to_address: sellerWallet.wallet_address,
                            remaining_amount: sellerRemaining,
                            status: "success",
                            date_time: String(Date.now()),
                            remark: "Dispute resolved - asset returned to seller",
                            created_at: new Date()
                        }
                    });
                }

                // UPDATE TRADE STATUS
                await tx.trades.update({
                    where: { trade_id: BigInt(trade.trade_id) },
                    data: {

                        trade_status: decision === "buyer" ? "disputedSuccess" : "cancel",
                        trade_step: "FOUR",
                         dispute_winner: decision, 
                        is_disputed: false,
                        trade_remark: remark || null,
                        status_changed_at: new Date(),
                    }
                });

                const supportTicket = await tx.support_tickets.updateMany({
                    where: {
                        trades: {
                            some: {
                                trade_id: BigInt(trade.trade_id),
                            },
                        },
                    },
                    data: {
                        status: "resolved",
                        result: decision,
                        updated_at: new Date(),
                    },
                });
                // NOTIFICATIONS
                const buyerNotification = await tx.notifications.create({
                    data: {
                        user_id: buyerId,
                        title: "Dispute Resolved",
                        message:
                            decision === "buyer"
                                ? "Decision in your favour. Asset has been released."
                                : "Decision in seller’s favour. Trade cancelled.",
                        type: "support",
                        operation_id: trade.trade_id.toString(),
                        created_at: new Date()
                    }
                });

                const notificationSeller = await tx.notifications.create({
                    data: {
                        user_id: sellerId,
                        title: "Dispute Resolved",
                        message:
                            decision === "seller"
                                ? "Decision in your favour. Asset returned to you."
                                : "Decision in buyer’s favour. Asset released.",
                        type: "support",
                        operation_id: trade.trade_id.toString(),
                        created_at: new Date()
                    }
                });

                io.to(buyerNotification.user_id.toString()).emit("new_notification", buyerNotification);
                io.to(notificationSeller.user_id.toString()).emit("new_notification", notificationSeller);
            });

            // Fetch buyer & seller info
            const buyerUser = await prisma.users.findUnique({ where: { user_id: BigInt(trade.buyer_id) } });
            const sellerUser = await prisma.users.findUnique({ where: { user_id: BigInt(trade.seller_id) } });

            // Send email to buyer
            await sendTradeEmail("DISPUTE_RESOLVED_BUYER", buyerUser?.email, {
                trade_id: trade.trade_id,
                user_name: buyerUser?.username || "Buyer",
                amount_crypto: trade.hold_asset,
                asset: trade.asset,
                amount_fiat: trade.buy_value, // or trade.buy_value * trade.buy_amount if you want total
                counterparty_name: sellerUser?.username || "Seller",
                platform_name: "YourPlatform",
            });

            // Send email to seller
            await sendTradeEmail("DISPUTE_RESOLVED_SELLER", sellerUser?.email, {
                trade_id: trade.trade_id,
                user_name: sellerUser?.username || "Seller",
                amount_crypto: trade.hold_asset,
                asset: trade.asset,
                amount_fiat: trade.buy_value, // same as above
                side: "Seller",
                platform_name: "YourPlatform",
            });



            return res.json({
                status: true,
                message: "Dispute resolved successfully by admin"
            });

        } catch (err) {
            return res.status(500).json({
                status: false,
                message: "Unable to resolve dispute",
                errors: err.message
            });
        }
    };

export const closeDisputeByAdmin = async (req, res) => {
    try {
        const { ticket_id } = req.body;

        if (!ticket_id) {
            return res.status(400).json({
                status: false,
                message: "ticket_id is required"
            });
        }

        const ticket = await prisma.support_tickets.findUnique({
            where: { ticket_id: BigInt(ticket_id) },
            include: {
                user: true,
                trades: true
            }
        });

        if (!ticket) {
            return res.status(404).json({
                status: false,
                message: "Ticket not found"
            });
        }
        if (ticket.status === "closed") {
            return res.status(400).json({
                status: false,
                message: "This dispute is already closed."
            });
        }

        if (!ticket.trades || ticket.trades.length === 0) {
            return res.status(404).json({
                status: false,
                message: "No trade linked with this ticket"
            });
        }

        const trade = ticket.trades[0];
        const buyerId = trade.buyer_id;
        const sellerId = trade.seller_id;

        // Step 1: Update Ticket Status
        await prisma.support_tickets.update({
            where: { ticket_id: BigInt(ticket_id) },
            data: { status: "closed" }
        });

        // Step 2: Update Trade → close dispute
        await prisma.trades.update({
            where: { trade_id: trade.trade_id },
            data: {
                is_disputed: false,
                trade_remark: "Dispute closed by admin",
                buyer_dispute_time: new Date(),
                seller_dispute_time: new Date()

            }
        });

        // Step 3: Send Notifications
        if (buyerId && sellerId) {
            const buyerNotification = await prisma.notifications.create({
                data: {
                    user_id: buyerId,
                    title: "Dispute Closed",
                    message: "Your dispute has been closed by admin. Please check trade details.",
                    type: "support",
                    operation_id: trade.trade_id.toString(),
                    created_at: new Date()
                }
            });

            const sellerNotification = await prisma.notifications.create({
                data: {
                    user_id: sellerId,
                    title: "Dispute Closed",
                    message: "Dispute for this trade has been closed by admin.",
                    type: "support",
                    operation_id: trade.trade_id.toString(),
                    created_at: new Date()
                }
            });

            // Emit real-time notifications via Socket.IO
            io.to(buyerNotification.user_id.toString()).emit("new_notification", buyerNotification);
            io.to(sellerNotification.user_id.toString()).emit("new_notification", sellerNotification);
        }

        // Step 4: Send Email
        await sendTradeEmail("DISPUTE_AUTO_CLOSED", ticket.user.email, {
            user_name: ticket.user.username,
            trade_id: trade.trade_id,
            platform_name: "crypto"
        });

        return res.json({
            status: true,
            message: "Dispute closed successfully, trade updated, email & notifications sent"
        });

    } catch (error) {
        console.error("Close Dispute Error:", error);
        return res.status(500).json({
            status: false,
            message: "Internal server error"
        });
    }
};

export const cancelTradeByAdmin = async (req, res) => {
    try {
        const user = req.user;
        const { trade_id } = req.body;

        if (!trade_id) {
            return res.status(422).json({
                status: false,
                message: "Trade ID is required.",
            });
        }

        const tradeDetails = await prisma.trades.findUnique({
            where: { trade_id: BigInt(trade_id) },
        });

        if (!tradeDetails) {
            return res.status(422).json({
                status: false,
                message: "Trade not found for the given trade id.",
            });
        }

        // Validate immediately
        if (tradeDetails.trade_status === "cancel") {
            return res.status(403).json({
                status: false,
                message: "Trade is already cancelled.",
            });
        }

        if (tradeDetails.trade_step >= 3) {
            return res.status(403).json({
                status: false,
                message: "Cannot cancel at this stage.",
            });
        }

        // Load wallet + cryptoAd OUTSIDE transaction
        const sellerWallet = await prisma.web3_wallets.findFirst({
            where: { user_id: BigInt(tradeDetails.seller_id) },
        });

        const cryptoAd = await prisma.crypto_ads.findUnique({
            where: { crypto_ad_id: tradeDetails.crypto_ad_id },
        });

        // ⭐ TRANSACTION — ONLY UPDATES INSIDE
        await prisma.$transaction(
            async (tx) => {
                await tx.web3_wallets.update({
                    where: { wallet_id: sellerWallet.wallet_id },
                    data: {
                        hold_asset:
                            sellerWallet.hold_asset -
                            tradeDetails.hold_asset,
                    },
                });

                await tx.crypto_ads.update({
                    where: { crypto_ad_id: cryptoAd.crypto_ad_id },
                    data: {
                        remaining_trade_limit:
                            cryptoAd.remaining_trade_limit +
                            tradeDetails.amount,
                    },
                });

                await tx.trades.update({
                    where: { trade_id: BigInt(tradeDetails.trade_id) },
                    data: {
                        hold_asset: 0,
                        trade_status: "cancel",
                        buyer_status: "cancel",
                        status_changed_at: new Date(),
                        time_limit: null,
                    },
                });
            },
            {
                timeout: 15000, // ⭐ Correct placement
                maxWait: 15000,
            }
        );

        // Load buyer/seller for notifications — OUTSIDE TRANSACTION
        const buyerDetails = await prisma.users.findUnique({
            where: { user_id: BigInt(tradeDetails.buyer_id) },
            select: { email: true, name: true, username: true },
        });

        const sellerDetails = await prisma.users.findUnique({
            where: { user_id: BigInt(tradeDetails.seller_id) },
            select: { email: true, name: true, username: true },
        });

        const cryptoSymbol = tradeDetails.asset.toUpperCase();
        const cryptoAmount = tradeDetails.hold_asset?.toString() ?? "0";

        // Notifications
        const sellerNotification = await prisma.notifications.create({
            data: {
                user_id: BigInt(tradeDetails.seller_id),
                title: "Trade Cancelled by Buyer",
                message: `The trade with buyer ${buyerDetails.username} for ${cryptoAmount} ${cryptoSymbol} has been cancelled by the buyer.`,
                operation_type: "sell_trade",
                operation_id: tradeDetails.trade_id.toString(),
                type: "trade",
                is_read: false,
                created_at: new Date(),
            },
        });

        const buyerNotification = await prisma.notifications.create({
            data: {
                user_id: BigInt(tradeDetails.buyer_id),
                title: "You Cancelled the Trade",
                message: `You have successfully cancelled the trade with seller ${sellerDetails.username} for ${cryptoAmount} ${cryptoSymbol}.`,
                operation_type: "buy_trade",
                operation_id: tradeDetails.trade_id.toString(),
                type: "trade",
                is_read: false,
                created_at: new Date(),
            },
        });

        // Emit
        io.to(tradeDetails.seller_id.toString()).emit("new_notification", sellerNotification);
        io.to(tradeDetails.buyer_id.toString()).emit("new_notification", buyerNotification);

        // Emails
        await sendTradeEmail("TRADE_CANCELLED", buyerDetails.email, {
            trade_id: tradeDetails.trade_id.toString(),
            user_name: buyerDetails.username,
            side: "Buyer",
            asset: tradeDetails.asset,
            amount_crypto: tradeDetails.buy_value,
            amount_fiat: tradeDetails.buy_amount,
            fiat: tradeDetails.fiat_currency || "INR",
        });

        await sendTradeEmail("TRADE_CANCELLED", sellerDetails.email, {
            trade_id: tradeDetails.trade_id.toString(),
            user_name: sellerDetails.username,
            side: "Seller",
            asset: tradeDetails.asset,
            amount_crypto: tradeDetails.buy_value,
            amount_fiat: tradeDetails.buy_amount,
            fiat: tradeDetails.fiat_currency || "INR",
        });

        return res
            .status(200)
            .json({ status: true, message: "Trade cancelled successfully." });
    } catch (error) {
        console.log("Error caught:", error);

        const statusCode =
            typeof error.code === "number"
                ? error.code
                : error.code === "P2028"
                    ? 400
                    : 500;

        return res.status(statusCode).json({
            status: false,
            message: error.message || "Failed to cancel trade.",
        });
    }
};


export const resertNewTrade = async (req, res) => {
    try {
        const { trade_id, amount, assetValue, cryptocurrency } = req.body;

        if (!trade_id) {
            return res.status(400).json({
                status: false,
                message: "trade_id is required",
            });
        }

        // Fetch old trade
        const trade = await prisma.trades.findUnique({
            where: { trade_id: BigInt(trade_id) }
        });

        if (!trade) {
            return res.status(404).json({
                status: false,
                message: "Trade not found",
            });
        }

        const buyerId = trade.initiated_by;
        const sellerId = trade.seller_id;

        // Update trade
        const updated = await prisma.trades.update({
            where: { trade_id: BigInt(trade_id) },
            data: {
                amount: Number(amount),
                buy_amount: Number(assetValue),
                buy_value: Number(assetValue),
                asset: cryptocurrency,
                trade_step: "TWO",
                updated_at: new Date(),
                trade_status: "pending"
            }
        });

        console.log("updated", updated)

        // Buyer Notification
        const buyerNotification = await prisma.notifications.create({
            data: {
                user_id: buyerId,
                title: "Trade Updated",
                message: "Admin has reset your trade details. Please review the updated trade information.",
                type: "trade",
                operation_id: updated.trade_id.toString(),
                created_at: new Date()
            }
        });

        // Seller Notification
        const sellerNotification = await prisma.notifications.create({
            data: {
                user_id: sellerId,
                title: "Trade Updated",
                message: "Admin has reset the trade details for this transaction.",
                type: "trade",
                operation_id: updated.trade_id.toString(),
                created_at: new Date()
            }
        });

        // Real-time Notification Emit
        io.to(buyerId.toString()).emit("new_notification", buyerNotification);
        io.to(sellerId.toString()).emit("new_notification", sellerNotification);

        return res.json({
            status: true,
            message: "Trade updated successfully",
            data: updated
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: false,
            message: "Server Error",
            error: error.message
        });
    }
};

export const sendSystemMessage = async (req, res) => {
    try {
        const { tradeId, userId, message } = req.body;

        if (!tradeId || !userId || !message) {
            return res.status(400).json({
                status: false,
                message: "tradeId, userId and message are required",
            });
        }

        // 1️⃣ Save notification in DB

        const notification = await prisma.notifications.create({
            data: {
                user_id: userId,
                title: "New message from Admin",
                message: message,
                type: "support",
                created_at: new Date(),
            }
        });
        console.log("notification", notification)
        // 2️⃣ Emit socket event
        io.to(userId.toString()).emit("new_notification", notification);

        // 3️⃣ Fetch user email
        const user = await prisma.users.findUnique({
            where: { user_id: BigInt(userId) },
            select: { email: true, username: true },
        });

        // 4️⃣ Send email if available
        if (user?.email) {
            await sendTradeEmail("ADMIN_MESSAGE", user.email, {
                user_name: user.username,
                trade_id: tradeId,
                message: message,
            });
        }

        return res.json({
            status: true,
            message: "Notification saved, sent via socket & email successfully",
            data: notification,
        });

    } catch (error) {
        console.error("Send System Message Error:", error);
        return res.status(500).json({
            status: false,
            message: "Internal server error",
        });
    }
};

