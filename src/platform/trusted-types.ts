// Trusted Types bridge for the deployed page.
//
// The CSP in `functions/_lib/security-headers.js` (mirrored in `public/_headers`)
// enables `require-trusted-types-for 'script'` and whitelists a single policy
// named "openmouse". That makes raw `innerHTML = "<svg ...>"` assignments throw
// in enforcing browsers. The app only ever assigns markup it generated itself,
// so `setTrustedHtml` funnels it through the named policy; browsers without
// Trusted Types (or without the CSP) fall back to the plain string.
//
// Static markup only: the policy is an identity function, not a sanitizer.
// Callers MUST pass markup built from constants and numbers (e.g.
// `batteryIconMarkup`, which interpolates only formatted coordinates) — never
// device names, user text, or other free-form strings.

export const TRUSTED_TYPES_POLICY = "openmouse";

interface TrustedHtmlPolicy {
  createHTML(input: string): string;
}

interface TrustedTypePolicyFactoryLike {
  createPolicy(name: string, rules: { createHTML(input: string): string }): TrustedHtmlPolicy;
}

let policy: TrustedHtmlPolicy | null = null;
let resolved = false;

function htmlPolicy(): TrustedHtmlPolicy | null {
  if (resolved) return policy;
  resolved = true;
  if (typeof window === "undefined") return policy;
  const factory = (window as unknown as { trustedTypes?: TrustedTypePolicyFactoryLike }).trustedTypes;
  if (!factory) return policy;
  try {
    policy = factory.createPolicy(TRUSTED_TYPES_POLICY, { createHTML: (input) => input });
  } catch {
    // A duplicate or disallowed policy name must not take down the UI.
    policy = null;
  }
  return policy;
}

/**
 * Assigns internally generated static markup to an element's `innerHTML`,
 * routing it through the Trusted Types policy when the browser enforces one.
 *
 * The policy performs no sanitization, so `markup` must be static markup the
 * app built itself from constants and numbers — never free-form text.
 */
export function setTrustedHtml(target: { innerHTML: string }, markup: string): void {
  const trusted = htmlPolicy()?.createHTML(markup);
  target.innerHTML = trusted ?? markup;
}
