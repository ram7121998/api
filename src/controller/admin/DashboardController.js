import { convertBigIntToString } from "../../config/convertBigIntToString.js";
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

export const getRecentSuccessTrades = async (req, res) => {
  try {

    const recentTrades = await prisma.trades.findMany({
      where: { trade_status: "success" },
      orderBy: { trade_id: "desc" },
      take: 10
    });

    if (!recentTrades.length) {
      return res.status(404).json({
        status: false,
        message: "No recent successful trades found.",
      });
    }

    const userIds = [
      ...new Set([
        ...recentTrades.map(t => BigInt(t.buyer_id)),
        ...recentTrades.map(t => BigInt(t.seller_id))
      ])
    ];

    const users = await prisma.users.findMany({
      where: {
        user_id: { in: userIds }
      },
      select: {
        user_id: true,
        name: true,
        email: true,
        profile_image: true,
        username: true
      }
    });

    const userMap = {};
    users.forEach(user => {
      userMap[user.user_id.toString()] = user;
    });

    const formattedTrades = recentTrades.map(trade => ({
      trade_id: trade.trade_id.toString(),
      ad_id: trade.crypto_ad_id,
      asset: trade.asset,
      amount: trade.buy_amount || trade.amount,
      price: trade.price,
      status: trade.trade_status,
      created_at: trade.created_at,

      buyer: userMap[trade.buyer_id]
        ? {
          ...userMap[trade.buyer_id],
          role: "buyer"
        }
        : null,

      seller: userMap[trade.seller_id]
        ? {
          ...userMap[trade.seller_id],
          role: "seller"
        }
        : null
    }));

    return res.status(200).json({
      status: true,
      message: "Recent successful trades fetched successfully.",
      data: formattedTrades,
    });

  } catch (error) {
    console.error("Error fetching recent success trades:", error);
    return res.status(500).json({
      status: false,
      message: "Unable to fetch recent success trades.",
      errors: error.message,
    });
  }
};



export const getTradeDistribution = async (req, res) => {
  try {

    const totalTrades = await prisma.trades.count({
      where: {
        trade_status: "success"
      }
    });

    const buyCount = await prisma.trades.count({
      where: {
        trade_status: "success",
        trade_type: "buy"
      }
    });

    const sellCount = await prisma.trades.count({
      where: {
        trade_status: "success",
        trade_type: "sell"
      }
    });
    const calculatePercent = (count) =>
      totalTrades === 0 ? 0 : ((count / totalTrades) * 100).toFixed(2);

    return res.status(200).json({
      status: true,
      message: "Trade distribution fetched successfully",
      data: {
        total: totalTrades,
        buy_orders: {
          count: buyCount,
          percentage: calculatePercent(buyCount)
        },
        sell_orders: {
          count: sellCount,
          percentage: calculatePercent(sellCount)
        },

      }
    });

  } catch (error) {
    console.error("Trade distribution error:", error);
    return res.status(500).json({
      status: false,
      message: "Unable to fetch trade distribution",
      error: error.message
    });
  }
};



export const getRevenueAndTrades = async (req, res) => {
  try {
    const year = req.query.year
      ? Number(req.query.year)
      : new Date().getFullYear();

    const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
    const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

    const trades = await prisma.trades.findMany({
      where: {
        trade_status: "success", // apne enum ke according change karo
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        created_at: true,
        amount: true,
      },
    });

    // 12 months initialize
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      revenue: 0,
      trades: 0,
    }));

    trades.forEach((trade) => {
      const monthIndex = new Date(trade.created_at).getMonth();

      monthlyData[monthIndex].trades += 1;
      monthlyData[monthIndex].revenue += Number(trade.amount || 0);
    });

    return res.status(200).json({
      success: true,
      data: monthlyData,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};