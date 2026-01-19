import fs from "fs";
import moment from "moment";
import path from "path";

export const getCountriesCurrency = async (req, res) => {
  try {
    // ✅ Build path to JSON file
    const filePath = path.join(process.cwd(), "storage", "json-file", "countries.json");

    // ✅ Read JSON file
    const jsonData = fs.readFileSync(filePath, "utf8");
    const countries = JSON.parse(jsonData);

    const countriesData = [];

    for (const country of countries) {
      if (!country.currencies || Object.keys(country.currencies).length === 0) {
        continue; // skip if missing currency data
      }

      if (country.name?.common !== "India") {
        continue; // only include India
      }

      const currencyKey = Object.keys(country.currencies)[0];
      const currency = country.currencies[currencyKey];

      countriesData.push({
        country_name: country.name?.common || "Unknown",
        country_code: country.cca3 || "N/A",
        currency_code: currencyKey || "N/A",
        currency_name: currency?.name || "N/A",
        currency_symbol: currency?.symbol || "N/A",
        country_flag_url: country.flags?.png || "",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Countries Currency data fetched successfully",
      data: countriesData,
    });
  } catch (error) {
    console.error("Error fetching countries currency data:", error);
    return res.status(500).json({
      status: false,
      message: "Unable to fetch countries currency data",
      errors: error.message,
    });
  }
};
export const getCountriesDialingCode = async (req, res) => {
  try {
    // ✅ File path banaye (Laravel ke storage_path jaisa)
    const filePath = path.join(process.cwd(), "storage", "json-file", "countries.json");

    // ✅ JSON file read kare
    const jsonData = fs.readFileSync(filePath, "utf8");
    const countries = JSON.parse(jsonData);

    // ✅ Data process kare
    const countriesData = countries.map((country) => ({
      name: country?.name?.common || "Unknown",
      code: country?.cca3 || "",
      dialing_code:
        country?.idd?.root && country?.idd?.suffixes?.length > 0
          ? country.idd.root + country.idd.suffixes[0]
          : null,
      flag_url: country?.flags?.png || "",
    }));

    // ✅ Response
    return res.status(200).json({
      status: true,
      message: "Country data fetched successfully",
      data: countriesData,
    });
  } catch (error) {
    console.error("Error reading countries:", error);
    return res.status(500).json({
      status: false,
      message: "Unable to fetch countries data",
      errors: error.message,
    });
  }
};

export const getTimezone = async (req, res) => {
  try {
    const timezones = moment.tz.names();

    return res.status(200).json({
      status: true,
      message: "List of timezone of all countries is successfully fetched",
      data: timezones,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Failed to fetch timezone data",
      errors: error.message,
    });
  }
};

// ✅ Get Countries from JSON file
export const getCountries = async (req, res) => {
  try {
    const filePath = path.join(process.cwd(), "storage", "json-file", "countries.json");
    const jsonData = fs.readFileSync(filePath, "utf8");
    const countries = JSON.parse(jsonData);

    const countriesData = countries.map((country) => ({
      Country_name: country.name?.common || "N/A",
      Country_code: country.cca3 || "N/A",
    }));

    return res.status(200).json({
      status: true,
      message: "Countries name fetched successfully.",
      data: countriesData,
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Unable to fetch countries name.",
      errors: error.message,
    });
  }
};