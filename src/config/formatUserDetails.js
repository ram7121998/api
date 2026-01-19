import axios from "axios";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

export async function formatUserDetails(user, withCountryDetails = true) {
  console.log("user.loggedIn_device_ip",user.loggedIn_device_ip)
  try {
    const emailVerified = !!user.email_verified_at;
    const phoneVerified = !!user.phone_verified_at;
    const idVerified = !!user.id_verified_at;
    const addressVerified = !!user.address_verified_at;

   let countryData = {
  country: "India",
  countryCode: "IN",
  city: "Unknown",
  country_flag: "https://flagcdn.com/w320/in.png",
};


    // 🌐 Fetch location by IP
    if (withCountryDetails && user.loggedIn_device_ip) {
      try {
        const { data } = await axios.get(
          `http://ip-api.com/json/${user.loggedIn_device_ip}`
        );

        if (data.status === "success") {
          countryData = {
            country: data.country,
            countryCode: data.countryCode,
            city: data.city,
            country_flag: `https://flagcdn.com/w320/${data.countryCode.toLowerCase()}.png`,
          };
        }
      } catch {
        console.warn(`⚠️ Country lookup failed for IP: ${user.loggedIn_device_ip}`);
      }
    }
console.log(user.profile_image)
    const imagePath = user.profile_image;

    const profileImageUrl =
      imagePath && !/^https?:\/\//i.test(imagePath)
        ? `${process.env.APP_URL || ""}/storage/${imagePath}`
        : imagePath;

    const preferredTimezone = user.preferred_timezone || "Asia/Kolkata";

    return {
      user_id: user.user_id?.toString(),
      name: user.name,
      username: user.username,
      username_changed: !!user.username_changed,
      email: user.email,
      dialing_code: user.dialing_code,
      phone_number: user.phone_number,
      email_verified: emailVerified,
      phone_verified: phoneVerified,
      id_verified: idVerified,
      address_verified: addressVerified,
      twoFactorAuth: !!user.two_factor_auth,
      profile_image_url: profileImageUrl,
      country: countryData.country,
      country_code: countryData.countryCode,
      city: countryData.city,
      country_flag_url: countryData.country_flag,
      preferred_currency: user.preferred_currency,
      preferred_timezone: preferredTimezone,
      bio: user.bio,
      login_with: user.login_with,
      login_status: user.login_status,
      last_login: user.last_login
        ? dayjs(user.last_login).tz(preferredTimezone).format("YYYY-MM-DD hh:mm A")
        : null,
      last_seen_at: user.last_seen
        ? dayjs(user.last_seen).fromNow()
        : "Unknown",
      last_login_duration: user.last_login
        ? dayjs(user.last_login).fromNow()
        : "Unknown",
      user_status: user.user_status,
    };
  } catch (error) {
    throw new Error(`User details failed: ${error.message}`);
  }
}
