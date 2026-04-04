
import moment from "moment";
import { decryptWithKey, encryptWithKey } from "../../config/EncryptDecrypt.js";
import prisma from "../../config/prismaClient.js";
import { cryptoAsset, getBTCEquivalent } from "../../config/ReusableCode.js";
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import TronWeb from 'tronweb';
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
import axios from "axios";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
export const createWeb3Wallet = async (req, res) => {
    const user = req.user;

    try {
        const { blockchain, network, asset } = req.body;

        // ---------------- VALIDATION ----------------
        const allowedBlockchains = ['ethereum', 'binance', 'bitcoin', 'tron'];
        const allowedNetworks = ['erc20', 'bep20', 'btc', 'trc20'];
        const allowedAssets = ['eth', 'bnb', 'usdt', 'btc'];

        if (
            !allowedBlockchains.includes(blockchain) ||
            !allowedNetworks.includes(network) ||
            !allowedAssets.includes(asset)
        ) {
            return res.status(422).json({
                status: false,
                message: 'Invalid blockchain, network, or asset'
            });
        }

        const validCombinations = [
            { blockchain: 'ethereum', network: 'erc20', asset: ['eth', 'usdt'] },
            { blockchain: 'binance', network: 'bep20', asset: ['bnb'] },
            { blockchain: 'tron', network: 'trc20', asset: ['usdt'] },
            { blockchain: 'bitcoin', network: 'btc', asset: ['btc'] }
        ];

        const isValid = validCombinations.some(
            v => v.blockchain === blockchain &&
                v.network === network &&
                v.asset.includes(asset)
        );

        if (!isValid) {
            return res.status(422).json({
                status: false,
                message: 'Invalid blockchain + network + asset combination'
            });
        }

        // ------------- EXISTING WALLET CHECK -------------
        const existingWallet = await prisma.web3_wallets.findFirst({
            where: {
                user_id: BigInt(user.user_id),
                blockchain,
                network,
                asset
            }
        });

        if (existingWallet?.wallet_address && existingWallet?.wallet_key) {
            return res.status(409).json({
                status: false,
                message: 'Wallet already exists',
                data: {
                    wallet_address: existingWallet.wallet_address
                }
            });
        }

        // ------------- WALLET GENERATION -------------
        let wallet;

        if (blockchain === 'ethereum' || blockchain === 'binance') {
            wallet = generateEthBscWallet();
        }
        else if (blockchain === 'bitcoin') {
            wallet = generateBtcWallet();
        }
        else if (blockchain === 'tron') {
            wallet = await generateTronWallet();
        }

        // ------------- SAVE WALLET -------------
        const savedWallet = await prisma.web3_wallets.create({
            data: {
                user_id: BigInt(user.user_id),
                blockchain,
                network,
                asset,
                wallet_address: wallet.address,
                wallet_key: wallet.privateKey,
                created_at: new Date(),
                updated_at: new Date()
            }
        });

        // ------------- ENCRYPT PHRASE -------------
        const settingData = await prisma.settings.findUnique({
            where: { setting_id: BigInt(1) }
        });

        const encryptPayload = {
            key: settingData?.wallet_key,
            phrase: settingData?.wallet_key_phrase
        };

        const phrase = encryptWithKey(encryptPayload, user.user_id);

        return res.status(201).json({
            status: true,
            message: 'Web3 wallet created successfully',
            data: {
                wallet_id: savedWallet.wallet_id,
                wallet_address: savedWallet.wallet_address,
                phrase
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Unable to create web3 wallet',
            error: error.message
        });
    }
};


export const getWalletKeyPhrase = async (req, res) => {
    const user = req.user; // Assume user is set in auth middleware

    try {
        // Fetch settings
        const settingData = await prisma.settings.findUnique({
            where: { setting_id: BigInt(1) }
        });

        if (!settingData) {
            return res.status(404).json({
                status: false,
                message: 'No data found.'
            });
        }

        const customKey = user.user_id; // using user ID as key
        const data = {
            key: settingData.wallet_key,
            key_phrase: settingData.wallet_key_phrase
        };

        // Encrypt the data
        const encryptedData = encryptWithKey(data, customKey);

        return res.status(200).json({
            status: true,
            message: 'Wallet Key phrase fetched successfully',
            data: encryptedData
        });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: 'Unable to fetch wallet key phrase.',
            errors: error.message
        });
    }
};


