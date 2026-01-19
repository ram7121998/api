import crypto from "crypto";

export const encryptWithKey = (data, customKey) => {
  try {
    const key = crypto.createHash("sha256").update(String(customKey)).digest();
    const iv = crypto.randomBytes(16);
    const dataString = JSON.stringify(data);

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(dataString, "utf8", "base64");
    encrypted += cipher.final("base64");

    const combined = Buffer.concat([iv, Buffer.from(encrypted, "base64")]);
    return combined.toString("base64");
  } catch {
    throw new Error("Encryption failed.");
  }
};
