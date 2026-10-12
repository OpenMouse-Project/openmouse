// Renders the README's "OpenMouse on Discord" card as an SVG, with live member
// and online counts when Discord answers.
//
// Counts come from Discord's public invite lookup (no bot or token needed):
// `approximate_member_count` and `approximate_presence_count`. When the lookup
// fails, the card falls back to the static tagline so the README never shows a
// broken image. Layout and colors mirror `.github/assets/discord-card.svg`.

export const DISCORD_INVITE_CODE = "yxC9jzMdw6";

const INVITE_API = `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`;

// Discord often rate-limits or blocks requests from Cloudflare's shared
// Worker IPs. shields.io's dynamic-JSON badge fetches the same invite payload
// from its own servers, so it serves as a relay when the direct lookup fails.
const shieldsRelay = (field) =>
  `https://img.shields.io/badge/dynamic/json.json?url=${encodeURIComponent(INVITE_API)}&query=${encodeURIComponent(`$.${field}`)}&label=x`;

const REQUEST_HEADERS = { Accept: "application/json", "User-Agent": "OpenMouse README card (+https://openmouse.app)" };

const toCount = (value) => {
  const number = typeof value === "string" && /^[\d,]+$/.test(value.trim()) ? Number(value.replace(/,/g, "")) : value;
  return Number.isFinite(number) ? number : null;
};

async function fetchDirect(fetchImpl) {
  const response = await fetchImpl(INVITE_API, { headers: REQUEST_HEADERS });
  if (!response.ok) return { error: `discord ${response.status}` };
  const data = await response.json();
  const members = toCount(data?.approximate_member_count);
  const online = toCount(data?.approximate_presence_count);
  if (members === null || online === null) return { error: "discord payload" };
  return { members, online };
}

async function fetchShieldsField(fetchImpl, field) {
  const response = await fetchImpl(shieldsRelay(field), { headers: REQUEST_HEADERS });
  if (!response.ok) return null;
  const data = await response.json();
  return toCount(data?.message ?? data?.value);
}

async function fetchViaShields(fetchImpl) {
  const [members, online] = await Promise.all([
    fetchShieldsField(fetchImpl, "approximate_member_count"),
    fetchShieldsField(fetchImpl, "approximate_presence_count"),
  ]);
  if (members === null || online === null) return { error: "shields" };
  return { members, online };
}

/**
 * Fetches the approximate member and online counts for the invite's server,
 * directly from Discord and then through the shields.io relay.
 * Returns `{ members, online, source }`, or `{ error }` when both fail.
 */
export async function fetchDiscordCounts(fetchImpl = fetch) {
  const errors = [];
  for (const [source, attempt] of [["discord", fetchDirect], ["shields", fetchViaShields]]) {
    try {
      const result = await attempt(fetchImpl);
      if (!result.error) return { members: result.members, online: result.online, source };
      errors.push(result.error);
    } catch (error) {
      errors.push(`${source} ${error instanceof Error ? error.message : "error"}`);
    }
  }
  return { error: errors.join("; ") };
}

const formatCount = (value) => Math.max(0, Math.round(value)).toLocaleString("en-US");

const SANS = `"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
const MONO = `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** Builds the card SVG. `counts` is `{ members, online }`; anything else renders the static tagline. */
export function renderDiscordCard(counts) {
  if (!Number.isFinite(counts?.members) || !Number.isFinite(counts?.online)) counts = null;
  const subline = counts
    ? `<text class="sub" x="112" y="87"><tspan class="dot-online">●</tspan> ${formatCount(counts.online)} online<tspan class="dot-members" dx="12">●</tspan> ${formatCount(counts.members)} members</text>`
    : `<text class="sub" x="112" y="87">Help, device requests &amp; dev updates</text>`;
  const label = counts
    ? `Join OpenMouse on Discord: ${formatCount(counts.online)} online, ${formatCount(counts.members)} members`
    : "Join OpenMouse on Discord";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="112" viewBox="0 0 520 112" role="img" aria-label="${label}">
  <style>
    .card { fill: #111315; stroke: #292d32; }
    .tile { fill: #151719; }
    .title { fill: #f2f3f5; font: 700 22px ${SANS}; }
    .sub { fill: #9a9fa8; font: 400 14px ${SANS}; }
    .eyebrow { fill: #5dde89; font: 600 11px ${MONO}; letter-spacing: .12em; }
    .dot-online { fill: #5dde89; }
    .dot-members { fill: #686e77; }
    .btn { fill: #5dde89; }
    .btn-label { fill: #07160e; font: 700 15px ${SANS}; }
    @media (prefers-color-scheme: light) {
      .card { fill: #ffffff; stroke: #e2e2dc; }
      .tile { fill: #f0f0eb; }
      .title { fill: #18191b; }
      .sub { fill: #5b6069; }
      .eyebrow { fill: #1f9d55; }
      .dot-online { fill: #1f9d55; }
      .dot-members { fill: #9a9fa8; }
    }
  </style>
  <rect class="card" x="0.5" y="0.5" width="519" height="111" rx="18" stroke-width="1"/>
  <rect class="tile" x="20" y="20" width="72" height="72" rx="16"/>
  <svg x="28" y="28" width="56" height="56" viewBox="0 0 512 512" fill="none">
    <path d="M256 40c-92 0-143 68-143 188v46c0 125 54 198 143 198s143-73 143-198v-46c0-120-51-188-143-188Z" fill="#FFFFFF" stroke="#09090B" stroke-width="14"/>
    <path d="M256 41v129" stroke="#09090B" stroke-width="17"/>
    <rect x="216" y="123" width="80" height="141" rx="40" fill="#09090B"/>
    <rect x="242" y="149" width="28" height="87" rx="14" fill="#69D28D"/>
  </svg>
  <text class="eyebrow" x="112" y="38">COMMUNITY</text>
  <text class="title" x="112" y="64">OpenMouse on Discord</text>
  ${subline}
  <rect class="btn" x="384" y="36" width="116" height="40" rx="20"/>
  <text class="btn-label" x="442" y="61" text-anchor="middle">Join server</text>
</svg>
`;
}
