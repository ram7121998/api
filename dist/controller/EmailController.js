import nodemailer from "nodemailer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
dotenv.config();
export const sendWelcomeEmail = async (req, res) => {
    try {
        const user = req.user; // token se
        const userData = await prisma.users.findUnique({
            where: { user_id: BigInt(user.user_id) }
        });
        if (!userData) {
            return res.status(404).json({
                status: false,
                message: "User not found"
            });
        }
        const subject = "Welcome to Our OnnBit Platform";
        const message = "Thank you for registering with us.";
        const details = {
            name: userData.name + '!',
            email: userData.email,
            phone_number: userData.phone_number || ""
        };
        // 👉 Template call
        const emailContent = welcomeEmailTemplate(subject, message, details);
        // 👉 Email transport
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.MAIL_FROM_ADDRESS,
                pass: process.env.MAIL_PASSWORD
            }
        });
        // 👉 Send email
        await transporter.sendMail({
            from: process.env.MAIL_FROM_ADDRESS,
            to: userData.email,
            subject: emailContent.subject,
            html: emailContent.html
        });
        return res.json({
            status: true,
            message: "Email sent successfully"
        });
    }
    catch (error) {
        return res.status(500).json({
            status: false,
            message: "Failed to send email",
            errors: error.message
        });
    }
};
export const welcomeEmailTemplate = (subject, message, details) => {
    return {
        subject: subject,
        html: `
        <h2>Hello, ${details.name}</h2>
        <p>${message}</p>
        <p>Email: ${details.email}</p>
        <br><br>
        <p>Best Regards,</p>
        <p>ONNBIT</p>
        <hr>
        <p><a href="https://test.onnbit.com/">ONNBIT</a></p>
    `
    };
};
// emailService.js
export const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_FROM_ADDRESS,
        pass: process.env.MAIL_PASSWORD
    }
});
const APP_NAME = process.env.APP_NAME || "onnbit.com";
const APP_URL = process.env.APP_URL || "https://onnbit.com";
/**
 * HTML wrapper used by all templates
 */
function wrapTemplate(subjectHeading, bodyHtml) {
    return `
    <div style="font-family: Arial, sans-serif; background:#f7f7f7; padding:20px;">
      <div style="
          max-width:600px;
          margin:auto;
          background:white;
          border-radius:8px;
          padding:25px;
          box-shadow:0 0 10px rgba(0,0,0,0.06);
      ">
        <h1 style="text-align:center; color:#333; margin-top:0; font-size:20px;">
          ${APP_NAME}
        </h1>
        <p style="text-align:center; margin-top:-6px;">
          <a href="${APP_URL}" style="color:#6c63ff; text-decoration:none;">${APP_URL}</a>
        </p>

        <h2 style="color:#4a4a4a; font-size:18px; margin-bottom:6px;">${subjectHeading}</h2>

        <div style="font-size:15px; color:#555; line-height:1.6;">
          ${bodyHtml}
        </div>

        <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

        <p style="font-size:12px; color:#999; text-align:center;">
          This is an automated message. Do not reply.
        </p>
      </div>
    </div>
  `;
}
/**
 * Build templates (matches PDF wording & flows)
 */
