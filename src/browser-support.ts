export interface BrowserEnvironment {
  hasWebHid: boolean;
  handheld: boolean;
  secureContext: boolean;
  chromium: boolean;
}

export interface UnsupportedNotice {
  headline: string;
  detail: string;
}

export function unsupportedNotice(env: BrowserEnvironment): UnsupportedNotice | null {
  if (env.hasWebHid) return null;
  if (env.handheld) {
    return {
      headline: "Use a desktop.",
      detail: "OpenMouse cannot reach your mouse from a phone or tablet.",
    };
  }
  if (!env.chromium) {
    return {
      headline: "Install Bridge, or use a Chromium browser.",
      detail: "This browser has no WebHID. OpenMouse Bridge gives it native access to your mouse; without it, use Chrome, Edge, or Helium.",
    };
  }
  if (!env.secureContext) {
    return {
      headline: "Open this page over HTTPS.",
      detail: "WebHID is only available on a secure connection. Use an https:// address or localhost.",
    };
  }
  return {
    headline: "Update your browser.",
    detail: "OpenMouse needs WebHID, added in Chrome and Edge 89. Update to the latest version.",
  };
}
