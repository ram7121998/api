import prisma from '../../config/prismaClient.js';
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import { cryptoAsset, network, txnHash } from '../../config/ReusableCode.js';
import { Prisma } from "@prisma/client";
import dayjs from 'dayjs';

export const getTradeHistory = async (req, res) => {
  const admin = req.admin; // assuming middleware sets admin data
  console.log(admin)
  try {
    const perPage = parseInt(req.query.per_page) || 10;
    const userId = req.query.user_id ? (req.query.user_id) : null;
    const whereClause = {};

    if (userId) {
      whereClause.OR = [
        { seller_id: userId },
        { buyer_id: userId }
      ];
    }

    if (req.query.trade_id) {
      whereClause.trade_id = req.query.trade_id;
    }
    if (req.query.cryptocurrency) {
      whereClause.asset = req.query.cryptocurrency;
    }
    if (req.query.tradeStatus) {
      whereClause.trade_status = req.query.tradeStatus;
    }
    if (req.query.tradeType) {
      whereClause.trade_type = req.query.tradeType;
    }

    // Counts
    const totalTrade = await prisma.trades.count();
    const totalFilteredTrade = await prisma.trades.count({ where: whereClause });

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * perPage;

    const tradeHistories = await prisma.trades.findMany({
      where: whereClause,
      skip,
      take: perPage,
      orderBy: { trade_id: 'desc' } // or tradeId if camelCase
    });

    // Post-processing
    const processedTrades = tradeHistories.map((trade) => {
      const payment = trade.payment ? JSON.parse(trade.payment) : null;
      const review = trade.review ? JSON.parse(trade.review) : null;

      let payment_details = trade.payment_details
        ? `${process.env.BASE_URL || 'https://onnbit.com'}/storage/${trade.payment_details}`
        : null;

      const role = userId
        ? trade.buyer_id === userId ? 'buyer' : 'seller'
        : trade.buyer_id === trade.user_id ? 'buyer' : 'seller';

      return {
        ...trade,
        payment,
        review,
        payment_details,
        role
      };
    });

    // Pagination metadata
    const pagination = {
      current_page: page,
      per_page: perPage,
      total: totalFilteredTrade,
      last_page: Math.ceil(totalFilteredTrade / perPage),
      from: skip + 1,
      to: skip + processedTrades.length
    };
    const safeData = convertBigIntToString(processedTrades);

    return res.status(200).json({
      status: true,
      message: 'Trade history fetched successfully.',
      data: safeData,
      pagination,
      analytics: {
        totalTrade,
        totalFilteredTrade
      }
    });

  } catch (error) {
    console.error('Error fetching trade history:', error);
    return res.status(500).json({
      status: false,
      message: 'Unable to fetch trade history.',
      errors: error.message
    });
  }
};



