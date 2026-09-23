// Canonical security headers for every OpenMouse response.
//
// `public/_headers` declares the exact same set for the static assets Pages
// serves directly; this module applies it to the Pages Functions responses
// (the IP-ban screen, blocked/rate-limited replies, and all /api/* payloads),
// which `_headers` does not cover. `src/security-headers.test.ts` keeps the two
// copies in lockstep so they cannot drift.
//
// `upgrade-insecure-requests` is deliberately absent. It would rewrite the
// loopback OpenMouse Bridge origin (http://127.0.0.1:17846) to https and break
// communication with local hardware.
//
// `Cross-Origin-Embedder-Policy` is deliberately absent too. `credentialless`
// would enable cross-origin isolation, but the service worker proxies and caches
// third-party Google Fonts as opaque responses; under COEP the CORP check blocks
// opaque responses that carry credentials, a documented failure mode for
// SW-proxied cross-origin resources (W3C ServiceWorker #1592, whatwg/html #7745),
// and Google Fonts sends no CORP. The app needs no cross-origin isolation (no
// SharedArrayBuffer or wasm threads), and the Spectre-class threat it mitigates
// requires script execution, which the CSP and Trusted Types already block. So
// COOP + CORP are kept and COEP is intentionally left off.

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'none'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://img.openmouse.app https://cdn.cloudflare.steamstatic.com https://shared.akamai.steamstatic.com https://store-images.s-microsoft.com http://127.0.0.1:17846",
  "media-src 'self'",
  "connect-src 'self' https://api.github.com https://cdn.jsdelivr.net http://127.0.0.1:17846 ws://127.0.0.1:17846",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types openmouse",
].join("; ");

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "autoplay=(self)",
  "browsing-topics=()",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "gamepad=()",
  "geolocation=()",
  "gyroscope=()",
  "interest-cohort=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

export const SECURITY_HEADERS = [
  ["Content-Security-Policy", CSP],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", PERMISSIONS_POLICY],
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
  ["X-Permitted-Cross-Domain-Policies", "none"],
  ["X-XSS-Protection", "0"],
];

/**
 * Applies the canonical security headers to a response in place, skipping any
 * header the response already sets (e.g. the ban screen's dedicated CSP). Header
 * mutation avoids rebuilding the body, so streaming/range responses stay intact.
 */
export function hardenResponse(response) {
  for (const [name, value] of SECURITY_HEADERS) {
    if (response.headers.has(name)) continue;
    try {
      response.headers.set(name, value);
    } catch {
      // Some platform-generated responses expose immutable headers; a missing
      // hardening header must never turn into a 500.
    }
  }
  return response;
}
