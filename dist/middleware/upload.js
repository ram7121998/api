import multer from "multer";
import path from "path";
import fs from "fs";
import moment from "moment";
// ✅ Create Laravel-style storage directory
const storageDir = path.join("storage", "app", "public", "images", "doc_file");
fs.mkdirSync(storageDir, { recursive: true });
// ✅ Multer Storage (Laravel-like)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, storageDir),
    filename: (req, file, cb) => {
        const userId = req.user?.user_id || "unknown"; // logged-in user
        const timestamp = moment().format("DDMMYYYYHHmmss");
        const random = Math.random().toString(36).substring(2, 5);
        const ext = path.extname(file.originalname);
        cb(null, `${userId}_${timestamp}_${random}${ext}`);
    },
});
// ✅ File Filter (same as Laravel validation rules)
const fileFilter = (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(file.mimetype)) {
        return cb(new Error("Only jpeg, jpg, png OR pdf formats are allowed."));
    }
    cb(null, true);
};
// ✅ Final Multer Export
export const upload = multer({
    storage,
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB per your Laravel rule
    fileFilter,
});
export const singelUpload = multer({
    storage: multer.memoryStorage(), // store file in memory for sharp
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB limit
    fileFilter: (req, file, cb) => {
        const allowed = ["image/png", "image/jpeg", "image/jpg"];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("Only PNG, JPG, JPEG allowed"));
        }
        cb(null, true);
    },
});
export const uploadAttachments = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
    fileFilter: (req, file, cb) => {
        const allowed = ["jpg", "jpeg", "png", "pdf", "doc", "docx"];
        const ext = file.originalname.split(".").pop().toLowerCase();
        if (!allowed.includes(ext)) {
            return cb(new Error("Invalid file format"));
        }
        cb(null, true);
    },
});
