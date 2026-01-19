import { validationResult } from "express-validator";
import { convertBigIntToString } from "../../config/convertBigIntToString.js";
import prisma from "../../config/prismaClient.js";
import { cryptoAsset, getAdminDetails } from "../../config/ReusableCode.js";
import { encryptWithKey } from "../../config/EncryptDecrypt.js";
export const getAdminAssets = async (req, res) => {
    try {
        const admin = req.admin; // set by middleware (authenticated admin)
        if (!admin) {
            return res.status(401).json({
                status: false,
                message: "Admin not authenticated",
            });
        }

        const { asset, network } = req.query;

        // Build where condition dynamically
        const whereClause = {
            admin_id: BigInt(admin.admin_id),
            ...(asset ? { asset } : {}),
            ...(network ? { network } : {}),
        };

        // Fetch admin assets
        const adminAssets = await prisma.admin_assets.findMany({
            where: whereClause,
        });

        // Format response data
        const requiredData = adminAssets.map((adminAsset) => ({
            admin_id: adminAsset.admin_id,
            asset: adminAsset.asset,
            asset_ticker: adminAsset.asset_ticker,
            blockchain: adminAsset.blockchain,
            network: adminAsset.network,
            wallet_address: adminAsset.wallet_address,
            wallet_key: adminAsset.wallet_key,
            contract_address: adminAsset.contract_address,
            total_deposit: adminAsset.total_deposit,
            total_withdraw: adminAsset.total_withdraw,
            available_balance: adminAsset.available_balance,
            withdrawal_fee_type: adminAsset.withdrawal_fee_type,
            withdrawal_fee: adminAsset.withdrawal_fee,
            total_revenue: adminAsset.total_revenue,
            withdrawal_type: adminAsset.withdrawal_type,
            status: adminAsset.status,
            conversion_fee_type: adminAsset.conversion_fee_type,
            conversion_fee: adminAsset.conversion_fee,
            last_updated_by: adminAsset.last_updated_by
                ? JSON.parse(adminAsset.last_updated_by)
                : null,
        }));
        const safeData = convertBigIntToString(requiredData);

        return res.status(200).json({
            status: true,
            message: "Admin assets fetched successfully",
            data: safeData,
        });
    } catch (error) {
        console.error("Error fetching admin assets:", error);
        return res.status(500).json({
            status: false,
            message: "Unable to fetch admin assets",
            error: error.message,
        });
    }
};

export const createAdminAsset = async (req, res) => {
    try {
        const admin = req.admin; // logged-in admin

        // Validate request (express-validator recommended)
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: errors.array(),
            });
        }

        const {
            asset,
            network,
            blockchain,
            wallet_address,
            wallet_key,
            contract_address,
            withdrawal_fee_type,
            withdrawal_fee,
            withdrawal_type,
            conversion_fee_type,
            conversion_fee,
        } = req.body;

        // 1️⃣ Validate Blockchain + Network + Asset combinations
        const isValidCombo =
            (blockchain === "ethereum" &&
                network === "erc20" &&
                ["ethereum", "tether"].includes(asset)) ||
            (blockchain === "binance" &&
                network === "bep20" &&
                asset === "binance") ||
            (blockchain === "tron" &&
                network === "trc20" &&
                asset === "tether") ||
            (blockchain === "bitcoin" && network === "btc" && asset === "bitcoin");

        if (!isValidCombo) {
            return res.status(422).json({
                status: false,
                message: "Invalid blockchain and network combination for the selected asset.",
            });
        }

        // 2️⃣ Check if asset already exists (unique for asset + network + blockchain)
        const existingAsset = await prisma.admin_assets.findFirst({
            where: {
                asset,
                network,
                blockchain,
            },
        });

        if (existingAsset) {
            return res.status(422).json({
                status: false,
                message: "Asset already exists for the provided network and blockchain.",
            });
        }

        // 3️⃣ Wallet address unique check (optional)
        // const existingAddress = await prisma.admin_assets.findFirst({
        //   where: { wallet_address },
        // });
        // if (existingAddress) {
        //   return res.status(422).json({
        //     status: false,
        //     message: "An asset with this wallet address is already stored.",
        //   });
        // }


        const encryptedWalletKey = encryptWithKey(wallet_key, String(admin.admin_id))

        // 5️⃣ Required Data (similar to Laravel)
        const data = {
            admin_id: admin.admin_id,
            asset,
            asset_ticker: cryptoAsset(asset), // helper function below
            blockchain,
            network,
            wallet_address,
            wallet_key: encryptedWalletKey,
            contract_address,
            total_deposit: "0",
            total_withdraw: "0",
            available_balance: "0",
            withdrawal_fee_type,
            withdrawal_fee: withdrawal_fee || "0",
            total_revenue: "0",
            withdrawal_type,
            status: "active",
            conversion_fee_type,
            conversion_fee: conversion_fee || "0",
            last_updated_by: JSON.stringify(getAdminDetails(admin)),
        };

        // 6️⃣ Create Asset
        await prisma.admin_assets.create({ data });

        return res.status(201).json({
            status: true,
            message: "Admin Asset created successfully.",
        });
    } catch (err) {
        console.error("Admin asset error", err);
        return res.status(500).json({
            status: false,
            message: "Unable to update admin assets.",
            errors: err.message,
        });
    }
};


export const updateAdminAssets = async (req, res) => {
  try {
    const admin = req.admin; // logged-in admin

    // Validate incoming fields
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: errors.array(),
      });
    }

    const {
      admin_asset_id,
      contract_address,
      withdrawal_fee_type,
      withdrawal_fee,
      withdrawal_type,
      status,
      conversion_fee_type,
      conversion_fee
    } = req.body;

    const updatableFields = {
      contract_address,
      withdrawal_fee_type,
      withdrawal_fee,
      withdrawal_type,
      status,
      conversion_fee_type,
      conversion_fee
    };

    // 1️⃣ Check if at least one field has a value
    const hasAtLeastOneField = Object.values(updatableFields).some(
      (value) => value !== undefined && value !== null && value !== ""
    );

    if (!hasAtLeastOneField) {
      return res.status(422).json({
        status: false,
        message: "Validation failed.",
        errors: { fields: ["At least one field is required."] },
      });
    }

    // 2️⃣ Verify admin asset exists
    const adminAsset = await prisma.admin_assets.findFirst({
      where: {
        admin_asset_id: BigInt(admin_asset_id),
        admin_id: BigInt(admin.admin_id)
      },
    });

    if (!adminAsset) {
      return res.status(404).json({
        status: false,
        message: "Admin Asset not found for the provided id.",
      });
    }

    // 3️⃣ Build update payload
    let updateData = {};
    for (const key in updatableFields) {
      const value = updatableFields[key];
      if (value !== undefined && value !== null && value !== "") {
        updateData[key] = value;
      }
    }

    updateData.last_updated_by = JSON.stringify({
      admin_id: admin.admin_id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    });

    // 4️⃣ Update in DB
    await prisma.admin_assets.update({
      where: { admin_asset_id: BigInt(admin_asset_id) },
      data: updateData,
    });

    return res.status(200).json({
      status: true,
      message: "Admin Asset updated successfully.",
    });

  } catch (err) {
    console.error("Admin asset update error:", err);

    return res.status(500).json({
      status: false,
      message: "Unable to update admin assets.",
      errors: err.message,
    });
  }
};
