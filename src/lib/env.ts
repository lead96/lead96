import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  /** Setup chat only interprets short answers, so a smaller, faster model is enough. */
  OPENAI_CHAT_MODEL: z.string().min(1).default("gpt-4.1-nano"),
  /** Shared secret for signed webhooks into /api/intake/* (call intake). Intake is off when unset. */
  INTAKE_SIGNING_SECRET: z.string().min(32).optional(),
  /** 32 bytes as 64 hex chars. Encrypts stored platform sign-ins (Google Ads refresh token). */
  CREDENTIALS_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  /** Vercel Cron sends it as a Bearer token; scheduled syncs are refused without it. */
  CRON_SECRET: z.string().min(16).optional(),
  // Google Ads via the Lead96 manager account (agency model). The sign-in itself is stored
  // encrypted in platform_connections (Admin -> Google Ads -> Connect).
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(1).optional(),
  /** Manager (MCC) account ID; dashes are ignored. */
  GOOGLE_ADS_MANAGER_ID: z.string().min(1).optional(),
  GOOGLE_ADS_API_VERSION: z.string().regex(/^v\d+$/).default("v25"),
  // Meta via the Lead96 Business Manager + System User token (agency model).
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  META_SYSTEM_USER_TOKEN: z.string().min(1).optional(),
  META_BUSINESS_ID: z.string().min(1).optional(),
});

const OPTIONAL_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_MANAGER_ID",
  "GOOGLE_ADS_API_VERSION",
  "CREDENTIALS_ENCRYPTION_KEY",
  "CRON_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_SYSTEM_USER_TOKEN",
  "META_BUSINESS_ID",
] as const;

// NEXT_PUBLIC_* values must be referenced literally so Next can inline them in the browser bundle.
export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

export function serverEnv() {
  return serverSchema.parse({
    ...publicEnv(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
    OPENAI_MODEL: process.env.OPENAI_MODEL || undefined,
    OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL || undefined,
    INTAKE_SIGNING_SECRET: process.env.INTAKE_SIGNING_SECRET || undefined,
    ...Object.fromEntries(OPTIONAL_KEYS.map((k) => [k, process.env[k] || undefined])),
  });
}