export const getCryptoAd = async (req, res) => {
  try {
    const admin = req.admin; // from middleware

    const {
      per_page = 10,
      user_id,
      txn_type,
      cryptocurrency,
      paymentMethod,
      offerLocation,
      traderLocation,
      activeTrader,
      activeCryptoOffer,
      acceptedOffer,
      search
    } = req.query;

    // ✅ Convert pagination values properly
    const perPage = Number(per_page) > 0 ? Number(per_page) : 10;
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const skip = (page - 1) * perPage;

    // ✅ Base filter
    const where = {};

    if (user_id) where.user_id = BigInt(user_id);
    if (txn_type) where.transaction_type = txn_type;
    if (cryptocurrency) where.cryptocurrency = cryptocurrency;
    if (offerLocation) where.country = offerLocation.toLowerCase();
    if (activeCryptoOffer) where.is_active = activeCryptoOffer === "true";
    if (acceptedOffer) where.is_accepted = acceptedOffer === "true";

    // ✅ JSON filter (only works if your DB supports JSON)
    // ✅ JSON field filter for payment method
    if (paymentMethod) {
      where.payment_method = {
        contains: paymentMethod.toLowerCase(), // ✅ Prisma JSON compatible
      };
    }


    // ✅ User sub-filters
    const userWhere = {
      ...(traderLocation ? { country: traderLocation.toLowerCase() } : {}),
      ...(activeTrader === "true" ? { last_seen: { gte: new Date(Date.now() - 10 * 60 * 1000) } } : {}),
      ...(search
        ? {
          OR: [
            { username: { contains: search } },
            { email: { contains: search } },
          ],
        }
        : {}),
    };


    // ✅ Analytics counts
    const [
      totalCryptoAds,
      totalBuyCryptoAds,
      totalSellCryptoAds,
      totalActiveAds,
      totalAcceptedAds,
    ] = await Promise.all([
      prisma.crypto_ads.count(),
      prisma.crypto_ads.count({ where: { transaction_type: "buy" } }),
      prisma.crypto_ads.count({ where: { transaction_type: "sell" } }),
      prisma.crypto_ads.count({ where: { is_active: true } }),
      prisma.crypto_ads.count({ where: { is_accepted: true } }),
    ]);

    // ✅ Main Query (safe)
    const [totalFilteredDataCount, cryptoAds] = await Promise.all([
      prisma.crypto_ads.count({ where }),
      prisma.crypto_ads.findMany({
        where: {
          ...where,
          ...(Object.keys(userWhere).length > 0 && { user: userWhere }),
        },
        include: { user: true },
        orderBy: { crypto_ad_id: "desc" },
        skip,
        take: perPage,
      }),
    ]);

    // ✅ Format data
    const data = cryptoAds.map((ad) => ({
      ...ad,
      payment_method: ad.payment_method ? JSON.parse(ad.payment_method) : null,
    }));

    // ✅ Pagination info
    const pagination = {
      current_page: page,
      per_page: perPage,
      total: totalFilteredDataCount,
      last_page: Math.ceil(totalFilteredDataCount / perPage),
      next_page_url:
        page < Math.ceil(totalFilteredDataCount / perPage)
          ? `/admin/crypto-ads?page=${page + 1}`
          : null,
      prev_page_url: page > 1 ? `/admin/crypto-ads?page=${page - 1}` : null,
    };
    const safeData = convertBigIntToString(data);

    // ✅ Success Response
    return res.json({
      status: true,
      message: "Crypto advertisement fetched successfully.",
      data: safeData,
      pagination,
      analytics: {
        totalCryptoAds,
        totalBuyCryptoAds,
        totalSellCryptoAds,
        totalActiveAds,
        totalAcceptedAds,
        totalFilteredDataCount,
      },
    });
  } catch (error) {
    console.error("Error fetching crypto ads:", error);
    return res.status(500).json({
      status: false,
      message: "Something went wrong.",
      errors: error.message,
    });
  }
};
export const updateCryptoAdStatus = async (req, res) => {
  const admin = req.admin;

  let { ad_id, is_active } = req.body;

  try {

    let crypto_ad_id = ad_id;  // FIXED
    // Validate ID
    if (isNaN(crypto_ad_id)) {
      return res.status(400).json({
        status: false,
        message: "Validation failed.",
        errors: { crypto_ad_id: ["crypto_ad_id is required and must be numeric"] },
      });
    }
    crypto_ad_id = BigInt(crypto_ad_id); // FIXED
    // Fix boolean
    if (is_active === "true") is_active = true;
    if (is_active === "false") is_active = false;
    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        status: false,
        message: "Validation failed.",
        errors: { is_active: ["is_active must be boolean (true/false)"] },
      });
    }
    const result = await prisma.$transaction(async (tx) => {
      const cryptoAdDetails = await tx.crypto_ads.findUnique({
        where: { crypto_ad_id },
      });

      if (!cryptoAdDetails) {
        throw new Error("Crypto Advertisement not found for the provided id.");
      }

      if (cryptoAdDetails.is_active === is_active) {
        throw new Error(
          `Crypto Advertisement is already ${is_active ? "active" : "inactive"}.`
        );
      }

      if (cryptoAdDetails.is_accepted) {
        throw new Error(
          "The selected ad is currently involved in an active trade. Please try again later."
        );
      }

      return await tx.crypto_ads.update({
        where: { crypto_ad_id },
        data: { is_active },
      });
    });

    return res.status(200).json({
      status: true,
      message: `The Crypto ad is now ${result.is_active ? "active" : "inactive"}.`,
    });

  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to update crypto ad status.",
      errors: error.message,
    });
  }
};



