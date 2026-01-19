import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import axios from 'axios';
export const sendOtp = async (req, res) => {
    const user = req.user; // Assuming auth middleware attaches user
    if (user.id_verified_at) {
        return res.status(200).json({
            status: true,
            message: 'Id already verified.',
        });
    }
    try {
        // Validation
        const { aadhaar_number } = req.body;
        if (!aadhaar_number || !/^\d{12}$/.test(aadhaar_number)) {
            return res.status(422).json({
                status: false,
                message: 'Validation failed.',
                errors: { aadhaar_number: 'Aadhaar number must be 12 digits' },
            });
        }
        const apiKey = process.env.SANDBOX_API_KEY;
        const secretKey = process.env.SANDBOX_SECRET_KEY;
        // Authenticate
        const authResponse = await axios.post('https://api.sandbox.co.in/authenticate', null, {
            headers: {
                'x-api-key': apiKey,
                'x-api-secret': secretKey,
                'x-api-version': '2.0',
                accept: 'application/json',
            },
        });
        if (authResponse.status !== 200) {
            return res.status(401).json({
                status: false,
                message: 'Authentication failed',
                error: authResponse.data,
            });
        }
        const accessToken = authResponse.data.access_token;
        // Request OTP
        const payload = {
            "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
            reason: "For KYC",
            consent: "y",
            aadhaar_number,
        };
        const otpResponse = await axios.post('https://api.sandbox.co.in/kyc/aadhaar/okyc/otp', payload, {
            headers: {
                accept: 'application/json',
                authorization: accessToken,
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'x-api-version': '2.0',
            },
        });
        const bodyData = otpResponse.data;
        if (bodyData.code === 200) {
            // Save verification data using Prisma
            await prisma.verification_data.upsert({
                where: {
                    user_id_aadhaar_number: {
                        user_id: user.user_id,
                        aadhaar_number: aadhaar_number,
                    },
                },
                update: {
                    access_token: accessToken,
                    reference_id: bodyData.data.reference_id,
                },
                create: {
                    user_id: user.user_id,
                    aadhaar_number,
                    access_token: accessToken,
                    reference_id: bodyData.data.reference_id,
                },
            });
            return res.status(200).json({
                status: true,
                message: bodyData.data.message || 'OTP sent successfully',
            });
        }
        else {
            return res.status(bodyData.code).json({
                status: false,
                message: bodyData.message || 'Request failed',
                errors: {
                    code: bodyData.code,
                    transaction_id: bodyData.transaction_id || null,
                },
                raw_response: bodyData,
            });
        }
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: 'Failed to send otp.',
            errors: error.message,
        });
    }
};
