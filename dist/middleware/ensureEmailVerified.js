// middleware/ensureEmailVerified.js
export const ensureEmailVerified = async (req, res, next) => {
    try {
        // Check if user exists (set by authenticateUser middleware)
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                status: "Unauthorized",
                message: "User not authenticated"
            });
        }
        // Check if email is not verified
        if (!user.email_verified_at) {
            return res.status(403).json({
                status: true,
                emailVerified: false,
                message: "Email is not verified."
            });
        }
        // If everything fine → continue
        next();
    }
    catch (error) {
        console.error("Email verification middleware error:", error);
        return res.status(500).json({
            status: false,
            message: "Something went wrong"
        });
    }
};
