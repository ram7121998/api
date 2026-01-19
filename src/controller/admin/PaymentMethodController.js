import moment from 'moment-timezone';
import prisma from '../../config/prismaClient.js';
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import { validationResult } from 'express-validator';
export const getPaymentDetails = async (req, res) => {
    try {
        const { id, user_id, account_type, status, per_page, page } = req.query;


        // Get payment details count grouped by status
        const paymentDetailsCountRaw = await prisma.payment_details.groupBy({
            by: ['status'],
            _count: { status: true },
        });

        const paymentDetailsCount = {};
        paymentDetailsCountRaw.forEach(item => {
            paymentDetailsCount[item.status] = item._count.status;
        });

        // Build query filters
        const filters = {};
        if (id) filters.pd_id = Number(id);
        if (user_id) filters.user_id = Number(user_id);
        if (account_type) filters.account_type = account_type.toLowerCase();
        if (status) filters.status = status.toLowerCase();

        const currentPage = Number(page) || 1;
        const perPage = Number(per_page) || 10;

        // Fetch payment details with pagination
        const paymentDetails = await prisma.payment_details.findMany({
            where: filters,
            orderBy: { pd_id: 'desc' },
            skip: (currentPage - 1) * perPage,
            take: perPage,
        });

        const totalItems = await prisma.payment_details.count({ where: filters });
        const lastPage = Math.ceil(totalItems / perPage);

        // Format data
        const requiredPaymentDetails = paymentDetails.map(pd => ({
            pd_id: pd.pd_id,
            user_id: pd.user_id,
            account_type: pd.account_type,
            bank_account_country: pd.bank_account_country,
            currency: pd.currency,
            bank_name: pd.bank_name,
            account_holder_name: pd.account_holder_name,
            custom_bank_details: pd.custom_bank_details,
            ifsc_code: pd.ifsc_code || null,
            account_number: pd.account_number,
            swift_bic_code: pd.swift_bic_code || null,
            residence_country: pd.residence_country || null,
            state_region: pd.state_region || null,
            city: pd.city || null,
            zip_code: pd.zip_code || null,
            address: pd.address || null,
            status: pd.status,
            remark: pd.remark,
            is_primary: !!pd.is_primary,
            created_at: moment(pd.created_at).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm:ss A'),
            created_at_duration: moment(pd.created_at).tz('Asia/Kolkata').fromNow(),
        }));

        const paginationData = {
            current_page: currentPage,
            from: (currentPage - 1) * perPage + 1,
            first_page_url: `/payment-details?page=1`,
            last_page: lastPage,
            last_page_url: `/payment-details?page=${lastPage}`,
            next_page_url: currentPage < lastPage ? `/payment-details?page=${currentPage + 1}` : null,
            prev_page_url: currentPage > 1 ? `/payment-details?page=${currentPage - 1}` : null,
            per_page: perPage,
            to: Math.min(currentPage * perPage, totalItems),
            total: totalItems,
        };
        const safeData = convertBigIntToString(requiredPaymentDetails);

        return res.json({
            status: true,
            message: 'Payment details retrieved successfully',
            payment_details: safeData,
            pagination: paginationData,
            analytics: {
                total_bank_details: Object.values(paymentDetailsCount).reduce((a, b) => a + b, 0),
                totalPending: paymentDetailsCount['pending'] || 0,
                totalVerified: paymentDetailsCount['verified'] || 0,
                totalRejected: paymentDetailsCount['reject'] || 0,
            },
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Unable to retrieve payment details',
            errors: error.message,
        });
    }
};


