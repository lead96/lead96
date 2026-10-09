/** Helpers for Supabase/PostgREST errors, which are plain objects ({ message, details, hint, code }). */

type DbError = { message: string; code?: string | null };

/** A request that never reached the database (network drop, timeout) comes back without an error code. */
export const isNetworkError = (e: DbError | null | undefined) => Boolean(e) && !e!.code;

/** A real Error with a readable message, so logs and error pages show what happened. */
export function dbError(context: string, e: DbError): Error {
  return new Error(`${context}: ${e.message}${e.code ? ` (${e.code})` : ""}`);
}

/** Runs a read once more after a short pause if it failed because the database couldn't be reached. */
export async function withRetry<T extends { error: DbError | null }>(run: () => PromiseLike<T>, delayMs = 400): Promise<T> {
  const first = await run();
  if (!isNetworkError(first.error)) return first;
  await new Promise((r) => setTimeout(r, delayMs));
  return run();
}
