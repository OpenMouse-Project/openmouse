import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./donate.css";

const ORG = "OpenMouse-Project";
const REFRESH_MS = 15 * 60 * 1000;
const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 40;

/* ── Live contributor data (ported from the old Hall of Fame) ──────────── */

type RepoKey = string;

interface RepoInfo {
  key: RepoKey;
  label: string;
  fullName: string;
}

interface BranchData {
  key: RepoKey;
  repo: string;
  branch: string;
  label: string;
  commits: number;
  authors: { login: string; avatar: string | null; htmlUrl: string | null; count: number }[];
}

interface RepoPulls {
  key: RepoKey;
  repo: string;
  prs: number;
  authors: { login: string; avatar: string | null; htmlUrl: string | null; prs: number }[];
}

interface MergedContributor {
  login: string;
  avatar: string | null;
  htmlUrl: string | null;
  total: number;
  repos: Partial<Record<RepoKey, number>>;
  prs: Partial<Record<RepoKey, number>>;
}

interface CachedData {
  fetchedAt: number;
  branches: BranchData[];
  pulls: RepoPulls[];
  repoList: RepoInfo[];
  merged: MergedContributor[];
}

const CACHE_KEY = "openmouse-donate-contributors-v1";

/* Baked-in recent snapshot of contributors (from the org repo commit history at
   build time). Shown whenever GitHub is rate-limited; refreshed automatically by
   the next successful live fetch, which replaces it via localStorage. */
const DEFAULT_CONTRIBUTORS: { login: string; total: number; avatar: string }[] = [
  { login: "snekxs", total: 426, avatar: "https://github.com/snekxs.png" },
  { login: "jazzstack", total: 112, avatar: "https://github.com/jazzstack.png" },
  { login: "dwei30", total: 45, avatar: "https://github.com/dwei30.png" },
  { login: "viix0dev", total: 24, avatar: "https://github.com/viix0dev.png" },
  { login: "nyedle", total: 22, avatar: "https://github.com/nyedle.png" },
  { login: "angelocore", total: 21, avatar: "https://github.com/angelocore.png" },
  { login: "Pochiiko", total: 21, avatar: "https://github.com/Pochiiko.png" },
  { login: "Josh Jenkins", total: 19, avatar: "" },
  { login: "Grandma", total: 9, avatar: "" },
  { login: "AnasIsmai1", total: 7, avatar: "https://github.com/AnasIsmai1.png" },
  { login: "qsxcv", total: 6, avatar: "https://github.com/qsxcv.png" },
  { login: "weltern", total: 5, avatar: "https://github.com/weltern.png" },
  { login: "ydw1904", total: 5, avatar: "https://github.com/ydw1904.png" },
  { login: "nguyenan1601", total: 2, avatar: "https://github.com/nguyenan1601.png" },
  { login: "NotLokry", total: 1, avatar: "https://github.com/NotLokry.png" },
  { login: "FormunaGit", total: 1, avatar: "https://github.com/FormunaGit.png" },
];

function defaultData(): CachedData {
  return {
    fetchedAt: 0,
    branches: [],
    pulls: [],
    repoList: [],
    merged: DEFAULT_CONTRIBUTORS.map((c) => ({
      login: c.login,
      avatar: c.avatar || null,
      htmlUrl: c.avatar ? `https://github.com/${c.login}` : null,
      total: c.total,
      repos: {},
      prs: {},
    })),
  };
}

function readCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedData;
    if (!Array.isArray(parsed.branches) || parsed.branches.length === 0 || !Array.isArray(parsed.repoList) || !Array.isArray(parsed.pulls) || !Array.isArray(parsed.merged)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: CachedData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}

function repoKeyOf(name: string): RepoKey {
  return name.toLowerCase();
}

function repoLabelOf(name: string): string {
  if (repoKeyOf(name) === "openmouse") return "OpenMouse";
  return name
    .split("-")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

async function githubJson<T>(path: string): Promise<{ data: T; link: string | null }> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as T;
  return { data, link: res.headers.get("link") };
}

function lastPageNumber(link: string | null): number {
  if (!link) return 1;
  const match = /page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match ? Math.min(Number(match[1]), MAX_PAGES) : 1;
}

