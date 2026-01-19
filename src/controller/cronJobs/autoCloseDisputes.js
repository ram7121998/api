import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { sendTradeEmail } from "../../controller/EmailController.js";
const prisma = new PrismaClient();

async function autoCloseDisputes() {
  console.log("⏳ Checking disputes for auto-close...");

  // 10 minutes old disputes
  const oldDisputes = await prisma.support_tickets.findMany({
    where: {
      status: "pending",
      created_at: {
        lte: new Date(Date.now() - 48 * 60 * 60 * 1000
        )
      },
    },
    include: {
      user: true,
      trades: true,
    }
  });

  for (let ticket of oldDisputes) {

    const trade = ticket.trades[0];

    // 1️⃣ Support Ticket ko close karo
    await prisma.support_tickets.update({
      where: { ticket_id: ticket.ticket_id },
      data: { status: "closed" }
    });

    // 2️⃣ Related Trade me dispute false karo
    if (trade) {
      await prisma.trades.update({
        where: { trade_id: trade.trade_id },
        data: {
          is_disputed: false,
          trade_remark: "Auto-closed by system"
        }
      });
    }
    const buyerNotification = await prisma.notifications.create({
      data: {
        user_id: trade.buyer_id,
        title: "Dispute Closed",
        message: "Dispute for this trade has been closed automatically.",
        type: "support",
        operation_id: trade.trade_id.toString(),
        created_at: new Date()
      }
    });

    const sellerNotification = await prisma.notifications.create({
      data: {
        user_id: trade.seller_id,
        title: "Dispute Closed",
        message: "Your dispute has been automatically closed. Please check trade details.",
        type: "support",
        operation_id: trade.trade_id.toString(),
        created_at: new Date()
      }
    });

    // Emit real-time notifications via Socket.IO
    io.to(buyerNotification.user_id.toString()).emit("new_notification", buyerNotification);
    io.to(sellerNotification.user_id.toString()).emit("new_notification", sellerNotification);

    // 3️⃣ Email Send
    await sendTradeEmail("DISPUTE_AUTO_CLOSED", ticket.user.email, {
      user_name: ticket.user.name,
      trade_id: trade?.trade_id,
      platform_name: "Your Platform"
    });

    console.log(`✔️ Auto closed ticket #${ticket.ticket_id}`);
  }
}


// Run every 30 minutes
cron.schedule("*/30 * * * *", autoCloseDisputes);

export default autoCloseDisputes;
