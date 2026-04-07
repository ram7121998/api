import axios from 'axios';
import prisma from "../../config/prismaClient.js";

// BigInt Fix: इसे फाइल में सबसे ऊपर रहने दें
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () { return this.toString(); };
}

// 1. डेटा सिंक करने वाला फंक्शन (Internal Use)
export const appMarketDataPrice = async () => {
  try {
    const response = await axios.get('https://api.wazirx.com/sapi/v1/tickers/24hr', {
      timeout: 5000,
    });

    const allowedBaseAssets = ['btc', 'bnb', 'eth', 'usdt'];

    const filteredPairs = response.data.filter(item => 
      item.quoteAsset === 'inr' && 
      allowedBaseAssets.includes(item.baseAsset?.toLowerCase())
    );

    console.log(`Found ${filteredPairs.length} target pairs. Updating DB...`);

    for (const item of filteredPairs) {
      await prisma.marketData.upsert({
        where: { symbol: item.symbol },
        update: {
          lastPrice: item.lastPrice || "0",
          highPrice: item.highPrice || "0",
          lowPrice: item.lowPrice || "0",
          volume: item.volume || "0",
          at: BigInt(item.at || Date.now()),
        },
        create: {
          symbol: item.symbol,
          baseAsset: item.baseAsset,
          quoteAsset: item.quoteAsset,
          lastPrice: item.lastPrice || "0",
          openPrice: item.openPrice || "0",
          lowPrice: item.lowPrice || "0",
          highPrice: item.highPrice || "0",
          volume: item.volume || "0",
          bidPrice: item.bidPrice || "0",
          askPrice: item.askPrice || "0",
          at: BigInt(item.at || Date.now()),
        },
      });
    }
    console.log("✅ Sync Done: Only 4 Coins Updated");
    return true;
  } catch (error) {
    console.error("❌ Sync Error:", error.message);
    return false;
  }
};

// 2. ब्राउज़र को डेटा भेजने वाला फंक्शन (Router के लिए)
export const getMarketData = async (req, res) => {
  try {
    console.log("🔍 Fetching Market Data for Custom Format...");

    // 1. Database से डेटा निकालें
    const data = await prisma.marketData.findMany();

    // 2. अगर DB खाली है, तो पहले सिंक करें
    if (!data || data.length === 0) {
      console.log("⚠️ DB is empty, syncing...");
      await appMarketDataPrice(); // आपका सिंक फंक्शन
      const freshData = await prisma.marketData.findMany();
      return sendInCustomFormat(res, freshData);
    }

    // 3. डेटा को आपके बताए गए फॉर्मेट में बदलकर भेजें
    return sendInCustomFormat(res, data);

  } catch (error) {
    console.error("❌ Controller Error:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// 🛠️ Helper: डेटा को { "BTC": { "INR": price } } फॉर्मेट में बदलना
const sendInCustomFormat = (res, data) => {
  const formattedResponse = {};

  data.forEach(item => {
    // baseAsset को UpperCase में लें (जैसे btc -> BTC)
    const coinName = item.baseAsset.toUpperCase();
    
    // Object के अंदर डेटा सेट करें
    formattedResponse[coinName] = {
      INR: parseFloat(item.lastPrice.toString()) // Decimal को Number में बदलें
    };
  });

  console.log("🚀 Sending Custom Format to Browser...");
  return res.status(200).json(formattedResponse);
};

// 🛠️ Helper: Decimal और BigInt को String में बदलना
const formatAndSend = (res, data) => {
  const safeData = data.map(item => ({
    ...item,
    openPrice: item.openPrice?.toString(),
    lowPrice: item.lowPrice?.toString(),
    highPrice: item.highPrice?.toString(),
    lastPrice: item.lastPrice?.toString(),
    volume: item.volume?.toString(),
    bidPrice: item.bidPrice?.toString(),
    askPrice: item.askPrice?.toString(),
    at: item.at.toString(), // BigInt Fix
  }));

  console.log("🚀 Sending Data to Browser...");
  return res.status(200).json(safeData);
};