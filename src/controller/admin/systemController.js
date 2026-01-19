import prisma from '../../config/prismaClient.js';
import { convertBigIntToString } from '../../config/convertBigIntToString.js';
import path from "path";
import fs from "fs"

export const getSettingData = async (req, res) => {
  try {

    const settingData = await prisma.settings.findUnique({
      where: { setting_id: BigInt(1) },
    });

    if (!settingData) {
      return res.status(200).json({
        status: true,
        message: 'No setting data found.',
        data: [],
      });
    }

    // ✅ updated_by parse karna
    let updatedByParsed = null;
    if (settingData.updated_by) {
      try {
        updatedByParsed = JSON.parse(settingData.updated_by);
      } catch (err) {
        console.error("JSON Parse Error:", err.message);
      }
    }

    let updatedByAdmin = null;
    if (updatedByParsed?.admin_id) {
      updatedByAdmin = await prisma.admins.findUnique({
        where: { admin_id: BigInt(updatedByParsed.admin_id) },
      });
    }

    const requiredData = {
      withdrawStatus: settingData.withdraw_status,
      depositStatus: settingData.deposit_status,
      withdrawType: settingData.withdraw_type,
      min_withdraw: settingData.min_withdraw,
      max_withdraw: settingData.max_withdraw,
      trade_fee_type: settingData.trade_fee_type,
      trade_fee: settingData.trade_fee,
      user_registration: settingData.user_registration,
      updatedBy: updatedByAdmin || null,
    };

    // ✅ Final data BigInt-safe bana ke send karo
    const safeData = convertBigIntToString(requiredData);

    return res.status(200).json({
      status: true,
      message: 'Setting details fetched successfully.',
      data: safeData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: 'Unable to fetch the setting details.',
      errors: error.message,
    });
  }
};


export const getWalletKeyPhrase = async (req, res) => {
  try {

    const settingData = await prisma.settings.findUnique({
      where: { setting_id: BigInt(1) },
    });

    if (!settingData) {
      return res.status(404).json({
        status: false,
        message: 'No data found.',
      });
    }

    const data = {
      key: settingData.wallet_key,
      phrase: settingData.wallet_key_phrase,
    };

    // Encryption skipped
    return res.json({
      status: true,
      message: 'Wallet Key phrase fetched successfully',
      phrase: data,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      message: 'Unable to fetch wallet key phrase.',
      errors: error.message,
    });
  }
};


export const updateSettingData = async (req, res) => {
  const admin = req.admin; // equivalent of $this->admin

  try {
    const {
      withdraw_status,
      deposit_status,
      withdraw_type,
      min_withdraw,
      max_withdraw,
      user_registration,
    } = req.body;

    // ✅ Validation
    const validStatuses = ['enable', 'disable'];
    const validWithdrawTypes = ['auto', 'manual'];

    if (
      withdraw_status &&
      !validStatuses.includes(withdraw_status)
    ) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { withdraw_status: ['Invalid value.'] },
      });
    }

    if (
      deposit_status &&
      !validStatuses.includes(deposit_status)
    ) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { deposit_status: ['Invalid value.'] },
      });
    }

    if (
      withdraw_type &&
      !validWithdrawTypes.includes(withdraw_type)
    ) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { withdraw_type: ['Invalid value.'] },
      });
    }

    const numberRegex = /^\d{1,12}(\.\d{1,8})?$/;
    if (min_withdraw && !numberRegex.test(min_withdraw)) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { min_withdraw: ['Invalid number format.'] },
      });
    }
    if (max_withdraw && !numberRegex.test(max_withdraw)) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { max_withdraw: ['Invalid number format.'] },
      });
    }

    if (
      user_registration &&
      !validStatuses.includes(user_registration)
    ) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { user_registration: ['Invalid value.'] },
      });
    }

    // ✅ Check at least one field is present
    if (
      !(
        withdraw_status ||
        deposit_status ||
        withdraw_type ||
        min_withdraw ||
        max_withdraw ||
        user_registration
      )
    ) {
      return res.status(422).json({
        status: false,
        message: 'validation failed',
        errors: { fields: ['At least one field is required.'] },
      });
    }

    // ✅ Fetch current setting
    const settingData = await prisma.settings.findUnique({
      where: { setting_id: BigInt(1) },
    });

    if (!settingData) {
      return res.status(404).json({
        status: false,
        message: 'Setting record not found.',
      });
    }

    // ✅ Check if values are the same
    const updatableFields = {
      withdraw_status,
      deposit_status,
      withdraw_type,
      min_withdraw,
      max_withdraw,
      user_registration,
    };

    for (const field in updatableFields) {
      if (
        updatableFields[field] &&
        settingData[field] === updatableFields[field]
      ) {
        return res.status(422).json({
          status: false,
          message: 'validation failed',
          errors: {
            [field]: [`The ${field} is already set to ${updatableFields[field]}`],
          },
        });
      }
    }

    // ✅ Update
    const updatedSetting = await prisma.settings.update({
      where: { setting_id: 1 },
      data: {
        ...Object.fromEntries(
          Object.entries(updatableFields).filter(([_, v]) => v !== undefined)
        ),
        updated_by: JSON.stringify(admin), // same as $this->adminDetails($admin)
      },
    });

    return res.status(200).json({
      status: true,
      message: 'Setting details updated successfully.',
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: 'Unable to update setting data.',
      errors: error.message,
    });
  }
};

