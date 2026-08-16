export interface GitHubRelease {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
  assets: Array<{ name: string; url: string }>;
}

interface GitHubReleaseResponse {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export type UpdateState = "update-available" | "up-to-date" | "ahead" | "unknown";

export function compareVersions(current: string, latest: string): UpdateState {
  const parse = (version: string): number[] | null => {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const left = parse(current);
  const right = parse(latest);
  if (!left || !right) return "unknown";
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return "update-available";
    if (left[index] > right[index]) return "ahead";
  }
  return "up-to-date";
}

export async function latestRelease(repository: string, signal?: AbortSignal): Promise<GitHubRelease | null> {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  const release = await response.json() as GitHubReleaseResponse;
  return {
    version: release.tag_name.replace(/^v/, ""),
    name: release.name || release.tag_name,
    notes: release.body?.trim() || "No release notes were provided.",
    url: release.html_url,
    publishedAt: release.published_at,
    assets: release.assets.map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
  };
}
