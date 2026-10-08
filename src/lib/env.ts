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
});

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
  });
}
