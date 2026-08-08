/**
 * The Background Service is a Windows executable, so its whole sidebar page is
 * hidden elsewhere. WebHID works fine on macOS and Linux and the rest of
 * OpenMouse is fully usable there; offering those users an installer they
 * cannot run would be the only broken thing on the page.
 *
 * Takes the navigator rather than reading the global so it can be tested.
 */
export interface PlatformSource {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

export function isWindows(source: PlatformSource): boolean {
  // userAgentData is the only one of the three not frozen or deprecated, so
  // prefer it and trust it: a Chromium browser that reports "macOS" here is
  // not Windows, whatever the legacy userAgent string still claims.
  const hinted = source.userAgentData?.platform;
  if (hinted) return hinted === "Windows";
  if (source.platform) return /^win/i.test(source.platform);
  return /windows/i.test(source.userAgent ?? "");
}
