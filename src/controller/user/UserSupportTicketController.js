import { generateUniqueTicketNumber } from "../../config/generateTicketNumber.js";
import prisma from "../../config/prismaClient.js";
import fs from "fs";
import { sendTradeEmail } from "../EmailController.js";

export const storeTicket = async (req, res) => {
  const user = req.user; // current user (buyer or seller)
  const { subject, message, priority, trade_id } = req.body;
  const attachments = req.files || [];

  try {
    // =======================
    // VALIDATION
    // =======================
    const errors = {};

    if (!subject) errors.subject = ["Subject is required."];
    if (!message) errors.message = ["Message is required."];
    if (!trade_id) errors.trade_id = ["trade_id is required."];

    if (priority && !["low", "medium", "high"].includes(priority)) {
      errors.priority = ["Invalid priority."];
    }

    if (attachments.length > 5) {
      errors.attachments = ["You can upload max 5 attachments."];
    }

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        status: false,
        message: "Validation failed",
        errors,
      });
    }

    // =======================
    // GET TRADE DETAILS
    // =======================
    const trade = await prisma.trades.findUnique({
      where: { trade_id: BigInt(trade_id) }
    });

    if (!trade) {
      return res.status(404).json({
        status: false,
        message: "Trade not found"
      });
    }

    // =======================
    // FETCH BUYER & SELLER FROM USERS TABLE
    // =======================
    const buyer = await prisma.users.findUnique({
      where: { user_id: trade.buyer_id }
    });

    const seller = await prisma.users.findUnique({
      where: { user_id: trade.seller_id }
    });

    // =======================
    // PROCESS ATTACHMENTS
    // =======================
    const BASE_URL = process.env.APP_URL;

    const finalUrls = attachments.map((file) => {
      let clean = file.path
        .replace(/\\/g, "/")
        .replace("storage/app/public/", "storage/");
      return `${BASE_URL}/${clean}`;
    });

    // =======================
    // CREATE TICKET
    // =======================
    const ticketNumber = await generateUniqueTicketNumber();

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.support_tickets.create({
        data: {
          ticket_number: ticketNumber,
          user_id: BigInt(user.user_id),
          subject,
          priority: priority || "medium",
          status: "pending",
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // first message
      await tx.support_ticket_messages.create({
        data: {
          ticket_id: ticket.ticket_id,
          sender_type: "user",
          sender_id: BigInt(user.user_id),
          message,
          attachments: JSON.stringify(finalUrls),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      return ticket;
    });

    // -------- SELLER NOTIFICATION --------
    const sellerNotification = await prisma.notifications.create({
      data: {
        user_id: seller.user_id,
        title: `Dispute Raised – Action Required`,
        message: `The buyer has opened a dispute for this trade. Please review the payment and provide necessary evidence.`,
        operation_type: "sell_trade",
        operation_id: trade_id.toString(),
        type: "trade",
        is_read: false,
        created_at: new Date()
      },
    });

    // Emit to seller
    io.to(seller.user_id.toString()).emit("new_notification", sellerNotification);


    // -------- BUYER NOTIFICATION --------
    const buyerNotification = await prisma.notifications.create({
      data: {
        user_id: buyer.user_id,
        title: "Dispute Submitted Successfully",
        message: `Your dispute has been opened. Please upload valid proof and cooperate with the support team.`,
        operation_type: "buy_trade",
        operation_id: trade_id.toString(),
        type: "trade",
        is_read: false,
        created_at: new Date()
      },
    });

    // Emit to buyer
    io.to(buyer.user_id.toString()).emit("new_notification", buyerNotification);


    // =======================
    // SEND EMAIL TO BUYER
    // =======================
    await sendTradeEmail(
      "DISPUTE_OPENED",
      buyer.email,
      {
        trade_id,
        user_name: buyer.username,
        side: "buyer",
        counterparty_name: seller.username,
        dispute_reason: subject
      }
    );

    // =======================
    // SEND EMAIL TO SELLER
    // =======================
    await sendTradeEmail(
      "DISPUTE_OPENED",
      seller.email,
      {
        trade_id,
        user_name: seller.username,
        side: "seller",
        counterparty_name: buyer.username,
        dispute_reason: subject
      }
    );

    return res.status(201).json({
      status: true,
      message: "Support ticket submitted & dispute emails sent.",
      data: result,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: "Failed to raise support ticket.",
      errors: error.message,
    });
  }
};


// GET /tickets
export const getTickets = async (req, res) => {
  try {
    const user = req.user; // logged-in user from middleware
    const { ticket_id, ticket_number } = req.query;

    // ==============================
    // Build base query
    // ==============================
    let whereClause = {
      user_id: BigInt(user.user_id),
    };

    // Filter by ticket_id
    if (ticket_id) {
      whereClause.ticket_id = BigInt(ticket_id);
    }

    // Filter by ticket_number (LIKE %search%)
    if (ticket_number) {
      whereClause.ticket_number = {
        contains: ticket_number,
      };
    }

    // ==============================
    // Fetch tickets with relations
    // ==============================
    const tickets = await prisma.support_tickets.findMany({
      where: whereClause,
      include: {
        support_ticket_messages: {
          include: {
            sender: true, // include message sender
          },
        },
        trades: true, // include related trade (needs Prisma relation)
      },
      orderBy: {
        ticket_id: "desc",
      },
    });
    console.log(tickets)
    return res.status(200).json({
      status: true,
      message: "Support tickets with trades retrieved successfully.",
      data: tickets,
      analytics: {
        totalSupportTicket: tickets.length,
      },
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



export const getParticularTickets = async (req, res) => {
  const { id } = req.params; // ticket_number
  const user = req.user;     // from auth middleware

  try {
    // ============================
    // Find ticket by ticket_number
    // ============================
    const ticket = await prisma.support_tickets.findFirst({
      where: {
        ticket_number: id,
        user_id: BigInt(user.user_id),
      },
      include: {
        support_ticket_messages: {
          include: {
            sender: true,
          },
        },
      },
    });

    if (!ticket) {
      return res.status(400).json({
        status: false,
        message: "Provide a valid ticket id.",
      });
    }

    // Convert attachments JSON string → array
    ticket.support_ticket_messages =
      ticket.support_ticket_messages.map((msg) => ({
        ...msg,
        attachments: msg.attachments
          ? JSON.parse(msg.attachments)
          : [],
      }));

    return res.status(200).json({
      status: true,
      message: "Particular Support ticket retrieved successfully.",
      data: ticket,
    });

  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Failed to retrieve particular ticket.",
      errors: error.message,
    });
  }
};

export const replySupportTicket = async (req, res) => {
  const user = req.user; // from auth middleware
  const { ticket_id, message } = req.body;
  const attachments = req.files || []; // Multer uploaded files

  try {
    // ================================
    // VALIDATION 
    // ================================
    const errors = {};

    if (!ticket_id) errors.ticket_id = ["ticket_id is required"];
    if (!message) errors.message = ["message is required"];

    if (attachments.length > 5) {
      errors.attachments = ["You can upload max 5 attachments"];
    }

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors,
      });
    }

    // ================================
    // Check Support Ticket Exists
    // ================================
    const supportTicket = await prisma.support_tickets.findUnique({
      where: { ticket_id: BigInt(ticket_id) },
    });

    if (!supportTicket) {
      return res.status(400).json({
        status: false,
        message: "Support ticket not found for the given ticket id.",
      });
    }

    // ================================
    // TOTAL SIZE LIMIT 100MB
    // ================================
    let totalSize = 0;
    attachments.forEach((file) => (totalSize += file.size));

    if (totalSize > 100 * 1024 * 1024) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: {
          attachments: ["Total attachment size cannot exceed 100MB."],
        },
      });
    }

    // ================================
    // PROCESS UPLOADED FILES
    // ================================
    const APP_URL = process.env.APP_URL;

    const finalUrls = attachments.map((file) => {
      let clean = file.path
        .replace(/\\/g, "/")              // Fix Windows slashes
        .replace("storage/app/public/", "storage/"); // remove extra parts

      return `${APP_URL}/${clean}`;
    });

    // ================================
    // SAVE DATA IN TRANSACTION
    // ================================
    await prisma.$transaction(async (tx) => {
      // Insert new message
      await tx.support_ticket_messages.create({
        data: {
          ticket_id: BigInt(ticket_id),
          sender_type: "admin",
          //   sender_id: BigInt(admin.admin_id),
          message,
          attachments: JSON.stringify(finalUrls),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Update ticket status
      await tx.support_tickets.update({
        where: { ticket_id: BigInt(ticket_id) },
        data: { status: "in_progress" },
      });
    });

    return res.status(200).json({
      status: true,
      message: "Successfully replied to the support ticket.",
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: "Failed to reply to the support ticket.",
      errors: error.message,
    });
  }
};

export const closeTicket = async (req, res) => {
  const user = req.user; // logged-in user
  const { ticket_id } = req.body;

  try {
    // ============================
    // VALIDATION 
    // ============================
    const errors = {};

    if (!ticket_id) {
      errors.ticket_id = ["ticket_id is required"];
    }

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        status: false,
        message: "Validation failed",
        errors,
      });
    }

    // ============================
    // CHECK IF TICKET EXISTS
    // AND BELONGS TO THIS USER
    // ============================
    const ticket = await prisma.support_tickets.findFirst({
      where: {
        ticket_id: BigInt(ticket_id),
        user_id: BigInt(user.user_id),
      },
    });

    if (!ticket) {
      return res.status(400).json({
        status: false,
        message: "Provide a valid ticket id.",
      });
    }

    // ============================
    // UPDATE STATUS TO CLOSED
    // ============================
    await prisma.support_tickets.update({
      where: { ticket_id: BigInt(ticket_id) },
      data: { status: "closed" },
    });

    return res.status(200).json({
      status: true,
      message: "Support ticket closed successfully.",
    });

  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Failed to close the support ticket.",
      errors: error.message,
    });
  }
};
