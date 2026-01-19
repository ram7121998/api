import prisma from '../../config/prismaClient.js';
import { pagination } from "../../config/pagination.js";
import { parse, isValid } from "date-fns"; // ✅ correct
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import { fullAssetName, network } from '../../config/ReusableCode.js';
export const getWalletDetails = async (req, res) => {
  try {
    const admin = req.admin; // middleware must set admin (like Laravel $this->admin)
    const {
      user_id,
      blockchain,
      network,
      asset,
      wallet_address,
      status,
      per_page,
      page,
    } = req.query;

    const perPage = parseInt(per_page) || 10;
    const currentPage = parseInt(page) || 1;
    const skip = (currentPage - 1) * perPage;

    let whereClause = {};

    if (user_id) whereClause.user_id = BigInt(user_id);
    if (blockchain) whereClause.blockchain = blockchain;
    if (network) whereClause.network = network;
    if (asset) whereClause.asset = asset;
    if (wallet_address) whereClause.wallet_address = wallet_address;
    if (status) whereClause.status = status;

    // Fetch wallet data and count simultaneously
    const [wallets, total] = await Promise.all([
      prisma.web3_wallets.findMany({
        where: whereClause,
        orderBy: { wallet_id: "desc" },
        skip,
        take: perPage,
      }),
      prisma.web3_wallets.count({ where: whereClause }),
    ]);
    console.log("wallets", wallets)
    // Format data
    const requiredData = wallets.map((data) => ({
      wallet_id: data.wallet_id,
      user_id: data.user_id,
      blockchain: data.blockchain,
      network: data.network,
      asset: data.asset,
      wallet_address: data.wallet_address,
      wallet_key: data.wallet_key,
      deposit_amount: data.deposit_amount,
      withdrawal_amount: data.withdrawal_amount,
      remaining_amount: data.remaining_amount,
      web3_deposit: data.web3_deposit,
      internal_deposit: data.internal_deposit,
      status: data.status,
      created_at: data.created_at,
      created_at_duration: timeSince(data.created_at),
    }));

    // Convert BigInt -> string to avoid JSON error
    const safeData = convertBigIntToString(requiredData);

    // Pagination response
    const paginated = pagination({
      total,
      page: currentPage,
      perPage,
    });

    return res.status(200).json({
      status: true,
      message: "Web3 wallet details fetched successfully.",
      data: safeData,
      pagination: paginated,
    });
  } catch (error) {
    console.error("❌ Error fetching Web3 wallet details:", error);
    return res.status(500).json({
      status: false,
      message: "Unable to fetch Web3 wallet details.",
      errors: error.message,
    });
  }
};