interface ApiCommit {
  author: { login: string; avatar_url: string; html_url: string } | null;
  commit: { author: { name: string } };
}

async function fetchBranch(repo: string, branch: string, key: RepoKey, label: string): Promise<BranchData> {
  const pages: ApiCommit[][] = [];
  const path = `/repos/${repo}/commits?sha=${branch}`;
  const first = await githubJson<ApiCommit[]>(`${path}&per_page=${PER_PAGE}&page=1`);
  pages.push(first.data);
  const last = lastPageNumber(first.link);
  for (let page = 2; page <= last; page += 1) {
    const { data } = await githubJson<ApiCommit[]>(`${path}&per_page=${PER_PAGE}&page=${page}`);
    pages.push(data);
    if (data.length < PER_PAGE) break;
  }

  const authors = new Map<string, { login: string; avatar: string | null; htmlUrl: string | null; count: number }>();
  let commits = 0;
  for (const commit of pages.flat()) {
    commits += 1;
    const login = commit.author?.login;
    const fallback = commit.author ? null : commit.commit.author.name;
    const name = login ?? fallback ?? "Unknown";
    if (name.endsWith("[bot]") || name === "Unknown") continue;
    const entry = authors.get(name) ?? {
      login: name,
      avatar: commit.author?.avatar_url ?? null,
      htmlUrl: commit.author?.html_url ?? null,
      count: 0,
    };
    if (!entry.avatar) entry.avatar = commit.author?.avatar_url ?? null;
    if (!entry.htmlUrl) entry.htmlUrl = commit.author?.html_url ?? null;
    entry.count += 1;
    authors.set(name, entry);
  }

  return {
    key,
    repo,
    branch,
    label,
    commits,
    authors: [...authors.values()].sort((a, b) => b.count - a.count),
  };
}

interface ApiPull {
  merged_at: string | null;
  user: { login: string; avatar_url: string; html_url: string; type: string } | null;
}

async function fetchPulls(repo: RepoInfo): Promise<RepoPulls> {
  const pages: ApiPull[][] = [];
  const path = `/repos/${repo.fullName}/pulls?state=closed&sort=updated&direction=desc`;
  const first = await githubJson<ApiPull[]>(`${path}&per_page=${PER_PAGE}&page=1`);
  pages.push(first.data);
  const last = lastPageNumber(first.link);
  for (let page = 2; page <= last; page += 1) {
    const { data } = await githubJson<ApiPull[]>(`${path}&per_page=${PER_PAGE}&page=${page}`);
    pages.push(data);
    if (data.length < PER_PAGE) break;
  }

  const authors = new Map<string, { login: string; avatar: string | null; htmlUrl: string | null; prs: number }>();
  let mergedPrs = 0;
  for (const pull of pages.flat()) {
    if (!pull.merged_at) continue;
    mergedPrs += 1;
    const user = pull.user;
    // PRs that don't show up on GitHub's contributors graph (squash/rebase
    // merges, unlinked emails, rewritten history) still count here.
    if (!user || user.type === "Bot" || /\[bot\]$/.test(user.login)) continue;
    const entry = authors.get(user.login) ?? {
      login: user.login,
      avatar: user.avatar_url,
      htmlUrl: user.html_url,
      prs: 0,
    };
    entry.prs += 1;
    authors.set(user.login, entry);
  }

  return {
    key: repo.key,
    repo: repo.fullName,
    prs: mergedPrs,
    authors: [...authors.values()].sort((a, b) => b.prs - a.prs),
  };
}

interface ApiOrgRepo {
  name: string;
  full_name: string;
  default_branch: string;
  fork: boolean;
  archived: boolean;
}

async function fetchOrgRepos(): Promise<ApiOrgRepo[]> {
  const { data } = await githubJson<ApiOrgRepo[]>(`/orgs/${ORG}/repos?per_page=100&sort=full_name`);
  return data.filter((repo) => !repo.fork && !repo.archived);
}