export const getUpiDetails = async (req, res) => {
    try {
        const { id, user_id, upi_name, upi_id, per_page, page } = req.query;

        // UPI details count grouped by status
        const upiDetailsCountRaw = await prisma.upi_details.groupBy({
            by: ['status'],
            _count: { status: true },
        });

        const upiDetailsCount = {};
        upiDetailsCountRaw.forEach(item => {
            upiDetailsCount[item.status] = item._count.status;
        });

        // Build filters
        const filters = {};
        if (id) filters.id = Number(id);
        if (user_id) filters.user_id = Number(user_id);
        if (upi_name) filters.upi_name = upi_name.toLowerCase();
        if (upi_id) filters.upi_id = upi_id;

        const currentPage = Number(page) || 1;
        const perPage = Number(per_page) || 10;

        // Fetch UPI details with pagination
        const upiDetails = await prisma.upi_details.findMany({
            where: filters,
            orderBy: { id: 'desc' },
            skip: (currentPage - 1) * perPage,
            take: perPage,
        });

        const totalItems = await prisma.upi_details.count({ where: filters });
        const lastPage = Math.ceil(totalItems / perPage);

        // Format data
        const requiredUpiDetails = upiDetails.map(item => ({
            id: item.id,
            user_id: item.user_id,
            upi_name: item.upi_name,
            upi_id: item.upi_id,
            qr_code_url: item.qr_code, // Laravel asset() equivalent
            caption: item.caption,
            is_primary: !!item.is_primary,
            status: item.status,
            remark: item.remark,
            created_at: moment(item.created_at).tz('Asia/Kolkata').format('YYYY-MM-DD hh:mm:ss A'),
            created_at_duration: moment(item.created_at).tz('Asia/Kolkata').fromNow(),
        }));

        const paginationData = {
            current_page: currentPage,
            from: (currentPage - 1) * perPage + 1,
            first_page_url: `/upi-details?page=1`,
            last_page: lastPage,
            last_page_url: `/upi-details?page=${lastPage}`,
            next_page_url: currentPage < lastPage ? `/upi-details?page=${currentPage + 1}` : null,
            prev_page_url: currentPage > 1 ? `/upi-details?page=${currentPage - 1}` : null,
            per_page: perPage,
            to: Math.min(currentPage * perPage, totalItems),
            total: totalItems,
        };
        const safeData = convertBigIntToString(requiredUpiDetails);

        return res.json({
            status: true,
            message: 'UPI details retrieved successfully',
            upi_details: safeData,
            pagination: paginationData,
            analytics: {
                total_upi_details: Object.values(upiDetailsCount).reduce((a, b) => a + b, 0),
                totalPending: upiDetailsCount['pending'] || 0,
                totalVerified: upiDetailsCount['verified'] || 0,
                totalReject: upiDetailsCount['reject'] || 0,
            },
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Unable to retrieve UPI details',
            errors: error.message,
        });
    }
};


export const updatePaymentDetailsStatus = async (req, res) => {
    try {
        // Run validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: errors.array(),
            });
        }

        const { id, status, remark } = req.body;
        const admin = req.admin; // Assuming you attach admin to req like in Laravel $this->admin

        // Find payment details
        const paymentDetails = await prisma.payment_details.findUnique({
            where: { pd_id: id },
        });

        if (!paymentDetails) {
            return res.status(404).json({
                status: false,
                message: 'Payment details not found',
            });
        }

        // Start a transaction
        const updatedPaymentDetails = await prisma.$transaction(async (tx) => {
            return tx.payment_details.update({
                where: { pd_id: id },
                data: {
                    status: status,
                    remark:
                        status === 'pending'
                            ? null
                            : status === 'reject'
                                ? remark
                                : 'Bank details successfully verified.',
                },
            });
        });

        return res.status(200).json({
            status: true,
            message: 'Payment details status updated successfully',
            bank_details_status: updatedPaymentDetails.status,
        });
    } catch (error) {
        return res.status(500).json({
            status: false,
            message: 'Unable to update payment details status',
            errors: error.message,
        });
    }
};


export const updateUpiDetailsStatus = async (req, res) => {
    try {
        // Run validation (assuming you use express-validator middleware)
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed',
                errors: errors.array(),
            });
        }

        const { id, status, remark } = req.body;
        const admin = req.admin; // Assuming you attach admin to req like Laravel's $this->admin

        // Find UPI details
        const upiDetails = await prisma.upi_details.findUnique({
            where: { id: BigInt(id) },
        });

        if (!upiDetails) {
            return res.status(404).json({
                status: false,
                message: 'UPI details not found',
            });
        }

        // Start transaction
        const updatedUpiDetails = await prisma.$transaction(async (tx) => {
            return tx.upi_details.update({
                where: { id: id },
                data: {
                    status: status,
                    remark:
                        status === 'pending'
                            ? null
                            : status === 'reject'
                                ? remark
                                : 'UPI details successfully verified.',
                },
            });
        });

        return res.status(200).json({
            status: true,
            message: 'UPI details status updated successfully',
            upi_details_status: updatedUpiDetails.status,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Unable to update UPI details status',
            errors: error.message,
        });
    }
};