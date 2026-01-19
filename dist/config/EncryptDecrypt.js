import crypto from 'crypto';
export function encryptWithKey(data, customKey) {
    const key = crypto.createHash('sha256').update(String(customKey)).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, encrypted]).toString('base64'); // prepend IV
}
export function decryptWithKey(encryptedData, customKey) {
    try {
        const key = crypto.createHash('sha256').update(String(customKey)).digest();
        const dataBuffer = Buffer.from(encryptedData, 'base64');
        const iv = dataBuffer.slice(0, 16); // first 16 bytes
        const encryptedText = dataBuffer.slice(16); // rest is ciphertext
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
        // try parse JSON
        try {
            return JSON.parse(decrypted.toString('utf8'));
        }
        catch {
            return decrypted.toString('utf8');
        }
    }
    catch (err) {
        console.error('Decryption failed:', err);
        throw new Error('Decryption failed.');
    }
}
