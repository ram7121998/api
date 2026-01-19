import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const storeReport = async (req, res) => {
  try {
    const user = req.user; // Logged-in user (from auth middleware)

    const { reported_to_id, trade_id, reason, description } = req.body;

    // =========================
    // VALIDATION
    const errors = {};

    if (!reported_to_id) errors.reported_to_id = "reported_to_id is required";
    if (!trade_id) errors.trade_id = "trade_id is required";
    if (!reason) errors.reason = "reason is required";

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        status: false,
        message: "Validation failed",
        errors,
      });
    }

    // Check User existence
    const reportedUser = await prisma.users.findUnique({
      where: { user_id: BigInt(reported_to_id) },
    });

    if (!reportedUser) {
      return res.status(422).json({
        status: false,
        message: "The selected user does not exist.",
      });
    }

    // Prevent reporting own self
    if (BigInt(user.user_id) === BigInt(reported_to_id)) {
      return res.status(422).json({
        status: false,
        message: "You cannot report yourself.",
      });
    }

    // Check trade existence
    const trade = await prisma.trades.findUnique({
      where: { trade_id: BigInt(trade_id) },
    });

    if (!trade) {
      return res.status(422).json({
        status: false,
        message: "Trade does not exist.",
      });
    }

    // Check if already reported
    const alreadyReported = await prisma.reports.findFirst({
      where: {
        reported_by_id: BigInt(user.user_id),
        reported_to_id: BigInt(reported_to_id),
        trade_id: BigInt(trade_id),
      },
    });

    if (alreadyReported) {
      return res.status(409).json({
        status: false,
        message: "You have already submitted a report for this trade.",
      });
    }

    // Create report
    await prisma.reports.create({
      data: {
        reported_by_id: BigInt(user.user_id),
        reported_to_id: BigInt(reported_to_id),
        reason,
        description,
        trade_id: BigInt(trade_id),
      },
    });

    return res.status(201).json({
      status: true,
      message: "Report submitted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: "Failed to report.",
      errors: err.message,
    });
  }
};

export const getReport = async (req, res) => {
  try {
    const user = req.user; // Logged-in user from auth middleware

    const reports = await prisma.reports.findMany({
      where: {
        reported_to_id: BigInt(user.user_id),
      },
      orderBy: {
        report_id: "desc",
      },
      select: {
        report_id: true,
        reported_by_id: true,
        reported_to_id: true,
        reason: true,
        description: true,
        trade_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    const totalReport = reports.length;

    return res.status(200).json({
      status: true,
      message: "Report retrieved successfully.",
      data: reports,
      analytics: {
        total_report: totalReport,
      },
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: "Failed to retrieve report.",
      errors: err.message,
    });
  }
};

export const getUsersReport = async (req, res) => {
  try {
    const perPage = Number(req.query.per_page) || 10;
    const page = Number(req.query.page) || 1;

    // Filters mapping
    const filterFields = {
      user_id: "reported_to_id",
      report_id: "report_id",
    };

    // Base where condition
    const where = {};

    for (const key in filterFields) {
      if (req.query[key]) {
        const column = filterFields[key];
        where[column] = BigInt(req.query[key]);
      }
    }

    // Total reports (without filters)
    const totalReports = await prisma.reports.count();

    // Total filtered reports  
    const totalFilteredReport = await prisma.reports.count({ where });

    // Paginated reports
    const reports = await prisma.reports.findMany({
      where,
      orderBy: {
        report_id: "desc",
      },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        reporter: true,       // relation with users table
        reportedTo: true,     // relation with users table
      },
    });

    // Add userDetails like Laravel
    const formattedReports = reports.map((report) => {
      return {
        ...report,
        reported_user_details: report.reportedTo,
        reported_by_user_details: report.reporter,
        reporter: undefined,
        reportedTo: undefined,
      };
    });

    // Pagination response (Laravel style)
    const pagination = {
      current_page: page,
      from: reports.length ? (page - 1) * perPage + 1 : null,
      to: reports.length ? (page - 1) * perPage + reports.length : null,
      total: totalFilteredReport,
      first_page_url: `${req.protocol}://${req.get("host")}${req.path}?page=1`,
      last_page: Math.ceil(totalFilteredReport / perPage),
      last_page_url: `${req.protocol}://${req.get("host")}${req.path}?page=${Math.ceil(
        totalFilteredReport / perPage
      )}`,
      next_page_url:
        page < Math.ceil(totalFilteredReport / perPage)
          ? `${req.protocol}://${req.get("host")}${req.path}?page=${page + 1}`
          : null,
      prev_page_url:
        page > 1
          ? `${req.protocol}://${req.get("host")}${req.path}?page=${page - 1}`
          : null,
      per_page: perPage,
      path: `${req.protocol}://${req.get("host")}${req.path}`,
    };

    return res.status(200).json({
      status: true,
      message: "Report retrieved successfully",
      data: formattedReports,
      pagination,
      analytics: {
        total_reports: totalReports,
        total_filtered_report: totalFilteredReport,
      },
    });
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: "Failed to retrieve reports data.",
      errors: err.message,
    });
  }
};