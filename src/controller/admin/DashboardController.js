// controllers/adminDashboardController.js
import prisma from "../../config/prismaClient.js";

export const getDashboard = async (req, res) => {
  try {
    const analytics = await getTotal();

    return res.status(200).json({
      status: true,
      message: "Dashboard retrieved successfully",
      analytics,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to retrieve dashboard.",
      errors: error.message,
    });
  }
};

// ✅ Helper function to get total stats
const getTotal = async () => {
  try {
    // ===== Users Metrics =====
    const totalUsers = await prisma.users.count();
    const totalActiveUsers = await prisma.users.count({
      where: { user_status: "active" },
    });
    const totalEmailUnverifiedUsers = await prisma.users.count({
      where: { email_verified_at: null },
    });
    const totalNumberUnverifiedUsers = await prisma.users.count({
      where: { number_verified_at: null },
    });

    // ===== Withdrawals Metrics =====
    // Replace with your actual table/model name
    const totalWithdrawal = 0;
    const totalApprovedWithdrawal = 0;
    const totalPendingWithdrawal = 0;
    const totalRejectedWithdrawal = 0;

    // ===== Market Performance Metrics =====
    const totalAdvertisements = await prisma.crypto_ads.count({
      where: { is_active: true },
    });

    const totalTrades = await prisma.trades.count({
      where: { trade_status: "success" },
    });

    // ===== Build Analytics Object =====
    const analytics = {
      users: {
        total_users: totalUsers,
        total_active_users: totalActiveUsers,
        total_email_unverified_users: totalEmailUnverifiedUsers,
        total_number_unverified_users: totalNumberUnverifiedUsers,
      },
      withdrawals: {
        total_withdrawal: totalWithdrawal,
        total_approved_withdrawal: totalApprovedWithdrawal,
        total_pending_withdrawal: totalPendingWithdrawal,
        total_rejected_withdrawal: totalRejectedWithdrawal,
      },
      MarketPerformance_metrics: {
        total_advertisements: totalAdvertisements,
        total_trades: totalTrades,
      },
    };

    return analytics;
  } catch (error) {
    throw new Error("Unable to fetch total: " + error.message);
  }
};
