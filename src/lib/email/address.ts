/** Reserved names that can never receive mail (RFC 2606 / 6761). Pure - unit-tested. */
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

/**
 * True for addresses used by tests and examples. Sending to them only bounces, which hurts the
 * sender reputation of lead96.com, so app emails skip them.
 */
export function isUndeliverableAddress(email: string) {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  const tld = domain.split(".").pop() ?? "";
  return RESERVED_TLDS.includes(tld) || RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}
