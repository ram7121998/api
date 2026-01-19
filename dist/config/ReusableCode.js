import moment from "moment";
import axios from 'axios';
export const getCryptoLogo = (cryptocurrency = null, req) => {
    try {
        // Base folder for static images
        const baseUrl = `${req.protocol}://${req.get("host")}/storage/images/crypto_logo`;
        const cryptoAsset = {
            bitcoin: "bitcoin-logo.png",
            ethereum: "ethereum-logo.png",
            binance: "binance-logo.png",
            tether: "tether-logo.png",
        };
        // Return a single logo
        if (cryptocurrency) {
            const logoFileName = cryptoAsset[cryptocurrency];
            if (!logoFileName)
                return null;
            return `${baseUrl}/${logoFileName}`;
        }
        // Return ALL logos
        return {
            bitcoinLogo: `${baseUrl}/bitcoin.png`,
            binanceLogo: `${baseUrl}/binance.png`,
            ethereumLogo: `${baseUrl}/ethereum.png`,
            tetherLogo: `${baseUrl}/tether.png`,
        };
    }
    catch (error) {
        throw new Error(`Logo generation failed: ${error.message}`);
    }
};
export function userDetail(user) {
    return {
        user_id: user.user_id,
        name: user.name,
        username: user.username,
        username_changed: user.username_changed,
        email: user.email,
        dialing_code: user.dialing_code,
        phone_number: user.phone_number,
        email_verified: user.email_verified,
        phone_verified: user.phone_verified,
        id_verified: user.id_verified,
        address_verified: user.address_verified,
        twoFactorAuth: user.twoFactorAuth,
        profile_image_url: user.profile_image_url,
        country: user.country,
        country_code: user.country_code,
        city: user.city,
        country_flag_url: user.country_flag_url,
        preferred_currency: user.preferred_currency,
        preferred_timezone: user.preferred_timezone,
        bio: user.bio,
        login_with: user.login_with,
        login_status: user.login_status,
        last_login: user.last_login,
        last_seen_at: user.last_seen_at,
        last_login_duration: user.last_login_duration,
        user_status: user.user_status
    };
}
export const getCurrentTimeInKolkata = () => {
    return moment.tz("Asia/Kolkata").toDate();
};
export function cryptoAsset(name) {
    const cryptoCode = {
        bitcoin: "btc",
        binance: "bnb",
        ethereum: "eth",
        tether: "usdt",
    };
    return cryptoCode[name] || name;
}
export const fullAssetName = (asset) => {
    return {
        eth: "ethereum",
        bnb: "binance",
        usdt: "tether",
        btc: "bitcoin",
    }[asset];
};
export const txnHash = (id) => "tx_" + id + "_" + Date.now();
export const feeDetails = (type, fee, value) => {
    if (type === "percentage") {
        return {
            transferFee: (value * fee) / 100,
            transferPercentage: fee,
        };
    }
    return {
        transferFee: Number(fee),
        transferPercentage: 0,
    };
};
export const truncateDecimal = (value, decimals) => {
    return Number(value).toFixed(decimals);
};
export async function getBTCEquivalent(assetTicker, amount) {
    try {
        if (assetTicker.toLowerCase() === 'btc') {
            return amount;
        }
        const asset = fullAssetName(assetTicker); // replicate your PHP fullAssetName function
        const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${asset.toLowerCase()}&vs_currencies=btc`;
        const response = await axios.get(apiUrl, { timeout: 30000 });
        const data = response.data;
        if (data[asset.toLowerCase()] && data[asset.toLowerCase()].btc) {
            return amount * data[asset.toLowerCase()].btc;
        }
        else {
            return 0;
        }
    }
    catch (err) {
        console.error('Error fetching BTC equivalent:', err.message);
        return 0;
    }
}
export function getAdminDetails(admin) {
    return {
        admin_id: admin.admin_id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
    };
}
export function network(asset) {
    const name = asset?.toLowerCase();
    switch (name) {
        case "usdt":
        case "tether":
            return "trc20"; // You can change to erc20/bep20 if required
        case "eth":
        case "ethereum":
            return "erc20";
        case "bnb":
        case "binance":
            return "bep20";
        case "btc":
        case "bitcoin":
            return "btc";
        default:
            return null; // only returns null for unknown assets
    }
}