export const getTransactionDetails = async (req, res) => {
  try {
    const admin = req.admin; // middleware should attach admin data like Laravel $this->admin
    const {
      user_id,
      transaction_type,
      network,
      asset,
      txn_hash,
      method,
      status,
      start_date,
      end_date,
      per_page,
      page,
    } = req.query;

    const perPage = parseInt(per_page) || 10;
    const currentPage = parseInt(page) || 1;
    const skip = (currentPage - 1) * perPage;

    // where clause
    const whereClause = {};

    if (user_id) whereClause.user_id = BigInt(user_id);
    if (transaction_type) whereClause.txn_type = transaction_type;
    if (network) whereClause.network = network;
    if (asset) whereClause.asset = asset;
    if (txn_hash) whereClause.txn_hash_id = txn_hash;
    if (method) whereClause.method = method;
    if (status) whereClause.status = status;

    // ✅ Date range filtering
    function safeParse(dateStr) {
      if (!dateStr) return null;

      const parsed = parse(dateStr, "dd-MM-yyyy", new Date());
      return isValid(parsed) ? parsed : null;
    }

    // Date range filtering
    const startDate = safeParse(start_date);
    const endDate = safeParse(end_date);

    if (startDate && endDate) {
      whereClause.created_at = {
        gte: startDate,
        lte: endDate,
      };
    } else if (startDate) {
      whereClause.created_at = { gte: startDate };
    } else if (endDate) {
      whereClause.created_at = { lte: endDate };
    }
    // ✅ Fetch transactions with pagination
    const [transactions, total] = await Promise.all([
      prisma.transactions.findMany({
        where: whereClause,
        orderBy: { txn_id: "desc" },
        skip,
        take: perPage,
      }),
      prisma.transactions.count({ where: whereClause }),
    ]);

    // ✅ Format data
    const requiredData = transactions.map((data) => ({
      txn_id: data.txn_id,
      user_id: data.user_id,
      txn_type: data.txn_type,
      from_address: data.from_address,
      to_address: data.to_address,
      txn_hash_id: data.txn_hash_id,
      asset: data.asset,
      network: data.network,
      available_amount: data.available_amount,
      credit_amount: data.credit_amount,
      debit_amount: data.debit_amount,
      transfer_percentage: data.transfer_percentage,
      transfer_fee: data.transfer_fee,
      paid_amount: data.paid_amount,
      remaining_amount: data.remaining_amount,
      method: data.method,
      status: data.status,
      updated_buy: data.updated_buy,
      remark: data.remark,
      date_time: data.date_time,
      created_at: (() => {
        if (!data.created_at) return "";

        const d = new Date(data.created_at);
        if (isNaN(d.getTime())) return ""; // Invalid date handle

        return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      })(),

      created_at_duration: timeSince(data.created_at),
    }));

    // ✅ Convert BigInt to string to avoid JSON errors
    const safeData = convertBigIntToString(requiredData);

    // ✅ Pagination response
    const paginated = pagination({
      total,
      page: currentPage,
      perPage,
    });

    return res.status(200).json({
      status: true,
      message: "Transaction details fetched successfully.",
      decryptedData: safeData, // same as Laravel’s decryptedData
      data: safeData, // (you can replace with encryption if needed)
      pagination: paginated,
    });
  } catch (error) {
    console.error("❌ Error fetching transaction details:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch transaction details.",
      errors: error.message,
    });
  }
};
export const updateAddressTransactionStatus = async (req, res) => {
  const { txn_id, status, remark } = req.body;

  try {
    if (!txn_id) throw new Error("txn_id is required");
    if (!["success", "failed", "reject"].includes(status))
      throw new Error("Invalid status");
    if (["failed", "reject"].includes(status) && !remark)
      throw new Error("Remark is required when failed/reject");

    await prisma.$transaction(async (tx) => {
      // --- transaction logic as before ---
      const transaction = await tx.transactions.findUnique({
        where: { txn_id: BigInt(txn_id) },
      });
      if (!transaction) throw new Error("Transaction not found.");
      if (transaction.status === "success")
        throw new Error("Transaction already completed successfully.");

      const user = await tx.users.findUnique({
        where: { user_id: BigInt(transaction.user_id) },
      });
      if (!user) throw new Error("User not found.");

      const assetValue = Number(transaction.debit_amount || 0);
      let customSubject = "";
      let customMessage = "";

      if (status === "success") {
        customSubject = "Asset Transfer successfully";
        customMessage = `You have successfully sent ${assetValue} ${transaction.asset} to ${transaction.to_address}.`;
      } else {
        const wallet = await tx.web3_wallets.findFirst({
          where: {
            user_id: BigInt(user.user_id),
            asset: transaction.asset,
            network: transaction.network,
          },
        });
        if (!wallet) throw new Error("Wallet not found.");

        const admin = await tx.admin_assets.findFirst({
          where: {
            asset: fullAssetName(transaction.asset),
            network: network(transaction.network),
          },
        });
        if (!admin) throw new Error("Admin asset not found.");

        const transferFee = Number(transaction.transfer_fee || 0);

        await tx.web3_wallets.update({
          where: { wallet_id: BigInt(wallet.wallet_id) },
          data: {
            withdrawal_amount: Number(wallet.withdrawal_amount) - assetValue,
            remaining_amount: Number(wallet.remaining_amount) + assetValue,
            created_at: new Date(),
            updated_at: new Date()
          },
        });

        await tx.admin_assets.update({
          where: { admin_asset_id: BigInt(admin.admin_asset_id) },
          data: {
            total_revenue: Number(admin.total_revenue) - transferFee,
            total_withdraw: Number(admin.total_withdraw) - assetValue,
            available_balance:
              Number(admin.total_deposit) -
              (Number(admin.total_withdraw) - assetValue),
          },
        });

        customSubject = "Transaction Failed";
        customMessage =
          "Your transaction failed. The deducted amount has been credited back to your wallet.";
      }

      await tx.transactions.update({
        where: { txn_id: BigInt(txn_id) },
        data: {
          status,
          remark: remark || "Manual Web3 transaction completed successfully.",
          txn_hash_id: "TXN-" + transaction.user_id + "-" + Date.now(),
          updated_at: new Date()
        },
      });

    const notification = await tx.notifications.create({
        data: {
          user_id: BigInt(user.user_id),
          title: customSubject,
          message: customMessage,
          operation_type: "transaction using address",
          operation_id: String(txn_id),
          type: "trade",
          is_read: false,
          created_at: new Date()

        },
      });
       io.to(notification.user_id.toString()).emit("new_notification", notification);

    });

    // ✅ send success response immediately after transaction completes
    return res.status(200).json({
      status: true,
      message: "Transaction updated successfully",
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: false,
      message: "Unable to update transaction",
      errors: err.message,
    });
  }
};


// Helper to get "x time ago" like Laravel diffForHumans()
function timeSince(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count > 1) return `${count} ${interval.label}s ago`;
    else if (count === 1) return `1 ${interval.label} ago`;
  }
  return "just now";
}
