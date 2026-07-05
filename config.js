// Super AI site configuration.
// To enable the "Sign in with Google" button:
//   1. Create an OAuth Client ID at https://console.cloud.google.com/apis/credentials
//      (type: Web application; add your GitHub Pages URL to Authorized JavaScript origins)
//   2. Paste it below and push.
window.SUPERAI_CONFIG = {
  GOOGLE_CLIENT_ID: "",          // e.g. "1234567890-abc.apps.googleusercontent.com"
  // Auto-download is OFF by default and NEVER runs on phones — a big model in
  // the background is what froze mobiles. Desktops can opt in by setting true.
  AUTO_BRAIN_DOWNLOAD: false,
  AUTO_BRAIN_MODEL: "SmolLM2-360M-Instruct-q4f16_1-MLC",
  DAILY_TOKEN_LIMIT: 20000,
};
