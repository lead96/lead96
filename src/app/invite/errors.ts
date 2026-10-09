/** Error codes raised by the accept_invite() database function. */
export const INVITE_ERROR_CODES = [
  "invite_not_found",
  "invite_expired",
  "invite_used",
  "email_mismatch",
  "email_unverified",
  "not_signed_in",
] as const;

export type InviteErrorCode = (typeof INVITE_ERROR_CODES)[number];

export const INVITE_ERROR_TEXT: Record<InviteErrorCode | "unknown", string> = {
  invite_not_found: "This invite link isn't valid. It may have been cancelled - ask the owner for a new link.",
  invite_expired: "This invite has expired. Ask the owner to send a new one.",
  invite_used: "This invite has already been used.",
  email_mismatch: "This invite was sent to a different email address than the one you're signed in with.",
  email_unverified: "Please confirm your email address first, then open the invite link again.",
  not_signed_in: "Please sign in to accept the invite.",
  unknown: "Something went wrong accepting the invite. Please try again.",
};
