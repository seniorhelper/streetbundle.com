/* StreetBundle runtime config.
   Leave the keys blank and the site runs in DEMO MODE (everything works, saved on this device only).
   Paste your Supabase + Stripe keys and it switches to LIVE MODE automatically — no other code changes. */
window.HW_CONFIG = {
  BRAND: "StreetBundle",
  SITE: "https://www.streetbundle.com",
  PHONE: "1-800-481-8638",
  SUPABASE_URL: "",        // e.g. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "",   // Supabase > Project Settings > API > anon public key
  STRIPE_PUBLISHABLE_KEY: "", // pk_live_... (card holds when households approve a price)
  PLATFORM_FEE_PCT: 8,     // what pros pay on bundles they win
  BID_WINDOW_HOURS: 48,
  APPROVAL_WINDOW_HOURS: 72
};
