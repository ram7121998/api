import moment from "moment";
import prisma from "../../config/prismaClient.js";
import axios from "axios";
import { Prisma } from "@prisma/client";
import dayjs from "dayjs";
import { cryptoAsset, feeDetails, fullAssetName, network, truncateDecimal, txnHash } from "../../config/ReusableCode.js";
export const getTransactionDetails = async (req, res) => {
    const user = req.user; // assume user injected from auth middleware
    try {
        // ---------------------------------------------------------------------
        // 1️⃣ Fetch wallet details and update transactions
        // ---------------------------------------------------------------------
        const web3WalletDetails = await prisma.web3_wallets.findMany({
            where: { user_id: BigInt(user.user_id) },
        });
        for (let web3WalletDetail of web3WalletDetails) {
            const result = await updateTransactions(user, web3WalletDetail);
            if (!result.status) {
                throw new Error(result.message);
            }
        }
        // ---------------------------------------------------------------------
        // 2️⃣ Build Query
        // ---------------------------------------------------------------------
        const perPage = Number(req.query.per_page) || 10;
        const page = Number(req.query.page) || 1;
        let where = { user_id: user.user_id };
        // ------------------ Date Filters ------------------
        let startDate = req.query.start_date
            ? moment(req.query.start_date, "DD-MM-YYYY").startOf("day").toDate()
            : null;
        let endDate = req.query.end_date
            ? moment(req.query.end_date, "DD-MM-YYYY").endOf("day").toDate()
            : null;
        if (startDate && endDate) {
            where.created_at = { gte: startDate, lte: endDate };
        }
        else if (startDate) {
            where.created_at = { gte: startDate };
        }
        else if (endDate) {
            where.created_at = { lte: endDate };
        }
        // ------------------ Txn Hash Filter ------------------
        if (req.query.txn_hash) {
            where.txn_hash_id = req.query.txn_hash;
        }
        // ------------------ Crypto Filter ------------------
        if (req.query.cryptocurrency) {
            const asset = cryptoAsset(req.query.cryptocurrency.toLowerCase());
            where.asset = asset;
        }
        // ------------------ Status Filter ------------------
        if (req.query.status) {
            where.status = req.query.status;
        }
        // ---------------------------------------------------------------------
        // 3️⃣ Fetch Paginated Data
        // ---------------------------------------------------------------------
        const [items, total] = await Promise.all([
            prisma.transactions.findMany({
                where,
                orderBy: { txn_id: "desc" },
                skip: (page - 1) * perPage,
                take: perPage
            }),
            prisma.transactions.count({ where }),
        ]);
        // Convert date_time string → timestamp
        items.forEach((item) => {
            const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
            if (regex.test(item.date_time)) {
                item.date_time = Math.floor(new Date(item.date_time).getTime() / 1000);
            }
        });
        // ---------------------------------------------------------------------
        // 4️⃣ Pagination Response (Same as Laravel)
        // ---------------------------------------------------------------------
        const lastPage = Math.ceil(total / perPage);
        const pagination = {
            current_page: page,
            from: (page - 1) * perPage + 1,
            first_page_url: `?page=1`,
            last_page: lastPage,
            last_page_url: `?page=${lastPage}`,
            next_page_url: page < lastPage ? `?page=${page + 1}` : null,
            prev_page_url: page > 1 ? `?page=${page - 1}` : null,
            path: req.originalUrl.split("?")[0],
            per_page: perPage,
            to: (page - 1) * perPage + items.length,
            total,
        };
        return res.json({
            status: true,
            message: "Transaction details fetched successfully.",
            data: items,
            pagination,
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Unable to fetch transaction details.",
            errors: error.message,
        });
    }
};
export const sendAsset = async (req, res) => {
    const user = req.user; // logged-in user
    try {
        // Normalize asset + network
        const asset = req.body.asset?.toLowerCase();
        const network = req.body.network?.toLowerCase();
        // ----------------------------
        // VALIDATION
        // ----------------------------
        if (!["erc20", "bep20", "btc"].includes(network))
            return res.status(422).json({ status: false, message: "Invalid network" });
        if (!["eth", "bnb", "usdt", "btc"].includes(asset))
            return res.status(422).json({ status: false, message: "Invalid asset" });
        const { wallet_address, username, assetValue } = req.body;
        if (!assetValue || assetValue < 0.000006)
            return res.status(422).json({
                status: false,
                message: "Invalid asset value",
            });
        // Only one of wallet_address or username should be provided
        if (wallet_address && username)
            return res.status(422).json({
                status: false,
                message: "Provide either wallet_address or username, not both.",
            });
        if (!wallet_address && !username)
            return res.status(422).json({
                status: false,
                message: "Either username or wallet_address is required.",
            });
        // -----------------------------------------------------
        // Fetch asset settings
        console.log("Asset Value:", asset);
        console.log("Full Asset Name:", fullAssetName(asset));
        console.log("Network:", network);
        // -----------------------------------------------------
        const mainAssetDetails = await prisma.admin_assets.findFirst({
            where: { asset: fullAssetName(asset), network },
        });
        console.log(mainAssetDetails);
        if (!mainAssetDetails)
            return res.status(404).json({ status: false, message: "Asset not found." });
        if (mainAssetDetails.status !== "active")
            return res.status(400).json({
                status: false,
                message: "You cannot make transaction because asset address is not active.",
            });
        // Start transaction
        const result = await prisma.$transaction(async (tx) => {
            //-----------------------------------------
            // Sender Wallet
            //-----------------------------------------
            const senderWallet = await tx.web3_wallets.findFirst({
                where: { user_id: BigInt(user.user_id), asset, network },
            });
            if (!senderWallet)
                throw new Error("Sender wallet not found.");
            if (Number(senderWallet.remaining_amount) < Number(assetValue))
                throw new Error("You have insufficient asset.");
            //-----------------------------------------
            // Receiver Wallet (Find by username OR wallet_address)
            //-----------------------------------------
            console.log("⚡ Incoming username:", username);
            console.log("⚡ Logged-in user:", user);
            let receiverUser, receiverWallet;
            if (username) {
                console.log("Searching user with username:", username);
                receiverUser = await tx.users.findFirst({
                    where: {
                        username: username,
                        user_id: { not: user.user_id }
                    },
                });
                console.log("🔍 Receiver User Query Result:", receiverUser);
                if (!receiverUser)
                    throw new Error("Receiver user not found.");
                console.log("Searching wallet for:", {
                    receiver_user_id: receiverUser.user_id,
                    asset,
                    network
                });
                receiverWallet = await tx.web3_wallets.findFirst({
                    where: {
                        user_id: BigInt(receiverUser.user_id),
                        asset,
                        network,
                    },
                });
                console.log("🔍 Receiver Wallet Query Result:", receiverWallet);
            }
            else if (wallet_address) {
                console.log("Searching wallet with address:", wallet_address);
                receiverWallet = await tx.web3_wallets.findFirst({
                    where: {
                        wallet_address,
                        user_id: { not: user.user_id },
                        asset,
                        network,
                    },
                });
                console.log("🔍 Wallet Query Result:", receiverWallet);
                if (!receiverWallet)
                    throw new Error("Receiver wallet not found.");
                receiverUser = await tx.users.findUnique({
                    where: { user_id: BigInt(receiverWallet.user_id) },
                });
                console.log("🔍 Receiver User From Wallet:", receiverUser);
            }
            console.log("Final ReceiverWallet:", receiverWallet);
            if (!receiverWallet)
                throw new Error("Receiver wallet not found. last");
            //-----------------------------------------
            // Sender Transaction
            //-----------------------------------------
            const senderRemaining = Number(senderWallet.remaining_amount) - Number(assetValue);
            const senderTxn = await tx.transactions.create({
                data: {
                    user_id: user.user_id,
                    txn_type: "internal",
                    from_address: senderWallet.wallet_address,
                    to_address: receiverWallet.wallet_address,
                    txn_hash_id: txnHash(user.user_id),
                    asset,
                    network,
                    available_amount: senderWallet.remaining_amount,
                    credit_amount: 0,
                    debit_amount: assetValue,
                    transfer_percentage: 0,
                    transfer_fee: 0,
                    paid_amount: 0,
                    remaining_amount: senderRemaining,
                    method: "send",
                    status: "success",
                    updated_buy: "Internal",
                    remark: "By transfer of asset.",
                    date_time: String(dayjs().unix()),
                },
            });
            await tx.web3_wallets.update({
                where: { wallet_id: BigInt(senderWallet.wallet_id) },
                data: {
                    withdrawal_amount: new Prisma.Decimal(senderWallet.withdrawal_amount).plus(assetValue),
                    remaining_amount: senderRemaining,
                },
            });
            //-----------------------------------------
            // Fee Logic
            //-----------------------------------------
            const { transferFee, transferPercentage } = feeDetails(mainAssetDetails.withdrawal_fee_type, mainAssetDetails.withdrawal_fee, assetValue);
            const paidAmount = Number(assetValue) - Number(transferFee);
            const receiverRemaining = Number(receiverWallet.remaining_amount) + paidAmount;
            console.log("mainAssetDetails");
            await tx.admin_assets.update({
                where: { admin_asset_id: mainAssetDetails.admin_asset_id },
                data: {
                    total_revenue: new Prisma.Decimal(mainAssetDetails.total_revenue).plus(transferFee),
                },
            });
            //-----------------------------------------
            // Receiver Transaction
            //-----------------------------------------
            const receiverTxn = await tx.transactions.create({
                data: {
                    user_id: BigInt(receiverUser.user_id),
                    txn_type: "internal",
                    from_address: senderWallet.wallet_address,
                    to_address: receiverWallet.wallet_address,
                    txn_hash_id: txnHash(receiverUser.user_id),
                    asset,
                    network,
                    available_amount: receiverWallet.remaining_amount,
                    credit_amount: assetValue,
                    debit_amount: 0,
                    transfer_percentage: truncateDecimal(transferPercentage, 4),
                    transfer_fee: truncateDecimal(transferFee, 18),
                    paid_amount: paidAmount,
                    remaining_amount: receiverRemaining,
                    method: "receive",
                    status: "success",
                    updated_buy: "Internal",
                    remark: "Asset Received.",
                    date_time: String(dayjs().unix()),
                },
            });
            await tx.web3_wallets.update({
                where: { wallet_id: receiverWallet.wallet_id },
                data: {
                    deposit_amount: new Prisma.Decimal(receiverWallet.deposit_amount).plus(paidAmount),
                    internal_deposit: new Prisma.Decimal(receiverWallet.internal_deposit).plus(paidAmount),
                    remaining_amount: receiverRemaining,
                },
            });
            //-----------------------------------------
            // Notifications
            //-----------------------------------------
            const senderNotification = await tx.notifications.create({
                data: {
                    user_id: BigInt(user.user_id),
                    title: "Asset transferred successfully!",
                    message: `You sent ${assetValue} ${fullAssetName(asset)} to ${wallet_address ?? username}.`,
                    operation_type: "internal transaction",
                    operation_id: String(senderTxn.txn_id),
                    type: "trade",
                    is_read: false,
                    created_at: new Date(),
                },
            });
            const receiverNotification = await tx.notifications.create({
                data: {
                    user_id: BigInt(receiverUser.user_id),
                    title: "You Received an Asset",
                    message: `You received ${assetValue} ${fullAssetName(asset)} from ${senderWallet.wallet_address}.`,
                    operation_type: "internal transaction",
                    operation_id: String(receiverTxn.txn_id),
                    type: "trade",
                    is_read: false,
                    created_at: new Date(),
                },
            });
            io.to(senderNotification.user_id.toString()).emit("new_notification", senderNotification);
            io.to(receiverNotification.user_id.toString()).emit("new_notification", receiverNotification);
            return true;
        });
        return res.json({
            status: true,
            message: "Transaction completed successfully.",
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to complete transaction.",
            errors: err.message,
        });
    }
};
export async function updateTransactions(user, web3WalletDetails) {
    try {
        const network = web3WalletDetails.network;
        const asset = web3WalletDetails.asset;
        const transactionMethod = "receive";
        const validCombinations = {
            erc20: ["eth", "usdt"],
            trc20: ["usdt"],
            bep20: ["bnb"],
            btc: ["btc"]
        };
        if (!validCombinations[network] || !validCombinations[network].includes(asset)) {
            return {
                status: false,
                message: `Invalid request for ${asset} asset and ${network} network.`
            };
        }
        // ---------------------- Helper to fetch transactions ----------------------
        const fetchTransactions = async (url, params) => {
            const response = await axios.get(url, { params });
            if (!response?.data)
                return [];
            return Array.isArray(response.data.result) ? response.data.result.reverse() : [];
        };
        // ---------------------- ERC20 ETH ----------------------
        if (network === "erc20" && asset === "eth") {
            const url = "https://api-sepolia.etherscan.io/api";
            const params = {
                module: "account",
                action: "txlist",
                address: web3WalletDetails.wallet_address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 10000,
                sort: "desc",
                apikey: process.env.ETHERSCAN_KEY
            };
            const results = await fetchTransactions(url, params);
            for (let tx of results) {
                if (tx.to.toLowerCase() !== web3WalletDetails.wallet_address.toLowerCase())
                    continue;
                const exists = await prisma.transactions.findFirst({
                    where: { user_id: user.user_id, txn_hash_id: tx.hash }
                });
                if (exists)
                    continue;
                const lastTx = await prisma.transactions.findFirst({
                    where: { user_id: user.user_id, network, asset },
                    orderBy: { txn_id: "desc" }
                });
                const available_amount = lastTx?.remaining_amount || 0;
                const credit = Number(tx.value) / 1e18;
                await prisma.transactions.create({
                    data: {
                        user_id: user.user_id,
                        txn_type: "web3",
                        from_address: tx.from,
                        to_address: tx.to,
                        txn_hash_id: tx.hash,
                        asset,
                        network,
                        available_amount,
                        credit_amount: credit,
                        debit_amount: 0,
                        paid_amount: credit,
                        remaining_amount: available_amount + credit,
                        method: transactionMethod,
                        status: "success",
                        updated_buy: "web3 auto",
                        created_at: new Date(),
                        updated_at: new Date(),
                        remark: "Web3 Auto",
                        date_time: new Date(tx.timeStamp * 1000) // convert timestamp to JS date
                    }
                });
                // Update user wallet
                await prisma.web3_wallets.update({
                    where: { wallet_id: web3WalletDetails.wallet_id },
                    data: {
                        deposit_amount: { increment: credit },
                        web3_deposit: { increment: credit },
                        remaining_amount: { increment: credit },
                        created_at: new Date(),
                        updated_at: new Date()
                    }
                });
                // Update admin asset
                await prisma.admin_assets.update({
                    where: { asset_network: { asset, network } },
                    data: {
                        total_deposit: { increment: credit },
                        available_balance: { increment: credit }
                    }
                });
            }
            console.log("ERC20 ETH transactions updated successfully");
            return { status: true, message: "ERC20 ETH transactions updated" };
        }
        // ---------------------- BEP20 BNB ----------------------
        if (network === "bep20" && asset === "bnb") {
            const url = "https://api-testnet.bscscan.com/api";
            const params = {
                module: "account",
                action: "txlist",
                address: web3WalletDetails.wallet_address,
                startblock: 0,
                endblock: 99999999,
                page: 1,
                offset: 10000,
                sort: "desc",
                apikey: process.env.BSCSCAN_KEY
            };
            const results = await fetchTransactions(url, params);
            for (let tx of results) {
                if (tx.to.toLowerCase() !== web3WalletDetails.wallet_address.toLowerCase())
                    continue;
                const exists = await prisma.transactions.findFirst({
                    where: { user_id: user.user_id, txn_hash_id: tx.hash }
                });
                if (exists)
                    continue;
                const lastTx = await prisma.transactions.findFirst({
                    where: { user_id: user.user_id, network, asset },
                    orderBy: { txn_id: "desc" }
                });
                const available_amount = lastTx?.remaining_amount || 0;
                const credit = Number(tx.value) / 1e18;
                await prisma.transactions.create({
                    data: {
                        user_id: user.user_id,
                        txn_type: "web3",
                        from_address: tx.from,
                        to_address: tx.to,
                        txn_hash_id: tx.hash,
                        asset,
                        network,
                        available_amount,
                        credit_amount: credit,
                        debit_amount: 0,
                        paid_amount: credit,
                        remaining_amount: available_amount + credit,
                        method: transactionMethod,
                        status: "success",
                        updated_buy: "web3 auto",
                        remark: "Web3 Auto",
                        created_at: new Date(),
                        updated_at: new Date(),
                        date_time: new Date(tx.timeStamp * 1000)
                    }
                });
                await prisma.web3_wallets.update({
                    where: { wallet_id: web3WalletDetails.wallet_id },
                    data: {
                        deposit_amount: { increment: credit },
                        web3_deposit: { increment: credit },
                        remaining_amount: { increment: credit },
                        created_at: new Date(),
                        updated_at: new Date()
                    }
                });
                await prisma.admin_assets.update({
                    where: { asset_network: { asset, network } },
                    data: {
                        total_deposit: { increment: credit },
                        available_balance: { increment: credit }
                    }
                });
            }
            console.log("BEP20 BNB transactions updated successfully");
            return { status: true, message: "BEP20 BNB transactions updated" };
        }
        // ---------------------- ERC20 USDT ----------------------
        if (network === "erc20" && asset === "usdt") {
            const url = "https://api-sepolia.etherscan.io/api";
            const params = {
                module: "account",
                action: "tokentx",
                contractaddress: "0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9",
                address: web3WalletDetails.wallet_address,
                page: 1,
                offset: 10000,
                sort: "desc",
                apikey: process.env.ETHERSCAN_KEY
            };
            const results = await fetchTransactions(url, params);
            for (let tx of results) {
                if (tx.to.toLowerCase() !== web3WalletDetails.wallet_address.toLowerCase())
                    continue;
                const exists = await prisma.transactions.findFirst({
                    where: { user_id: user.user_id, txn_hash_id: tx.hash }
                });
                if (exists)
                    continue;
                const lastTx = await prisma.transactions.findFirst({
                    where: { user_id: user.user_id, network, asset },
                    orderBy: { txn_id: "desc" }
                });
                const available_amount = lastTx?.remaining_amount || 0;
                const credit = Number(tx.value) / 1e6;
                await prisma.transactions.create({
                    data: {
                        user_id: user.user_id,
                        txn_type: "web3",
                        from_address: tx.from,
                        to_address: tx.to,
                        txn_hash_id: tx.hash,
                        asset,
                        network,
                        available_amount,
                        credit_amount: credit,
                        debit_amount: 0,
                        paid_amount: credit,
                        remaining_amount: available_amount + credit,
                        method: transactionMethod,
                        status: "success",
                        updated_buy: "web3 auto",
                        remark: "Web3 Auto",
                        created_at: new Date(),
                        updated_at: new Date(),
                        date_time: new Date(tx.timeStamp * 1000)
                    }
                });
                await prisma.web3_wallets.update({
                    where: { wallet_id: web3WalletDetails.wallet_id },
                    data: {
                        deposit_amount: { increment: credit },
                        web3_deposit: { increment: credit },
                        remaining_amount: { increment: credit },
                        created_at: new Date(),
                        updated_at: new Date()
                    }
                });
                await prisma.admin_assets.update({
                    where: { asset_network: { asset, network } },
                    data: {
                        total_deposit: { increment: credit },
                        available_balance: { increment: credit }
                    }
                });
            }
            console.log("ERC20 USDT transactions updated successfully");
            return { status: true, message: "ERC20 USDT transactions updated" };
        }
        // ---------------------- TRC20 USDT ----------------------
        if (network === "trc20" && asset === "usdt") {
            return { status: true, message: "This API is for TRC20 - USDT only" };
        }
        return { status: true, message: "Completed" };
    }
    catch (error) {
        console.error("Error in updateTransactions:", error);
        return { status: false, message: error.message };
    }
}
export const convertAsset = async (req, res) => {
    const user = req.user;
    try {
        // ============================
        // VALIDATION
        // ============================
        const { fromAsset, fromAssetValue, fromAssetTotalValue, toAsset, toAssetValue } = req.body;
        if (!["eth", "bnb", "usdt", "btc"].includes(fromAsset)) {
            return res.status(422).json({
                status: false,
                message: "Invalid fromAsset value.",
            });
        }
        if (!["eth", "bnb", "usdt", "btc"].includes(toAsset)) {
            return res.status(422).json({
                status: false,
                message: "Invalid toAsset value.",
            });
        }
        if (fromAsset === toAsset) {
            return res.status(422).json({
                status: false,
                message: `Converting ${fromAsset} to same asset is not allowed.`,
            });
        }
        if (Number(fromAssetValue) <= 0) {
            return res.status(422).json({
                status: false,
                message: `${fromAsset} value must be greater than zero.`,
            });
        }
        if (Number(toAssetValue) <= 0) {
            return res.status(422).json({
                status: false,
                message: `${toAsset} value must be greater than zero.`,
            });
        }
        // ============================
        // Network Resolver
        // ============================
        const fullAssetNames = (asset) => {
            return asset.toUpperCase();
        };
        const fromNetwork = network(fullAssetNames(fromAsset));
        const toNetwork = network(toAsset);
        // ============================
        // WALLET FETCH
        // ============================
        const fromAssetWallet = await prisma.web3_wallets.findFirst({
            where: {
                user_id: BigInt(user.user_id),
                asset: fromAsset,
                network: fromNetwork,
            },
        });
        const toAssetWallet = await prisma.web3_wallets.findFirst({
            where: {
                user_id: BigInt(user.user_id),
                asset: toAsset,
                network: toNetwork,
            },
        });
        console.log(fullAssetNames(fromAsset), fromNetwork);
        const adminFromAsset = await prisma.admin_assets.findFirst({
            where: {
                asset: fullAssetName(fromAsset),
                network: fromNetwork,
            },
        });
        console.log("eb", fullAssetName(toAsset), toNetwork);
        const adminToAsset = await prisma.admin_assets.findFirst({
            where: {
                asset: fullAssetName(toAsset),
                network: toNetwork,
            },
        });
        console.log(fromAssetWallet, toAssetWallet, adminFromAsset, adminToAsset);
        if (!fromAssetWallet || !toAssetWallet || !adminFromAsset || !adminToAsset) {
            return res.status(400).json({
                status: false,
                message: "Wallet details not found for the specified asset.",
            });
        }
        if (fromAssetWallet.status !== "active" ||
            toAssetWallet.status !== "active" ||
            adminFromAsset.status !== "active" ||
            adminToAsset.status !== "active") {
            return res.status(400).json({
                status: false,
                message: "You cannot make transaction because address is not active.",
            });
        }
        if (fromAssetWallet.remaining_amount < Number(fromAssetValue) ||
            adminFromAsset.available_balance < Number(fromAssetValue)) {
            return res.status(400).json({
                status: false,
                message: "Insufficient balance in your wallet.",
            });
        }
        // ============================
        // START TRANSACTION
        // ============================
        const result = await prisma.$transaction(async (tx) => {
            const fee = adminFromAsset.conversion_fee || 0;
            console.log("fee", fee);
            const feeType = adminFromAsset.conversion_fee_type;
            console.log("feeType", feeType);
            const transferFee = feeType === "percentage"
                ? (Number(fromAssetValue) * fee) / 100
                : fee;
            const transferPercentage = feeType === "percentage" ? fee : 0;
            const totalFromValue = Number(fromAssetValue) + transferFee;
            // Safe comparison
            const backendValue = Number(totalFromValue.toFixed(8));
            const userValue = Number(Number(fromAssetTotalValue).toFixed(8));
            console.log("backendValue:", backendValue);
            console.log("userValue:", userValue);
            if (backendValue !== userValue) {
                throw new Error("The total asset value does not match expected value.");
            }
            // UPDATE user wallet (fromAsset)
            const fromRemaining = fromAssetWallet.remaining_amount - totalFromValue;
            await tx.web3_wallets.update({
                where: { wallet_id: BigInt(fromAssetWallet.wallet_id) },
                data: {
                    withdrawal_amount: Number(fromAssetWallet.withdrawal_amount) + totalFromValue,
                    remaining_amount: Number(fromRemaining),
                    created_at: new Date(),
                    updated_at: new Date()
                },
            });
            // UPDATE admin (fromAsset)
            await tx.admin_assets.update({
                where: { admin_asset_id: BigInt(adminFromAsset.admin_asset_id) },
                data: {
                    total_revenue: Number(adminFromAsset.total_revenue) + Number(transferFee),
                    total_withdraw: Number(adminFromAsset.total_withdraw) + Number(totalFromValue),
                    available_balance: Number(adminFromAsset.total_deposit) -
                        (Number(adminFromAsset.total_withdraw) + Number(totalFromValue)),
                },
            });
            // UPDATE user wallet (toAsset)
            const toRemaining = Number(toAssetWallet.remaining_amount) + Number(toAssetValue);
            await tx.web3_wallets.update({
                where: { wallet_id: BigInt(toAssetWallet.wallet_id) },
                data: {
                    deposit_amount: Number(toAssetWallet.deposit_amount) + Number(toAssetValue),
                    remaining_amount: Number(toRemaining),
                    internal_deposit: Number(toAssetWallet.internal_deposit) + Number(toAssetValue),
                },
            });
            // UPDATE admin (toAsset)
            await tx.
                admin_assets.update({
                where: { admin_asset_id: BigInt(adminToAsset.admin_asset_id) },
                data: {
                    total_deposit: Number(adminToAsset.total_deposit) + Number(toAssetValue),
                    available_balance: Number(adminToAsset.total_deposit) +
                        Number(toAssetValue) -
                        adminToAsset.total_withdraw,
                },
            });
            // CREATE TRANSACTIONS
            const txnHash = `TXN-${Date.now()}-${user.user_id}`;
            await tx.transactions.create({
                data: {
                    user_id: Number(user.user_id),
                    txn_type: "internal",
                    from_address: fromAssetWallet.wallet_address,
                    to_address: toAssetWallet.wallet_address,
                    txn_hash_id: txnHash,
                    asset: fromAsset,
                    network: fromNetwork,
                    available_amount: fromAssetWallet.remaining_amount,
                    credit_amount: 0,
                    debit_amount: totalFromValue,
                    transfer_percentage: transferPercentage,
                    transfer_fee: transferFee,
                    paid_amount: 0,
                    remaining_amount: fromRemaining,
                    method: "send",
                    status: "success",
                    updated_buy: "Internal",
                    remark: "By conversion of asset.",
                    created_at: new Date(),
                    updated_at: new Date(),
                    date_time: String(dayjs().unix()),
                },
            });
            await tx.transactions.create({
                data: {
                    user_id: Number(user.user_id),
                    txn_type: "internal",
                    from_address: fromAssetWallet.wallet_address,
                    to_address: toAssetWallet.wallet_address,
                    txn_hash_id: txnHash,
                    asset: toAsset,
                    network: toNetwork,
                    available_amount: toAssetWallet.remaining_amount,
                    credit_amount: Number(toAssetValue),
                    debit_amount: 0,
                    transfer_percentage: 0,
                    transfer_fee: 0,
                    paid_amount: Number(toAssetValue),
                    remaining_amount: toRemaining,
                    method: "receive",
                    status: "success",
                    updated_buy: "Internal",
                    remark: "By conversion of asset.",
                    created_at: new Date(),
                    updated_at: new Date(),
                    date_time: String(dayjs().unix()),
                },
            });
            return true;
        });
        return res.status(200).json({
            status: true,
            message: "Asset converted successfully.",
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to convert asset.",
            errors: err.message,
        });
    }
};
export const transactionUsingAddress = async (req, res) => {
    const user = req.user; // from middleware
    try {
        const { asset, network, toAddress, assetValue, totalAsset } = req.body;
        // ============================
        // VALIDATION
        // ============================
        if (!asset || !["eth", "bnb", "usdt", "btc"].includes(asset)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: { asset: "Invalid asset" }
            });
        }
        if (!network || !["erc20", "trc20", "bep20", "btc"].includes(network)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: { network: "Invalid network" }
            });
        }
        if (!toAddress) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: { toAddress: "toAddress is required" }
            });
        }
        const _assetValue = Number(assetValue);
        const _totalAsset = Number(totalAsset);
        if (_assetValue <= 0 || _totalAsset <= 0) {
            throw new Error("Asset value can not be zero.");
        }
        await prisma.$transaction(async (tx) => {
            // ======================================
            // FETCH ADMIN ASSET DETAILS
            // ======================================
            const adminAsset = await tx.admin_assets.findFirst({
                where: {
                    asset: fullAssetName(asset),
                    network: network
                }
            });
            if (!adminAsset)
                throw new Error("Asset not found.");
            if (adminAsset.status !== "active") {
                throw new Error("You can not make transaction because address is not active.");
            }
            // ======================================
            // FETCH SENDER WALLET DETAILS
            // ======================================
            const senderWallet = await tx.web3_wallets.findFirst({
                where: {
                    user_id: BigInt(user.user_id),
                    asset: asset,
                    network: network
                }
            });
            if (!senderWallet)
                throw new Error("Sender wallet not found.");
            if (senderWallet.wallet_address === toAddress) {
                throw new Error("You can not send asset to same wallet address.");
            }
            if (senderWallet.status !== "active") {
                throw new Error("You can not make transaction because address is not active.");
            }
            // ======================================
            // CHECK BALANCE
            // ======================================
            const availableBalance = Number(senderWallet.remaining_amount);
            const holdAsset = Number(senderWallet.hold_asset);
            if ((availableBalance - holdAsset) < _totalAsset) {
                throw new Error("You have insufficient asset amount to send.");
            }
            // ======================================
            // CALCULATE FEES
            // ======================================
            const feeType = adminAsset.withdrawal_fee_type; // percent/fixed
            const fee = Number(adminAsset.withdrawal_fee);
            console.log(fee);
            const transferFee = feeType === "percentage" ? (_assetValue * fee) / 100 : fee;
            const transferPercentage = feeType === "percentage" ? fee : 0;
            const internalTotalAsset = _assetValue + transferFee;
            console.log(internalTotalAsset);
            console.log(_totalAsset);
            if (Number(internalTotalAsset.toFixed(18)) !== Number(_totalAsset.toFixed(18))) {
                throw new Error("Asset value and transfer fee mismatch.");
            }
            // ======================================
            // UPDATE SENDER WALLET
            // ======================================
            const senderRemaining = availableBalance - _totalAsset;
            // ======================================
            // AUTO / MANUAL LOGIC
            // ======================================
            const transactionData = {
                user_id: BigInt(user.user_id),
                txn_type: "web3",
                from_address: adminAsset.wallet_address,
                to_address: toAddress,
                txn_hash_id: null,
                asset: asset,
                network: network,
                available_amount: availableBalance,
                credit_amount: 0,
                debit_amount: _totalAsset,
                transfer_percentage: transferPercentage,
                transfer_fee: transferFee,
                paid_amount: _assetValue,
                remaining_amount: senderRemaining,
                hold_asset: _totalAsset,
                method: "send",
                status: "pending",
                updated_buy: adminAsset.withdrawal_type === "auto" ? "web3 auto" : "web3 manual",
                remark: adminAsset.withdrawal_type === "auto" ? "Web3 Auto" : "Web3 Manual",
                date_time: null,
                created_at: new Date(),
                updated_at: new Date(),
            };
            const transaction = await tx.transactions.create({
                data: transactionData
            });
            // UPDATE WALLET
            await tx.web3_wallets.update({
                where: { wallet_id: BigInt(senderWallet.wallet_id) },
                data: {
                    withdrawal_amount: Number(senderWallet.withdrawal_amount) + _totalAsset,
                    remaining_amount: senderRemaining,
                    hold_asset: Number(senderWallet.hold_asset) + _totalAsset
                }
            });
            // UPDATE ADMIN ASSETS
            await tx.admin_assets.update({
                where: { admin_asset_id: BigInt(adminAsset.admin_asset_id) },
                data: {
                    total_revenue: Number(adminAsset.total_revenue) + transferFee,
                    total_withdraw: Number(adminAsset.total_withdraw) + _totalAsset,
                    available_balance: Number(adminAsset.total_deposit) -
                        (Number(adminAsset.total_withdraw) + _totalAsset)
                }
            });
            return res.status(201).json({
                status: true,
                message: "Transaction created successfully.",
                withdrawal_type: adminAsset.withdrawal_type,
                data: transaction
            });
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to complete transaction.",
            errors: err.message
        });
    }
};
// const feeDetails = (feeType, fee, assetValue) => {
//   let transferFee = 0;
//   let transferPercentage = 0;
//   if (feeType === "percentage") {
//     transferPercentage = fee;
//     transferFee = (assetValue * fee) / 100;
//   } else {
//     transferFee = fee;
//   }
//   return { transferFee, transferPercentage };
// };
export const feeCalculation = async (req, res) => {
    try {
        const { asset, network, assetValue } = req.body;
        const assetConversion = req.body.assetConversion ? true : false;
        // ================
        // VALIDATION
        // ================
        if (!asset || !["eth", "bnb", "usdt", "btc"].includes(asset))
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { asset: "Invalid asset" },
            });
        if (!network || !["erc20", "trc20", "bep20", "btc"].includes(network))
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { network: "Invalid network" },
            });
        if (!assetValue || isNaN(assetValue) || Number(assetValue) < 0.000006)
            return res.status(422).json({
                status: false,
                message: "Validation failed",
                errors: { assetValue: "Invalid asset value" },
            });
        // ================================
        // FETCH ADMIN ASSET DETAILS
        // ================================
        const adminAsset = await prisma.admin_assets.findFirst({
            where: {
                asset: fullAssetName(asset),
                network: network,
            },
        });
        if (!adminAsset)
            return res.status(500).json({
                status: false,
                message: "Unable to calculate fee.",
                errors: "Asset not found.",
            });
        // ================================
        // CALCULATE FEES
        // ================================
        const feeType = assetConversion
            ? adminAsset.conversion_fee_type
            : adminAsset.withdrawal_fee_type;
        const fee = assetConversion
            ? adminAsset.conversion_fee
            : adminAsset.withdrawal_fee;
        const { transferFee, transferPercentage } = feeDetails(feeType, Number(fee), Number(assetValue));
        const formatDecimal = (num) => parseFloat(parseFloat(num).toFixed(18)).toString();
        const totalAsset = Number(assetValue) + Number(transferFee);
        // ================================
        // RESPONSE
        // ================================
        return res.json({
            status: true,
            message: "Fee calculation successful.",
            data: {
                transferFee: formatDecimal(transferFee),
                transferPercentage,
                totalAsset: formatDecimal(totalAsset),
            },
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to calculate fee.",
            errors: err.message,
        });
    }
};
export const updateTransactionUsingAddress = async (req, res) => {
    const user = req.user; // middleware से आने वाला user
    try {
        const { txnId, status, txnHashId } = req.body;
        // ============================
        // VALIDATION
        if (!txnId || isNaN(txnId)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: { txnId: "txnId is required & must be integer" },
            });
        }
        if (!["pending", "success", "failed"].includes(status)) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: { status: "Invalid status" },
            });
        }
        if (status === "success" && !txnHashId) {
            return res.status(422).json({
                status: false,
                message: "Validation failed.",
                errors: { txnHashId: "txnHashId required when status=success" },
            });
        }
        // Start Transaction
        await prisma.$transaction(async (tx) => {
            const transaction = await tx.transactions.findFirst({
                where: {
                    user_id: BigInt(user.user_id),
                    txn_id: Number(txnId),
                },
            });
            if (!transaction)
                throw new Error("Transaction not found.");
            if (transaction.status === "success")
                throw new Error("Transaction already completed.");
            if (transaction.status === "failed")
                throw new Error("Transaction already failed and reversed.");
            // Update fields
            await tx.transactions.update({
                where: { txn_id: BigInt(txnId) },
                data: {
                    txn_hash_id: txnHashId || null,
                    status: status,
                },
            });
            const assetValue = Number(transaction.debit_amount);
            let customSubject = "";
            let customMessage = "";
            // ==============================================================
            // ================  FAILED / PENDING : REVERSE LOGIC  ===========
            // ==============================================================
            if (status !== "success") {
                const senderWallet = await tx.web3_wallets.findFirst({
                    where: {
                        user_id: BigInt(user.user_id),
                        network: transaction.network,
                        asset: transaction.asset,
                    },
                });
                if (!senderWallet)
                    throw new Error("Wallet not found.");
                const mainAdminAsset = await tx.admin_assets.findFirst({
                    where: {
                        asset: fullAssetName(transaction.asset),
                        network: transaction.network,
                    },
                });
                if (!mainAdminAsset)
                    throw new Error("Asset not found.");
                const transferFee = Number(transaction.transfer_fee);
                const senderRemainingAmount = Number(senderWallet.remaining_amount) + assetValue;
                // update web3 wallet
                await tx.web3_wallets.update({
                    where: { wallet_id: BigInt(senderWallet.wallet_id) },
                    data: {
                        withdrawal_amount: Number(senderWallet.withdrawal_amount) - assetValue,
                        remaining_amount: senderRemainingAmount,
                        hold_asset: Number(senderWallet.hold_asset) - Number(transaction.hold_asset),
                        created_at: new Date(),
                        updated_at: new Date()
                    },
                });
                // update admin asset
                await tx.admin_assets.update({
                    where: { admin_asset_id: BigInt(mainAdminAsset.admin_asset_id) },
                    data: {
                        total_revenue: Number(mainAdminAsset.total_revenue) - transferFee,
                        total_withdraw: Number(mainAdminAsset.total_withdraw) - assetValue,
                        available_balance: Number(mainAdminAsset.total_deposit) -
                            (Number(mainAdminAsset.total_withdraw) - assetValue),
                    },
                });
                await tx.transactions.update({
                    where: { txn_id: BigInt(txnId) },
                    data: {
                        remark: "Transaction failed. The deducted amount has been credited back to your wallet.",
                    },
                });
                customSubject = "Transaction Failed";
                customMessage =
                    "Your recent transaction could not be processed and has failed. The deducted amount has been refunded back to your wallet.";
            }
            else {
                // ==============================================================
                // ===================== SUCCESS LOGIC ===========================
                // ==============================================================
                customSubject = "Asset Transfer Successfully";
                customMessage = `You have successfully sent ${assetValue} ${fullAssetName(transaction.asset)} to ${transaction.to_address}.`;
                await tx.transactions.update({
                    where: { txn_id: BigInt(txnId) },
                    data: {
                        remark: customSubject,
                    },
                });
            }
            // Save Notification
            const notification = await tx.notifications.create({
                data: {
                    user_id: BigInt(user.user_id),
                    title: customSubject,
                    message: customMessage,
                    operation_type: "transaction using address",
                    operation_id: String(transaction.txn_id),
                    type: "trade",
                    is_read: false,
                    created_at: new Date()
                },
            });
            io.to(notification.user_id.toString()).emit("new_notification", notification);
        });
        return res.json({
            status: true,
            message: "Transaction updated successfully.",
        });
    }
    catch (err) {
        return res.status(500).json({
            status: false,
            message: "Unable to complete transaction.",
            errors: err.message,
        });
    }
};