function branchSources(repos: ApiOrgRepo[]): { key: RepoKey; repo: string; branch: string; label: string }[] {
  const sources: { key: RepoKey; repo: string; branch: string; label: string }[] = [];
  for (const repo of repos) {
    sources.push({
      key: repoKeyOf(repo.name),
      repo: repo.full_name,
      branch: repo.default_branch,
      label: repo.default_branch,
    });
    if (repoKeyOf(repo.name) === "openmouse" && repo.default_branch !== "dev") {
      sources.push({ key: repoKeyOf(repo.name), repo: repo.full_name, branch: "dev", label: "dev" });
    }
  }
  return sources;
}

function contributionsOf(person: MergedContributor): number {
  let prs = 0;
  for (const count of Object.values(person.prs)) prs += count ?? 0;
  return person.total + prs;
}

function mergeContributors(branches: BranchData[], pulls: RepoPulls[]): MergedContributor[] {
  const merged = new Map<string, MergedContributor>();
  const upsert = (login: string, avatar: string | null, htmlUrl: string | null): MergedContributor => {
    const entry = merged.get(login) ?? {
      login,
      avatar,
      htmlUrl,
      total: 0,
      repos: {},
      prs: {},
    };
    if (!entry.avatar) entry.avatar = avatar;
    if (!entry.htmlUrl) entry.htmlUrl = htmlUrl;
    merged.set(login, entry);
    return entry;
  };

  for (const branch of branches) {
    for (const author of branch.authors) {
      const entry = upsert(author.login, author.avatar, author.htmlUrl);
      const previous = entry.repos[branch.key] ?? 0;
      entry.repos[branch.key] = Math.max(previous, author.count);
    }
  }

  for (const repoPulls of pulls) {
    for (const author of repoPulls.authors) {
      const entry = upsert(author.login, author.avatar, author.htmlUrl);
      entry.prs[repoPulls.key] = (entry.prs[repoPulls.key] ?? 0) + author.prs;
    }
  }

  for (const entry of merged.values()) {
    let total = 0;
    for (const count of Object.values(entry.repos)) total += count ?? 0;
    entry.total = total;
  }

  return [...merged.values()].sort((a, b) => contributionsOf(b) - contributionsOf(a));
}

async function loadData(): Promise<{ data: CachedData }> {
  const orgRepos = await fetchOrgRepos();
  const repoList: RepoInfo[] = orgRepos.map((repo) => ({
    key: repoKeyOf(repo.name),
    label: repoLabelOf(repo.name),
    fullName: repo.full_name,
  }));

  const branches: BranchData[] = [];
  for (const source of branchSources(orgRepos)) {
    branches.push(await fetchBranch(source.repo, source.branch, source.key, source.label));
  }

  const pulls: RepoPulls[] = [];
  for (const info of repoList) {
    pulls.push(await fetchPulls(info));
  }

  const data: CachedData = {
    fetchedAt: Date.now(),
    branches,
    pulls,
    repoList,
    merged: mergeContributors(branches, pulls),
  };
  writeCache(data);
  return { data };
}

const AMOUNTS = [5, 10, 25, 50, 100];

type DonationType = "once" | "monthly";

function GitHubIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function DiscordIcon(): ReactNode {
  return (
    <svg viewBox="0 0 126.644 96" aria-hidden="true">
      <path fill="currentColor" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-11.4159,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z" />
    </svg>
  );
}

function StarIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

function XIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function CheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function LockIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M8 1a2.75 2.75 0 0 0-2.75 2.75V6h-.5A1.75 1.75 0 0 0 3 7.75v5.5C3 14.21 3.79 15 4.75 15h6.5c.96 0 1.75-.79 1.75-1.75v-5.5C13 6.79 12.21 6 11.25 6h-.5V3.75A2.75 2.75 0 0 0 8 1Zm1.5 6.5v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 1.5 0Zm-4-1h5V3.75a1.25 1.25 0 0 0-2.5 0V6a1 1 0 0 0 0-.25.25.25 0 0 0 .25-.25V3.75a1.25 1.25 0 0 0-2.5 0V5.5a.25.25 0 0 0 .25.25.25.25 0 0 0 0 .25v.5ZM6.25 6V3.75a.75.75 0 0 1 1.5 0V6h-1.5Z" />
    </svg>
  );
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatContributions(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatStars(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function DonateApp(): ReactNode {
  const [type, setType] = useState<DonationType>("once");
  const [amount, setAmount] = useState<number>(10);
  const [custom, setCustom] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [data, setData] = useState<CachedData>(() => readCache() ?? defaultData());
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [stars, setStars] = useState<number | null>(1473);
  const loadingRef = useRef(false);
  const dataRef = useRef<CachedData>(data);
  dataRef.current = data;

  const refresh = async (): Promise<void> => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data: fresh } = await loadData();
      setData(fresh);
      setError(null);
      setStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (dataRef.current) setStale(true);
    } finally {
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    if (dataRef.current.fetchedAt === 0) void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    void fetch(`${GITHUB_API}/repos/OpenMouse-Project/openmouse`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((repo) => {
        if (repo && typeof repo.stargazers_count === "number") setStars(repo.stargazers_count);
      })
      .catch(() => {});
    return () => {
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customValue = Number(custom);
  const effectiveAmount = custom.trim() !== "" && Number.isFinite(customValue) && customValue > 0 ? customValue : amount;

  const handleDonate = (): void => {
    setConfirmed(true);
    window.setTimeout(() => setConfirmed(false), 3200);
  };

  return (
    <div className="don-shell">
      <div className="don-bg" aria-hidden="true" />

      <header className="don-header">
        <a className="don-wordmark" href="/" aria-label="OpenMouse home">
          <img className="don-logo" src="/logo.png" alt="" width={181} height={268} />
          OpenMouse
        </a>
        <nav className="don-nav" aria-label="Sections">
          <a href="/supported.html">Devices</a>
          <a href="/donate.html" aria-current="page" className="is-current">Support</a>
          <a href="/check.html">Mouse Check</a>
          <a href="/contribute.html">Contribute</a>
        </nav>
        <div className="don-actions">
          <a className="don-github" href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">
            <GitHubIcon />
            <span className="don-github-label">GitHub</span>
            {stars !== null ? (
              <span className="don-stars" aria-label={`${formatStars(stars)} stars`}>
                <StarIcon />
                {formatStars(stars)}
              </span>
            ) : null}
          </a>
        </div>
      </header>

      <main>
        <section className="don-hero">
          <h1>Support this <em>project</em></h1>
          <p className="don-lead">
            OpenMouse is free, open source, and built for the community. If it makes your setup better,
            or saves you from closed-source bloat, consider supporting the work behind it.
          </p>
        </section>

        <section className="don-grid" aria-label="Support options">
          <article className="don-card don-profile-card">
            <span className="don-avatar-wrap">
              <img className="don-avatar" src="/logo.png" alt="" width={72} height={72} />
            </span>
            <div className="don-profile-body">
              <h2>The OpenMouse Project</h2>
              <p className="don-role">Maintainers &amp; contributors</p>
              <p>
                Hi! We're the developers behind OpenMouse — a free, open source mouse configurator. We invest a
                significant amount of time into tuning new mice, writing wireless and wired drivers, and keeping
                the project free of vendor bloat.
              </p>
              <p>
                We appreciate the support from the community and our contributors. Sponsorship helps us cover
                hardware, testing, and infrastructure, and lets us keep improving OpenMouse. Any donation is
                greatly appreciated!
              </p>
              <p>Thank you for reading!</p>
              <p className="don-optional">Donation is optional.</p>
            </div>
          </article>

          <article className="don-card don-form-card">
            <div className="don-field">
              <span className="don-label">Donation Type</span>
              <div className="don-seg" role="tablist" aria-label="Donation type">
                <button
                  type="button"
                  role="tab"
                  aria-selected={type === "once"}
                  className={`don-seg-btn${type === "once" ? " is-on" : ""}`}
                  onClick={() => setType("once")}
                >
                  One-time
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={type === "monthly"}
                  className={`don-seg-btn${type === "monthly" ? " is-on" : ""}`}
                  onClick={() => setType("monthly")}
                >
                  Monthly
                </button>
              </div>
            </div>

            <div className="don-field">
              <span className="don-label">Donation Amount (USD)</span>
              <div className="don-amounts">
                {AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    className={`don-amount${amount === amt && custom.trim() === "" ? " is-on" : ""}`}
                    aria-pressed={amount === amt && custom.trim() === ""}
                    onClick={() => { setAmount(amt); setCustom(""); }}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            <div className="don-field">
              <span className="don-label">Custom amount</span>
              <div className="don-custom">
                <span className="don-currency">$</span>
                <input
                  type="number"
                  min="1"
                  placeholder="Enter an amount"
                  value={custom}
                  onInput={(event) => setCustom((event.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <p className="don-charge">
              {type === "once"
                ? `This will be charged once as ${formatCurrency(effectiveAmount)}.`
                : `You will be charged ${formatCurrency(effectiveAmount)} every month.`}
            </p>

            <button type="button" className="don-submit" onClick={handleDonate}>
              <LockIcon />
              Donate
            </button>

            {confirmed ? (
              <p className="don-toast" role="status">
                <CheckIcon /> Thanks! This is a preview — payment isn’t wired up yet.
              </p>
            ) : null}

            <a className="don-skip" href="/">No thanks, continue to the app</a>
          </article>
        </section>

        <section className="don-contributors" aria-label="Our contributors">
          <div className="don-contrib-head">
            <span className="don-eyebrow">WITH LOVE FROM</span>
            <h2>Our Contributors</h2>
          </div>
          {error ? (
            <p className="don-error" role="alert">
              {stale ? "Showing saved data — " : ""}Could not reach GitHub ({error}). Retrying automatically.
            </p>
          ) : null}
          <div className="don-contrib-avatars">
            {data.merged.map((c) => {
              const count = c.total;
              return (
                <a
                  key={c.login}
                  href={c.htmlUrl ?? `https://github.com/${c.login}`}
                  target="_blank"
                  rel="noreferrer"
                  className="don-contrib-avatar"
                  title={`${c.login} · ${formatContributions(count)} contribution${count === 1 ? "" : "s"}`}
                >
                  {c.avatar ? (
                    <img src={`${c.avatar}?s=64`} alt={c.login} loading="lazy" width={64} height={64} />
                  ) : (
                    <span className="don-avatar-fallback" aria-hidden="true">
                      {c.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
          <a className="don-contrib-link" href="https://github.com/OpenMouse-Project" target="_blank" rel="noreferrer">
            See everyone on GitHub ↗
          </a>
        </section>
      </main>

      <footer className="don-footer">
        <div className="don-footer-grid">
          <div className="don-fbrand">
            <a className="don-fwordmark" href="/">OpenMouse Project</a>
            <p className="don-ftagline">The open source, cross-platform mouse configurator.</p>
          </div>

          <div className="don-fcol">
            <h3>Pages</h3>
            <a href="/">Home</a>
            <a href="/supported.html">Devices</a>
            <a href="/check.html">Mouse Check</a>
            <a href="/contribute.html">Contribute</a>
          </div>

          <div className="don-fcol">
            <h3>Contribute</h3>
            <a href="https://github.com/OpenMouse-Project" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://github.com/OpenMouse-Project/openmouse/issues" target="_blank" rel="noreferrer">Report issue</a>
            <a href="https://github.com/OpenMouse-Project/openmouse/discussions" target="_blank" rel="noreferrer">Discussions</a>
            <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">Source code</a>
          </div>

          <div className="don-fcol">
            <h3>Community</h3>
            <div className="don-fsocial">
              <a href="https://github.com/OpenMouse-Project" target="_blank" rel="noreferrer" aria-label="GitHub">
                <GitHubIcon />
              </a>
              <a href="https://discord.gg/yxC9jzMdw6" target="_blank" rel="noreferrer" aria-label="Discord">
                <DiscordIcon />
              </a>
              <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer" aria-label="X / Twitter">
                <XIcon />
              </a>
            </div>
          </div>
        </div>

        <div className="don-footer-bottom">
          <p>
            © {new Date().getFullYear()} OpenMouse Project. All rights reserved.
            <a href="/" className="don-flegal">Privacy Policy</a>
            <a href="/" className="don-flegal">Terms of Service</a>
          </p>
          <p>Created with ❤️ by <a href="https://github.com/OpenMouse-Project" target="_blank" rel="noreferrer">the community</a> and <a href="/donate.html">contributors</a>.</p>
        </div>
      </footer>
    </div>
  );
}

const root = document.querySelector<HTMLDivElement>("#donate-app");
if (!root) throw new Error("donate-app root not found");
createRoot(root).render(<DonateApp />);