export const decryptedData = async (req, res) => {
    const user = req.user; // Assume user is set in auth middleware
    const { encryptedData, key } = req.body;

    if (!encryptedData) {
        return res.status(422).json({
            status: false,
            message: 'encryptedData is required.'
        });
    }

    try {
        const decryptionKey = user.user_id;
        const data = decryptWithKey(encryptedData, decryptionKey);

        return res.status(200).json({
            status: true,
            message: 'Data successfully decrypted.',
            data: data
        });
    } catch (error) {
        return res.status(500).json({
            status: false,
            message: 'Unable to decrypt the data.',
            errors: error.message
        });
    }
};

export const getWeb3WalletDetails = async (req, res) => {
    const user = req.user; // assume middleware sets authenticated user

    try {
        let { cryptocurrency } = req.query;

        // Base query: fetch wallets for user
        let walletQuery = {
            where: { user_id: user.user_id }
        };

        if (cryptocurrency) {
            cryptocurrency = cryptocurrency.toLowerCase();
            // Assuming you have a helper function like cryptoAsset
            walletQuery.where.asset = cryptoAsset(cryptocurrency);
        }

        const walletDatas = await prisma.web3_wallets.findMany(walletQuery);

        if (!walletDatas || walletDatas.length === 0) {
            return res.status(200).json({
                status: true,
                message: 'No web3 wallet data found',
                data: walletDatas
            });
        }

        const requiredData = {};
        let totalBtcValue = 0;
        let totalINRValue = 0; // <-- add this

        const timezone = user.preferred_timezone || 'Asia/Kolkata';

        for (const walletData of walletDatas) {
            const remainingAmount = Number(walletData.remaining_amount - walletData.hold_asset).toFixed(18);
            const btcValue = await getBTCEquivalent(walletData.asset, remainingAmount);
            totalBtcValue += parseFloat(btcValue);
            // INR value
            const inrValue = await getINREquivalent(walletData.asset, remainingAmount);
            totalINRValue += parseFloat(inrValue);
            const data = {
                wallet_id: walletData.wallet_id,
                user_id: walletData.user_id,
                blockchain: walletData.blockchain,
                network: walletData.network,
                asset: walletData.asset,
                wallet_address: walletData.wallet_address,
                wallet_key: walletData.wallet_key,
                deposit_amount: walletData.deposit_amount,
                withdrawal_amount: walletData.withdrawal_amount,
                remaining_amount: remainingAmount,
                hold_asset: walletData.hold_asset,
                web3_deposit: walletData.web3_deposit,
                internal_deposit: walletData.internal_deposit,
                status: walletData.status,
                dateTime: moment(walletData.created_at).tz(timezone).format('YYYY-MM-DD hh:mm A'),
                btcValue: parseFloat(btcValue).toFixed(18),
            };

            if (requiredData[walletData.blockchain]) {
                requiredData[walletData.blockchain].push(data);
            } else {
                requiredData[walletData.blockchain] = [data];
            }
        }

        // Encrypt data
        const encryptedData = encryptWithKey(requiredData, user.user_id);

        return res.status(200).json({
            status: true,
            message: 'Web3 wallet details fetched successfully.',
            data: requiredData,
            totalINRValue: totalINRValue.toFixed(2), // <-- total INR here
            totalBtcValue: totalBtcValue.toFixed(18),
            edata: encryptedData
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            status: false,
            message: 'Unable to fetch web3 wallet details.',
            errors: err.message
        });
    }
};

