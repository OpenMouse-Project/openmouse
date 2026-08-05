export interface BrowserEnvironment {
  touchPrimary: boolean;
  hasWebHid: boolean;
}

export interface UnsupportedNotice {
  headline: string;
  detail: string;
}

export function unsupportedNotice(env: BrowserEnvironment): UnsupportedNotice | null {
  if (env.touchPrimary) {
    return {
      headline: "Use a desktop.",
      detail: "OpenMouse cannot reach your mouse from a phone or tablet.",
    };
  }
  if (!env.hasWebHid) {
    return {
      headline: "Use a Chromium browser.",
      detail: "OpenMouse needs WebHID. Try Chrome, Edge, or Helium.",
    };
  }
  return null;
}

export function unsupportedTemplate(notice: UnsupportedNotice): string {
  return `<section class="small-screen-blocker">
    <h1>${notice.headline}</h1>
    <p>${notice.detail}</p>
  </section>`;
}