function buildTemplate(type, data = {}) {
    switch (type) {
        case "TRADE_INITIATED":
            return {
                subject: `P2P Trade Initiated – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("P2P Trade Initiated", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>Your P2P trade has been initiated.</p>
                    <ul>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Role:</b> ${data.side || ""}</li>
                      <li><b>Asset:</b> ${data.amount_crypto || ""} ${data.asset || ""}</li>
                      <li><b>Price:</b> ${data.price ? data.price + " " + (data.fiat || "") : ""}</li>
                      <li><b>Fiat Amount:</b> ${data.amount_fiat ? data.amount_fiat + " " + (data.fiat || "") : ""}</li>
                      <li><b>Payment Method:</b> ${data.payment_method || ""}</li>
                      <li><b>Counterparty:</b> ${data.counterparty_name || ""}${data.counterparty_rating ? " (Rating: " + data.counterparty_rating + ")" : ""}</li>
                    </ul>
                    <p>Crypto is now locked in our escrow system for this trade. Please complete the payment only using the agreed payment method and within the time limit shown in the app.</p>
                    <p>If you did not start this trade, contact support immediately.</p>
                    <p>Regards,<br/>${APP_NAME} Team</p>
                    `)
            };
        case "PAYMENT_INSTRUCTIONS":
            return {
                subject: `Action Required – Send Payment for Trade #${data.trade_id || ""}`,
                html: wrapTemplate("Action Required — Send Payment", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>You have started a P2P trade as Buyer. Please send payment to the Seller using the details below and then click <b>"I have paid"</b> in the app.</p>
                    <ul>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Amount to Pay:</b> ${data.amount_fiat ? data.amount_fiat + " " + (data.fiat || "") : ""}</li>
                      <li><b>Asset to Receive:</b> ${data.amount_crypto || ""} ${data.asset || ""}</li>
                      <li><b>Seller:</b> ${data.counterparty_name || ""}</li>
                      <li><b>Payment Method:</b> ${data.payment_method || ""}</li>
                      <li><b>Payment Details:</b> ${data.payment_details_masked || ""}</li>
                    </ul>
                    <p><b>Do not add any crypto-related keywords in the payment remark.</b> Keep your payment proof safe in case of dispute.</p>
                    <p>If you did not start this trade, contact support immediately.</p>
                    <p>Regards,<br/>${APP_NAME} Team</p>
                    `)
            };
        case "ESCROW_LOCKED":
            return {
                subject: `Crypto Locked in Escrow – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("Crypto Locked in Escrow", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>Your crypto for Trade #${data.trade_id || ""} is locked securely in escrow.</p>
                    <ul>
                      <li><b>Role:</b> Seller</li>
                      <li><b>Asset Locked:</b> ${data.amount_crypto || ""} ${data.asset || ""}</li>
                      <li><b>Buyer:</b> ${data.counterparty_name || ""}</li>
                      <li><b>Price:</b> ${data.price ? data.price + " " + (data.fiat || "") : ""}</li>
                      <li><b>Payment Method:</b> ${data.payment_method || ""}</li>
                    </ul>
                    <p>Release the crypto only after confirming payment in your bank/wallet account. Never rely only on screenshots.</p>
                    <p>If you did not list this offer or do not recognize this trade, contact support immediately.</p>
                    <p>Regards,<br/>${APP_NAME} Team</p>
                    `)
            };
        case "BUYER_PAID":
            return {
                subject: `Buyer Marked Payment Done – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("Buyer Marked Payment Done", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>The buyer has marked payment as completed for your trade.</p>
                    <ul>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Buyer:</b> ${data.counterparty_name || ""}</li>
                      <li><b>Amount Expected:</b> ${data.amount_fiat ? data.amount_fiat + " " + (data.fiat || "") : ""}</li>
                      <li><b>Asset to Release:</b> ${data.amount_crypto || ""} ${data.asset || ""}</li>
                    </ul>
                    <p>Please confirm amount in your bank/wallet before releasing crypto.</p>
                    <p>If payment has not arrived, DO NOT release crypto. Open a dispute immediately.</p>
                    <p>Regards,<br/>${APP_NAME} Team</p>
                    `)
            };
        case "OTP_RELEASE":
            return {
                subject: `OTP to Release Crypto – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("OTP to Release Crypto", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>You requested to release crypto.</p>
                    <ul>
                      <li><b>OTP:</b> <strong style="font-size:18px;">${data.otp_code || ""}</strong></li>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Valid For:</b> ${data.otp_expiry_minutes || 5} minutes</li>
                    </ul>
                    <p>Do not share this OTP with anyone. ${APP_NAME} will never ask for OTP or password.</p>
                    <p>If you did not request this, contact support immediately.</p>
                    <p>Regards,<br/>${APP_NAME} Security Team</p>
                    `)
            };
        case "TRADE_COMPLETED":
            return {
                subject: `Trade Completed – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("Trade Completed", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>Your P2P trade has been successfully completed.</p>
                    <ul>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Role:</b> ${data.side || ""}</li>
                      <li><b>Asset:</b> ${data.amount_crypto || ""} ${data.asset || ""}</li>
                      <li><b>Fiat:</b> ${data.amount_fiat ? data.amount_fiat + " " + (data.fiat || "") : ""}</li>
                      <li><b>Counterparty:</b> ${data.counterparty_name || ""}</li>
                    </ul>
                    <p>Please rate your counterparty to improve marketplace safety.</p>
                    <p>Regards,<br/>${APP_NAME} Team</p>
                    `)
            };
        case "TRADE_CANCELLED":
            return {
                subject: `Trade Expired – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("Trade Expired / Cancelled", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>Your P2P trade has been cancelled/expired due to timeout or non-payment.</p>
                    <ul>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Role:</b> ${data.side || ""}</li>
                      <li><b>Asset:</b> ${data.amount_crypto || ""} ${data.asset || ""}</li>
                      <li><b>Fiat Amount:</b> ${data.amount_fiat ? data.amount_fiat + " " + (data.fiat || "") : ""}</li>
                    </ul>
                    <p>If Buyer already paid, contact support immediately with proof.</p>
                    <p>Regards,<br/>${APP_NAME} Team</p>
                    `)
            };
        case "DISPUTE_OPENED":
            return {
                subject: `Dispute Opened – Trade #${data.trade_id || ""}`,
                html: wrapTemplate("Dispute Opened", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>A dispute has been opened for your trade.</p>
                    <ul>
                      <li><b>Trade ID:</b> ${data.trade_id || ""}</li>
                      <li><b>Role:</b> ${data.side || ""}</li>
                      <li><b>Counterparty:</b> ${data.counterparty_name || ""}</li>
                      <li><b>Reason:</b> ${data.dispute_reason || ""}</li>
                    </ul>
                    <p>Upload clear payment proofs inside the trade chat only. Do not communicate outside the platform.</p>
                    <p>Support will update you once resolved.</p>
                    <p>Regards,<br/>${APP_NAME} Support</p>
                    `)
            };
        case "DISPUTE_INITIATED":
            return {
                subject: `Dispute Opened – Trade #${data.trade_id}`,
                html: wrapTemplate("Dispute Opened", `
                    <p>Hi ${data.user_name || "User"},</p>

                    <p>A dispute has been opened on your P2P trade.</p>

                    <ul>
                        <li><strong>Trade ID:</strong> ${data.trade_id}</li>
                        <li><strong>Role:</strong> ${data.side}</li>
                        <li><strong>Counterparty:</strong> ${data.counterparty_name}</li>
                        <li><strong>Reason Selected:</strong> ${data.dispute_reason}</li>
                    </ul>

                    <p>
                        Our dispute team will review chat history, payment proofs, 
                        and transaction records. Please upload clear screenshots, 
                        bank statements, and reference numbers only inside the trade chat.
                        Do not communicate with the counterparty outside the platform.
                    </p>

                    <p>You may receive follow-up emails asking for additional information.</p>

                    <p>Regards,<br/>${APP_NAME} Support Team</p>
                    `)
            };
        case "DISPUTE_UNDER_REVIEW":
            return {
                subject: `Dispute Under Review – Trade #${data.trade_id}`,
                html: wrapTemplate("Dispute Under Review", `
            <p>Hi ${data.user_name || "User"},</p>

            <p>Your dispute for Trade #${data.trade_id} has been received and is now under review by our dispute specialists.</p>

            <ul>
                <li><strong>Current status:</strong> Under investigation</li>
                <li><strong>Estimated response time:</strong> ${data.eta_hours}-${data.eta_hours_max} hours</li>
                <li><strong>Track your dispute here:</strong> <a href="${data.app_path_to_dispute}">View in app</a></li>
            </ul>

            <p>Please do not cancel the order, release crypto, or send additional payments while the dispute is open. All communication must stay inside the in-app trade chat.</p>

            <p>Regards,<br/>${data.platform_name || APP_NAME} Dispute Desk</p>
            `)
            };
        case "DISPUTE_RESOLVED_BUYER":
            return {
                subject: `Dispute Resolved – Crypto Released to You (Trade #${data.trade_id})`,
                html: wrapTemplate("Dispute Resolved – Buyer", `
      <p>Hi ${data.user_name || "User"},</p>
      <p>The dispute for Trade #${data.trade_id} has been resolved in your favour (Buyer).</p>

      <ul>
        <li>Asset received: ${data.amount_crypto} ${data.asset}</li>
        <li>Fiat paid: ${data.amount_fiat} ${data.fiat}</li>
        <li>Counterparty: ${data.counterparty_name}</li>
      </ul>

      <p>The crypto has been released to your ${data.platform_name} wallet balance. Please review your account and report any issues immediately.</p>
      <p>Kindly rate your trading experience and the dispute handling so we can improve our service.</p>
      <p>Regards,<br/>${data.platform_name} Support Team</p>
      `),
            };
        case "DISPUTE_RESOLVED_SELLER":
            return {
                subject: `Dispute Resolved – Order Cancelled / Funds Returned (Trade #${data.trade_id})`,
                html: wrapTemplate("Dispute Resolved – Seller", `
      <p>Hi ${data.user_name || "User"},</p>
      <p>The dispute for Trade #${data.trade_id} has been resolved in favour of the Seller.</p>

      <ul>
        <li>Role: ${data.side}</li>
        <li>Asset: ${data.amount_crypto} ${data.asset}</li>
        <li>Fiat amount: ${data.amount_fiat} ${data.fiat}</li>
      </ul>

      <p>The crypto has been returned to the Seller’s wallet, and the order has been closed according to our P2P dispute rules. If you sent funds from your bank/wallet, please contact your payment provider for any recovery options if applicable.</p>
      <p>You can see the decision details in the dispute page inside the app.</p>
      <p>Regards,<br/>${data.platform_name} Support Team</p>
      `),
            };
        case "DISPUTE_AUTO_CLOSED":
            return {
                subject: `Dispute Closed – No Further Action (Trade #${data.trade_id})`,
                html: wrapTemplate("Dispute Closed", `
            <p>Hi ${data.user_name},</p>

            <p>Your dispute for <strong>Trade #${data.trade_id}</strong> has been closed because the required evidence 
            was not submitted in time or was insufficient to support your claim as per our P2P rules.</p>

            <p>The order has been processed based on available records, banking proofs, and platform logs. 
            This decision is final unless new legal or official documents are provided as per our policy.</p>

            <p>You can review the case summary in the dispute details section.</p>
                    <p>Regards,<br/>${APP_NAME} Support</p>            `)
            };
        case "DISPUTE_EVIDENCE_REQUIRED":
            return {
                subject: `Action Needed – Provide Evidence for Dispute #${data.trade_id}`,
                html: wrapTemplate("Extra Documents / Clarification Required", `
            <p>Hi ${data.user_name || "User"},</p>

            <p>To continue reviewing your dispute, more information is required.</p>

            <p>Please upload the following within <strong>${data.evidence_deadline_hours} hours</strong> in the trade dispute section:</p>

            <ul>
                <li>Full screenshot or PDF of your bank/wallet statement for the relevant period.</li>
                <li>Payment proof containing UTR/reference number and transaction time.</li>
                <li>Any chat messages or details that support your case.</li>
            </ul>

            <p>
                Failure to provide clear and complete evidence within the given time may result in the case 
                being decided based on the existing information only.
            </p>

            <p>Regards,<br/>${data.platform_name || APP_NAME} Dispute Desk</p>
            `)
            };
        case "ADMIN_MESSAGE":
            return {
                subject: `Message from Admin regarding Trade #${data.trade_id}`,
                html: wrapTemplate("New Message from Admin", `
            <p>Hi ${data.user_name || "User"},</p>

            <p>The admin has sent you a message regarding your trade <strong>#${data.trade_id}</strong>:</p>

            <blockquote style="padding:10px; border-left:3px solid #ccc; margin:10px 0;">
                ${data.message}
            </blockquote>

            <p>Please check your trade dashboard for more details.</p>

            <p>Regards,<br/>${data.platform_name || APP_NAME} Team</p>
            `)
            };
        case "SAFETY_TIPS":
            return {
                subject: `Important Safety Tips for P2P Trading`,
                html: wrapTemplate("Safety Tips", `
                    <p>Hi ${data.user_name || "User"},</p>
                    <p>To keep your funds safe:</p>
                    <ul>
                      <li>Always use escrow; never trade outside.</li>
                      <li>Never share passwords, OTP, or private keys.</li>
                      <li>Confirm payment before releasing crypto.</li>
                      <li>Avoid "too good to be true" offers.</li>
                    </ul>
                    <p>Contact support inside the app for any suspicious activity.</p>
                    <p>Regards,<br/>${APP_NAME} Security Team</p>
                    `)
            };
        default:
            return null;
    }
}
/**
 * Send email (transporter automatically used)
 */
export async function sendTradeEmail(type, to, data = {}) {
    const template = buildTemplate(type, data);
    if (!template) {
        throw new Error("Invalid email template type: " + type);
    }
    return transporter.sendMail({
        from: process.env.MAIL_FROM_ADDRESS,
        to,
        bcc: "Team.raitechcorporation@gmail.com",
        subject: template.subject,
        html: template.html
    });
}
export { buildTemplate, wrapTemplate };