export const fetchUserByUsernameAndAddress = async (req, res) => {
    const user = req.user; // assume user is set in auth middleware
    try {
        const { username } = req.query;

        if (!username) {
            return res.status(400).json({
                status: false,
                message: 'Username query parameter is required.'
            });
        }

        // Fetch users with username starting with the input
        const cryptoUsers = await prisma.users.findMany({
            where: {
                username: {
                    startsWith: username,
                }
            },
            select: {
                user_id: true,
                username: true,
                profile_image: true,
            },
            take: 10
        });

        // Convert relative profile_image to full URL if needed
        const usersWithFullImage = cryptoUsers.map(u => {
            let profileImage = u.profile_image;
            if (profileImage && !/^https?:\/\//i.test(profileImage)) {
                // Assuming you store images in /storage folder in your public directory
                profileImage = `${req.protocol}://${req.get('host')}/storage/${profileImage}`;
            }
            return { ...u, profile_image: profileImage };
        });

        return res.status(200).json({
            status: true,
            message: 'User details fetched successfully.',
            data: usersWithFullImage
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Unable to fetch User details.',
            errors: error.message
        });
    }
};


export const updateWeb3Wallet = async (req, res) => {
    const user = req.user; // assume user is set in auth middleware

    try {
        const { wallet_address, wallet_key, wallet_id } = req.body;

        // Validation
        if (!wallet_address || !wallet_key || !wallet_id) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed.',
                errors: 'wallet_address, wallet_key, and wallet_id are required.'
            });
        }

        const walletIdBigInt = BigInt(wallet_id);

        // Check if wallet exists for this user
        const walletData = await prisma.web3_wallets.findFirst({
            where: {
                wallet_id: walletIdBigInt,
                user_id: BigInt(user.user_id)
            }
        });

        if (!walletData) {
            return res.status(404).json({
                status: false,
                message: 'Wallet not found for this user.'
            });
        }

        // Update wallet with encrypted key
        const updatedWallet = await prisma.web3_wallets.update({
            where: { wallet_id: walletIdBigInt },
            data: {
                wallet_address,
                wallet_key: encryptWithKey(wallet_key, user.user_id),
                created_at: new Date(),
                updated_at: new Date()
            }
        });

        return res.status(201).json({
            status: true,
            message: 'Web3 Wallet details updated successfully.',
            data: updatedWallet
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Unable to update web3 wallet details.',
            errors: error.message
        });
    }
};

// ETH / BSC Wallet
const generateEthBscWallet = () => {
    const wallet = ethers.Wallet.createRandom();
    return {
        address: wallet.address,       // 0x...
        privateKey: wallet.privateKey  // 0x...
    };
};

// Bitcoin Wallet (Native SegWit)
const generateBtcWallet = () => {
    const keyPair = ECPair.makeRandom({ network: bitcoin.networks.bitcoin });

    const { address } = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: bitcoin.networks.bitcoin,
    });

    return {
        address,                                   // bc1...
        privateKey: keyPair.toWIF()                // WIF format
    };
};

// Tron Wallet (USDT TRC20)
const generateTronWallet = async () => {
    const tronWeb = new TronWeb({
        fullHost: 'https://api.trongrid.io'
    });

    const wallet = await tronWeb.createAccount();

    return {
        address: wallet.address.base58,   // T...
        privateKey: wallet.privateKey
    };
};

const getINREquivalent = async (asset, amount) => {
    const priceInINR = await getCryptoPriceInINR(asset); // You implement API call
    return parseFloat(amount) * parseFloat(priceInINR);
};
// export const getCryptoPriceInINR = async (asset) => {


//     try {
//         // Convert symbol to CoinGecko id
//         const coinMap = {
//             btc: 'bitcoin',
//             eth: 'ethereum',
//             usdt: 'tether',
//             bnb: 'binancecoin',
//         };

//         const coinId = coinMap[asset.toLowerCase()];
//         if (!coinId) return 0;

//         const response = await axios.get(
//             `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=inr`
//         );

//         return response.data[coinId].inr || 0;
//     } catch (err) {
//         console.error('Error fetching crypto price:', err.message);
//         return 0;
//     }
// };


export const getCryptoPriceInINR = async (asset) => {
  try {
    const coinMap = {
      btc: "BTC",
      eth: "ETH",
      usdt: "USDT",
      bnb: "BNB",
    };

    const symbol = coinMap[asset.toLowerCase()];
    if (!symbol) return 0;

    const response = await axios.get(
      `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${symbol}&tsyms=INR`
    );

    return response.data[symbol]?.INR || 0;
  } catch (err) {
    console.error("Error fetching crypto price:", err.message);
    return 0;
  }
};