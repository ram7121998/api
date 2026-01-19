export const getCountryData = async (ipAddress) => {
    const defaultData = {
        country: null,
        country_code: null,
        city: null,
        country_flag: null,
    };

    // Check valid IP
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (!ipRegex.test(ipAddress)) {
        return defaultData;
    }

    try {
        const response = await fetch(`http://ip-api.com/json/${ipAddress}`);
        const data = await response.json();

        if (data.status === "success") {
            return {
                country: data.country,
                country_code: data.countryCode,
                city: data.city,
                country_flag: `https://flagcdn.com/w320/${data.countryCode.toLowerCase()}.png`,
            };
        }

        return defaultData;
    } catch (err) {
        return defaultData;
    }
};