export const walletKeyPhrase = async (req, res) => {
  try {
    const admin = req.admin; // from middleware
    const { wallet_key_phrase } = req.body;
    console.log("wallet_key_phrase", wallet_key_phrase)

    if (!wallet_key_phrase || typeof wallet_key_phrase !== "string") {
      return res.status(422).json({
        status: false,
        message: "Validation failed",
        errors: { wallet_key_phrase: ["wallet_key_phrase is required and must be a string."] },
      });
    }

    const settingData = await prisma.settings.findFirst({
      where: { setting_id: BigInt(1) },
    });

    if (!settingData) {
      return res.status(404).json({
        status: false,
        message: "No data found.",
      });
    }
    console.log(admin)

    const updatedSetting = await prisma.settings.update({
      where: { setting_id: BigInt(1) },
      data: {
        wallet_key: Number(admin.admin_id), // ✅ convert to Int
        wallet_key_phrase: wallet_key_phrase,
        updated_by: String(admin.admin_id), // ✅ string field
      },
    });
    const safeData = convertBigIntToString(updatedSetting)

    return res.status(200).json({
      status: true,
      message: "Wallet key phrase updated successfully.",
      data: safeData,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to update wallet key phrase.",
      errors: error.message,
    });
  }
};


const ENV_PATH = path.resolve("./.env");

// =========================
// ENV Update Function
// =========================
function setEnvValue(key, value, doubleQuote) {
  try {
    if (!fs.existsSync(ENV_PATH)) {
      throw new Error(`.env file not found at: ${ENV_PATH}`);
    }

    let envContent = fs.readFileSync(ENV_PATH, "utf8");
    if (!envContent) {
      throw new Error("Failed to read .env file.");
    }

    const safeValue = doubleQuote ? `"${value}"` : value;
    const pattern = new RegExp(`^${key}=.*`, "m");
    const replacement = `${key}=${safeValue}`;

    if (pattern.test(envContent)) {
      envContent = envContent.replace(pattern, replacement);
    } else {
      envContent += `\n${replacement}\n`;
    }

    fs.writeFileSync(ENV_PATH, envContent, "utf8");

  } catch (error) {
    throw new Error(`Error updating .env: ${error.message}`);
  }
}



// =========================
// Controller Function
// =========================
export const changeEmailCredential = async (req, res) => {
  try {
    const {
      mail_mailer,
      mail_host,
      mail_port,
      mail_username,
      mail_password,
      mail_encryption,
      mail_from_address,
      mail_from_name
    } = req.body;

    // Convert port to int
    if (mail_port) req.body.mail_port = parseInt(mail_port);

    // At least one field required
    const validFields = [
      mail_mailer,
      mail_host,
      mail_port,
      mail_username,
      mail_password,
      mail_encryption,
      mail_from_address,
      mail_from_name
    ];

    if (!validFields.some(v => v)) {
      return res.status(400).json({
        status: false,
        message: "At least one mail credential field must be provided."
      });
    }

    // Update ENV same as Laravel
    if (mail_mailer) setEnvValue("MAIL_MAILER", mail_mailer, false);
    if (mail_host) setEnvValue("MAIL_HOST", mail_host, false);
    if (mail_port) setEnvValue("MAIL_PORT", mail_port, false);
    if (mail_username) setEnvValue("MAIL_USERNAME", mail_username, false);
    if (mail_password) setEnvValue("MAIL_PASSWORD", mail_password, false);
    if (mail_encryption) setEnvValue("MAIL_ENCRYPTION", mail_encryption, false);

    if (mail_from_address)
      setEnvValue("MAIL_FROM_ADDRESS", mail_from_address, true); // quotes

    if (mail_from_name)
      setEnvValue("MAIL_FROM_NAME", mail_from_name, false);


    return res.status(200).json({
      status: true,
      message: "The email credential's value has been changed successfully"
    });

  } catch (err) {
    return res.status(500).json({
      status: false,
      message: "Unable to update email credentials.",
      errors: err.message
    });
  }
};