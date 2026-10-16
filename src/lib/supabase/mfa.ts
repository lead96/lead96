import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-factor is on for this user but the session has no code yet (aal1 while aal2 is possible).
 * Reads the factor list from the session cookie, without a network call. That source isn't
 * trusted on the server, so Supabase would warn on every request; it's fine here because this only
 * decides what to show - the database enforces two-factor from the signed token (mfa_ok()).
 */
export async function needsSecondFactor(supabase: SupabaseClient) {
  (supabase.auth as unknown as { suppressGetSessionWarning: boolean }).suppressGetSessionWarning = true;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { needed: data?.nextLevel === "aal2" && data.currentLevel !== "aal2", signedIn: Boolean(data?.currentLevel) };
}
