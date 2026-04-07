import dotenv from "dotenv";
import app from "./src/app.js";
import { appMarketDataPrice } from "././src/controller/user/MarketDataPrice.js";
dotenv.config();
appMarketDataPrice();

// 2. हर 10 सेकंड (10000ms) में डेटा अपडेट करें
setInterval(async () => {
  console.log("⏳ 10 Seconds passed: Updating Market Data...");
  await appMarketDataPrice();
}, 10000);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