export const completeRequestedPendingTrade = async (req, res) => {
  const { trade_id, amount } = req.body;

  // Validation
  if (!trade_id || isNaN(trade_id)) {
    return res.status(422).json({
      status: false,
      message: "Validation failed.",
      errors: { trade_id: "trade_id is required and must be numeric" },
    });
  }

  try {
    // Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      // Fetch trade details
      const tradeDetails = await tx.trades.findUnique({
        where: { trade_id: BigInt(trade_id) },
      });

      if (!tradeDetails) {
        throw new Error("Trade not found for the provided trade id.");
      }
      if (tradeDetails.trade_status === "success") {
        throw new Error("Trade is already completed successfully.");
      }
      if (!tradeDetails.payment_details) {
        throw new Error("Payment not done yet.");
      }
      // === Fetch wallets ===
      const sellerWallet = await tx.web3_wallets.findFirst({
        where: {
          user_id: tradeDetails.seller_id,
          asset: cryptoAsset(tradeDetails.asset),
          network: network(tradeDetails.asset),
        },
      });

      const buyerWallet = await tx.web3_wallets.findFirst({
        where: {
          user_id: tradeDetails.buyer_id,
          asset: cryptoAsset(tradeDetails.asset),
          network: network(tradeDetails.asset),
        },
      });

      if (!sellerWallet || !buyerWallet) {
        throw new Error("Seller or buyer wallet not found.");
      }

      // === Seller Transaction ===
      const sellerAvailableAmount = new Prisma.Decimal(sellerWallet.remaining_amount);
      const sellerRemainingAmount = sellerAvailableAmount.minus(
        new Prisma.Decimal(tradeDetails.hold_asset)
      );

      const sellerTxnData = {
        user_id: tradeDetails.seller_id,
        txn_type: "internal",
        from_address: sellerWallet.wallet_address,
        to_address: buyerWallet.wallet_address,
        txn_hash_id: txnHash(tradeDetails.seller_id),
        asset: sellerWallet.asset,
        network: sellerWallet.network,
        available_amount: sellerAvailableAmount,
        credit_amount: 0,
        debit_amount: tradeDetails.hold_asset,
        transfer_percentage: 0,
        transfer_fee: 0,
        paid_amount: 0,
        remaining_amount: sellerRemainingAmount,
        method: "send",
        status: "success",
        updated_buy: "Internal",
        remark: "By selling the asset",
        created_at: new Date(),
        date_time: String(Math.floor(Date.now() / 1000))  // ✔ FIXED

      };

      const transaction = await tx.transactions.create({ data: sellerTxnData });

      // Update Seller Wallet
      await tx.web3_wallets.update({
        where: { wallet_id: sellerWallet.wallet_id },
        data: {
          withdrawal_amount: new Prisma.Decimal(sellerWallet.withdrawal_amount).plus(
            new Prisma.Decimal(tradeDetails.hold_asset)
          ),
          remaining_amount: sellerRemainingAmount,
          hold_asset: new Prisma.Decimal(sellerWallet.hold_asset).minus(
            new Prisma.Decimal(tradeDetails.hold_asset)
          ),
          created_at: new Date(),
          updated_at: new Date()
        },
      });

      // === Buyer Transaction ===
      const buyerAvailableAmount = new Prisma.Decimal(buyerWallet.remaining_amount);
      const settingData = await tx.settings.findFirst({
        where: { setting_id: BigInt(1) },
      });

      if (!settingData) throw new Error("Settings not found.");

      let transferPercentage = new Prisma.Decimal(0);
      if (settingData.trade_fee_type === "percentage") {
        transferPercentage = new Prisma.Decimal(settingData.trade_fee);
      } else if (settingData.trade_fee_type === "value") {
        transferPercentage = new Prisma.Decimal(settingData.trade_fee)
          .times(100)
          .div(tradeDetails.amount);
      } else {
        throw new Error("Invalid trade fee type.");
      }

      const transferFee = new Prisma.Decimal(tradeDetails.hold_asset)
        .times(transferPercentage)
        .times(0.01);

      const paidAmount = new Prisma.Decimal(tradeDetails.hold_asset).minus(transferFee);
      const buyerRemainingAmount = buyerAvailableAmount.plus(paidAmount);

      const buyerTxnData = {
        user_id: BigInt(tradeDetails.buyer_id),
        txn_type: "internal",
        from_address: sellerWallet.wallet_address,
        to_address: buyerWallet.wallet_address,
        txn_hash_id: txnHash(tradeDetails.buyer_id),
        asset: sellerWallet.asset,
        network: sellerWallet.network,
        available_amount: buyerAvailableAmount,
        credit_amount: tradeDetails.hold_asset,
        debit_amount: 0,
        transfer_percentage: transferPercentage,
        transfer_fee: transferFee,
        paid_amount: paidAmount,
        remaining_amount: buyerRemainingAmount,
        method: "receive",
        status: "success",
        updated_buy: "Internal",
        remark: "By buying the asset",
        date_time: String(Math.floor(Date.now() / 1000))  // ✔ FIXED
      };

      await tx.transactions.create({ data: buyerTxnData });

      // Update Buyer Wallet
      await tx.web3_wallets.update({
        where: { wallet_id: BigInt(buyerWallet.wallet_id) },
        data: {
          deposit_amount: new Prisma.Decimal(buyerWallet.deposit_amount).plus(
            paidAmount
          ),
          remaining_amount: buyerRemainingAmount,
          internal_deposit: new Prisma.Decimal(buyerWallet.internal_deposit).plus(
            paidAmount
          ),
          created_at: new Date(),
          updated_at: new Date()
        },
      });

      // ✅ Return combined data
      return { tradeDetails, sellerWallet, buyerWallet };
    });

    // ✅ Commit Success Response
    return res.status(200).json({
      status: true,
      message: "Requested pending trade completed successfully.",
      data: result.tradeDetails,
      sellerWallet: result.sellerWallet,
      buyerWallet: result.buyerWallet,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to complete requested pending trade.",
      errors: error.message,
    });
  }
};