import { body } from 'express-validator';
import multer from 'multer';

export const validateUpdatePaymentStatus = [
  body('id').isInt().withMessage('id must be an integer'),
  body('status')
    .isIn(['pending', 'verified', 'reject'])
    .withMessage('status must be pending, verified, or reject'),
  body('remark')
    .if(body('status').equals('reject'))
    .notEmpty()
    .withMessage('remark is required if status is reject')
    .isString()
    .withMessage('remark must be a string')
    .isLength({ max: 255 })
    .withMessage('remark cannot exceed 255 characters')
];
export const validateUsername = [
  body("username")
    .isString()
    .withMessage("Username must be a string")
    .isLength({ min: 8 })
    .withMessage("Username must be at least 8 characters long"),
];
export const validateChangePassword = [
  body("current_password")
    .notEmpty().withMessage("Current password is required")
    .isString(),
  body("new_password")
    .notEmpty().withMessage("New password is required")
    .isString()
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters long")
    .custom((value) => {
      if (!/[A-Z]/.test(value)) {
        throw new Error("The password must contain at least one uppercase letter.");
      }
      if (!/[a-z]/.test(value)) {
        throw new Error("The password must contain at least one lowercase letter.");
      }
      if (!/[0-9]/.test(value)) {
        throw new Error("The password must contain at least one number.");
      }
      if (!/[!@#$%^&*(),.?":{}|<>_]/.test(value)) {
        throw new Error("The password must contain at least one special character.");
      }
      return true;
    }),
];

export const validateBio = [
  body("bio")
    .notEmpty().withMessage("Bio is required")
    .isString().withMessage("Bio must be a string")
    .isLength({ max: 180 }).withMessage("Bio cannot exceed 180 characters"),
];

export const validateSecurityQuestions = [
  body("questions")
    .isArray({ min: 3, max: 3 })
    .withMessage("You must provide exactly 3 questions"),
  body("questions.*.question_order")
    .isInt({ min: 1, max: 3 })
    .withMessage("Question order must be between 1 and 3"),
  body("questions.*.question")
    .isString()
    .withMessage("Question must be a string"),
  body("questions.*.answer")
    .isString()
    .withMessage("Answer must be a string"),
];

export const validateUpiUpdate = [
  body("id").isInt().withMessage("id must be an integer"),
  body("upi_name")
    .isString()
    .isIn(["phonepe", "google pay", "paytm", "amazon pay"])
    .withMessage("Invalid upi_name"),
  body("upi_id").isString().withMessage("upi_id is required"),
  body("caption").optional().isString(),
  body("is_primary").optional().isBoolean(),
];

export const validatePreferredCurrency = [
  body("preferred_currency").notEmpty().withMessage("preferred_currency is required").isString().withMessage("preferred_currency must be a string"),
];


export const validatePreferredTimezone = [
  body("preferred_timezone")
    .notEmpty()
    .withMessage("preferred_timezone is required")
    .isString()
    .withMessage("preferred_timezone must be a string"),
];

export const formData = multer().none();
