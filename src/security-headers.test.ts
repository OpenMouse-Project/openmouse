import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CSP,
  PERMISSIONS_POLICY,
  SECURITY_HEADERS,
} from "../functions/_lib/security-headers.js";
import { TRUSTED_TYPES_POLICY, setSanitizedHtml } from "./trusted-types.ts";

const headersFile = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");

function deployedHeaders(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of headersFile.split(/\r?\n/)) {
    const match = /^ {2}([A-Za-z][A-Za-z-]*): (.+)$/.exec(line);
    if (match) map.set(match[1], match[2].trim());
  }
  return map;
}

function directive(name: string): string {
  const found = CSP.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name);
  assert.ok(found, `CSP is missing ${name}`);
  return found;
}

test("public/_headers mirrors the canonical security header set", () => {
  const deployed = deployedHeaders();
  for (const [name, value] of SECURITY_HEADERS) {
    assert.equal(
      deployed.get(name),
      value,
      `${name} in public/_headers drifted from functions/_lib/security-headers.js`,
    );
  }
});

test("the deployed CSP keeps scripts same-origin and inline-free", () => {
  assert.equal(directive("default-src"), "default-src 'self'");
  assert.equal(directive("script-src"), "script-src 'self'");
  assert.ok(!CSP.includes("'unsafe-inline'"), "no directive may allow inline code");
  assert.ok(!CSP.includes("'unsafe-eval'"), "eval must stay blocked");
  assert.equal(directive("script-src-attr"), "script-src-attr 'none'");
  assert.equal(directive("style-src-attr"), "style-src-attr 'none'");
  assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive("object-src"), "object-src 'none'");
  assert.equal(directive("base-uri"), "base-uri 'none'");
  assert.equal(directive("form-action"), "form-action 'self'");
});

test("the deployed CSP enforces Trusted Types with the app policy", () => {
  assert.equal(directive("require-trusted-types-for"), "require-trusted-types-for 'script'");
  assert.equal(directive("trusted-types"), `trusted-types ${TRUSTED_TYPES_POLICY}`);
});

test("the deployed CSP allows every origin the app talks to", () => {
  const connect = directive("connect-src");
  for (const origin of [
    "https://api.github.com",
    "https://cdn.jsdelivr.net",
    "http://127.0.0.1:17846",
    "ws://127.0.0.1:17846",
  ]) {
    assert.ok(connect.includes(origin), `connect-src must include ${origin}`);
  }
  assert.ok(directive("style-src").includes("https://fonts.googleapis.com"));
  assert.ok(directive("font-src").includes("https://fonts.gstatic.com"));
  assert.ok(directive("img-src").includes("https://img.openmouse.app"));
  assert.ok(directive("img-src").includes("blob:"), "artwork previews use blob: URLs");
  assert.ok(directive("img-src").includes("http://127.0.0.1:17846"), "Bridge app icons");
  for (const origin of [
    "https://cdn.cloudflare.steamstatic.com",
    "https://shared.akamai.steamstatic.com",
    "https://store-images.s-microsoft.com",
  ]) {
    assert.ok(directive("img-src").includes(origin), `game cover art needs ${origin}`);
  }
});

test("the deployed CSP never upgrades the loopback bridge to https", () => {
  // upgrade-insecure-requests would rewrite http://127.0.0.1:17846 and break
  // communication with the local OpenMouse Bridge.
  assert.ok(!CSP.includes("upgrade-insecure-requests"));
});

test("cross-origin isolation is limited to COOP + CORP", () => {
  const deployed = deployedHeaders();
  assert.equal(deployed.get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(deployed.get("Cross-Origin-Resource-Policy"), "same-origin");
  // COEP is intentionally off: the service worker caches third-party Google
  // Fonts as opaque responses, which COEP: credentialless would block, and the
  // app needs no cross-origin isolation. Guard against an accidental re-add.
  assert.equal(deployed.has("Cross-Origin-Embedder-Policy"), false);
  assert.equal(deployed.get("X-Content-Type-Options"), "nosniff");
  assert.equal(deployed.get("X-Frame-Options"), "DENY");
});

test("the permissions policy keeps clipboard writes but drops sensors", () => {
  assert.ok(PERMISSIONS_POLICY.includes("clipboard-write=(self)"), "copy buttons need clipboard-write");
  assert.ok(PERMISSIONS_POLICY.includes("clipboard-read=()"));
  for (const feature of ["camera=()", "microphone=()", "geolocation=()", "usb=()", "payment=()"]) {
    assert.ok(PERMISSIONS_POLICY.includes(feature), `Permissions-Policy must include ${feature}`);
  }
});

test("setSanitizedHtml writes markup when Trusted Types is unavailable", () => {
  const target = { innerHTML: "" };
  setSanitizedHtml(target, '<svg class="battery-icon"></svg>');
  assert.equal(target.innerHTML, '<svg class="battery-icon"></svg>');
});

test("the page ships no inline scripts for the CSP to block", () => {
  const inline = indexHtml.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
  assert.deepEqual(inline, [], `inline scripts found: ${inline.join(", ")}`);
  assert.match(indexHtml, /<script[^>]*src="\/theme-init\.js"/);
});

