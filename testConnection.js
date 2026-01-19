import mysql from "mysql2/promise";

const connectionConfig = {
  host: "auth-db1827.hstgr.io",     // 🔹 Hostinger MySQL Host
  user: "u678001706_p2pbackend",    // 🔹 Database username
  password: "Admin$2026",           // 🔹 Database password
  database: "u678001706_p2pbackend" // 🔹 Database name
};

async function testConnection() {
  try {
    const connection = await mysql.createConnection(connectionConfig);
    console.log("✅ MySQL Connected Successfully!");
    await connection.end();
  } catch (error) {
    console.error("❌ MySQL Connection Failed:", error.message);
  }
}

testConnection();
