// requiredPermission = "payment" | "support" | "admin_update_permissions"
export const requirePermission = (requiredPermission) => {
    return (req, res, next) => {
        const admin = req.admin;
        console.log(admin);
        if (!admin) {
            return res.status(401).json({
                status: false,
                message: "Unauthorized: login required",
            });
        }
        // Super admin full access
        if (admin.role === "super_admin") {
            return next();
        }
        // Admin default allow (you can modify logic)
        if (admin.role === "admin") {
            return next();
        }
        // Sub-admin permissions check
        const permissions = Array.isArray(admin.permissions)
            ? admin.permissions
            : [];
        if (!permissions.includes(requiredPermission)) {
            return res.status(403).json({
                status: false,
                message: "Forbidden: You don't have permission",
            });
        }
        next();
    };
};
