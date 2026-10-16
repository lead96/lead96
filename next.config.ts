import type { NextConfig } from "next";

/**
 * Security headers on every response (M6 security review). The content security policy only covers
 * what can't break the app: no framing of our pages (clickjacking), no plugins, no <base> or form
 * posts to other sites. Scripts and connections are not restricted (Supabase, Retell web calls).
 * The microphone stays allowed for our own pages: Admin > AI voice runs browser test calls.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
