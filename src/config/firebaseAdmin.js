import admin from "firebase-admin";
import fs from "fs";

// File must exist at the specified path
const serviceAccount = JSON.parse(
  fs.readFileSync(new URL("./serviceAccountKey.json", import.meta.url))
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://onnbit-ce227-default-rtdb.asia-southeast1.firebasedatabase.app"
});

export const rdb = admin.database();
