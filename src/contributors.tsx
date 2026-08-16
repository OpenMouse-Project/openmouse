import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./contributors.css";

const ORG = "OpenMouse-Project";

type RepoKey = string;

interface RepoInfo {
  key: RepoKey;
  label: string;
  fullName: string;
}

interface BranchSource {
  key: RepoKey;
  repo: string;
  branch: string;
  label: string;
}

interface RepoMeta {
  description: string;
  stars: number;
  forks: number;
  issues: number;
  htmlUrl: string;
}

interface BranchAuthor {
  login: string;
  avatar: string | null;
  htmlUrl: string | null;
  count: number;
}

interface BranchData {
  key: RepoKey;
  repo: string;
  branch: string;
  label: string;
  commits: number;
  authors: BranchAuthor[];
}

interface MergedContributor {
  login: string;
  avatar: string | null;
  htmlUrl: string | null;
  total: number;
  repos: Partial<Record<RepoKey, number>>;
}

interface CachedData {
  fetchedAt: number;
  branches: BranchData[];
  repos: Partial<Record<RepoKey, RepoMeta>>;
  repoList: RepoInfo[];
  merged: MergedContributor[];
}

const CACHE_KEY = "openmouse-hall-of-fame-v3";
const REFRESH_MS = 15 * 60 * 1000;
const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 40;

function readCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedData;
    if (!Array.isArray(parsed.branches) || parsed.branches.length === 0 || !Array.isArray(parsed.repoList) || !parsed.merged) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: CachedData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* storage unavailable */ }
}

function avatarWithSize(avatar: string | null, size = 200): string | null {
  if (!avatar) return null;
  return avatar.includes("?") ? `${avatar}&s=${size}` : `${avatar}?s=${size}`;
}

interface ApiCommit {
  author: { login: string; avatar_url: string; html_url: string } | null;
  commit: { author: { name: string } };
}

async function githubJson<T>(path: string): Promise<{ data: T; remaining: number | null; link: string | null }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as T;
  return {
    data,
    remaining: Number.isFinite(remaining) ? remaining : null,
    link: res.headers.get("link"),
  };
}

function lastPageNumber(link: string | null): number {
  if (!link) return 1;
  const match = /page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match ? Math.min(Number(match[1]), MAX_PAGES) : 1;
}

async function fetchBranch(source: BranchSource): Promise<BranchData> {
  const pages: ApiCommit[][] = [];
  const first = await githubJson<ApiCommit[]>(
    `/repos/${source.repo}/commits?sha=${source.branch}&per_page=${PER_PAGE}&page=1`,
  );
  pages.push(first.data);
  const last = lastPageNumber(first.link);
  for (let page = 2; page <= last; page += 1) {
    const { data } = await githubJson<ApiCommit[]>(
      `/repos/${source.repo}/commits?sha=${source.branch}&per_page=${PER_PAGE}&page=${page}`,
    );
    pages.push(data);
    if (data.length < PER_PAGE) break;
  }

  const authors = new Map<string, BranchAuthor>();
  let commits = 0;
  for (const commit of pages.flat()) {
    commits += 1;
    const login = commit.author?.login;
    const fallback = commit.author ? null : (commit.commit.author.name ?? "Unknown");
    const name = login ?? fallback ?? "Unknown";
    if (name.endsWith("[bot]") || name === "Unknown") continue;
    const entry = authors.get(name) ?? {
      login: name,
      avatar: avatarWithSize(commit.author?.avatar_url ?? null),
      htmlUrl: commit.author?.html_url ?? null,
      count: 0,
    };
    if (!entry.avatar) entry.avatar = avatarWithSize(commit.author?.avatar_url ?? null);
    if (!entry.htmlUrl) entry.htmlUrl = commit.author?.html_url ?? null;
    entry.count += 1;
    authors.set(name, entry);
  }

  return {
    key: source.key,
    repo: source.repo,
    branch: source.branch,
    label: source.label,
    commits,
    authors: [...authors.values()].sort((a, b) => b.count - a.count),
  };
}

interface ApiOrgRepo {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  html_url: string;
  fork: boolean;
  archived: boolean;
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

async function fetchOrgRepos(): Promise<ApiOrgRepo[]> {
  const { data } = await githubJson<ApiOrgRepo[]>(`/orgs/${ORG}/repos?per_page=100&sort=full_name`);
  return data.filter((repo) => !repo.fork && !repo.archived);
}

function branchSources(repos: ApiOrgRepo[]): BranchSource[] {
  const sources: BranchSource[] = [];
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

function repoMetaOf(repo: ApiOrgRepo): RepoMeta {
  return {
    description: repo.description ?? "",
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    issues: repo.open_issues_count,
    htmlUrl: repo.html_url,
  };
}

function mergeBranches(branches: BranchData[]): MergedContributor[] {
  const merged = new Map<string, MergedContributor>();
  for (const branch of branches) {
    for (const author of branch.authors) {
      const entry = merged.get(author.login) ?? {
        login: author.login,
        avatar: author.avatar,
        htmlUrl: author.htmlUrl,
        total: 0,
        repos: {},
      };
      if (!entry.avatar) entry.avatar = author.avatar;
      if (!entry.htmlUrl) entry.htmlUrl = author.htmlUrl;
      const previous = entry.repos[branch.key] ?? 0;
      entry.repos[branch.key] = Math.max(previous, author.count);
      merged.set(author.login, entry);
    }
  }
  for (const entry of merged.values()) {
    let total = 0;
    for (const count of Object.values(entry.repos)) total += count ?? 0;
    entry.total = total;
  }
  return [...merged.values()].sort((a, b) => b.total - a.total);
}

async function loadData(): Promise<{ data: CachedData; remaining: number | null; cached: boolean }> {
  const cached = Boolean(readCache());
  const orgRepos = await fetchOrgRepos();
  const repoList: RepoInfo[] = orgRepos.map((repo) => ({
    key: repoKeyOf(repo.name),
    label: repoLabelOf(repo.name),
    fullName: repo.full_name,
  }));
  const repos: Partial<Record<RepoKey, RepoMeta>> = {};
  for (const repo of orgRepos) repos[repoKeyOf(repo.name)] = repoMetaOf(repo);
  const branches: BranchData[] = [];
  for (const source of branchSources(orgRepos)) {
    branches.push(await fetchBranch(source));
  }
  const data: CachedData = {
    fetchedAt: Date.now(),
    branches,
    repos,
    repoList,
    merged: mergeBranches(branches),
  };
  writeCache(data);
  return { data, remaining: null, cached };
}

function useCountUp(target: number, active: boolean, duration = 1100): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return value;
}

function useInView<T extends HTMLElement>(): { ref: (node: T | null) => void; inView: boolean } {
  const [inView, setInView] = useState(false);
  const ref = (node: T | null): void => {
    if (!node || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
  };
  return { ref, inView };
}

type SortMode = "top" | "az";
type FilterMode = "all" | "both" | RepoKey;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(ms: number, nowMs = Date.now()): string {
  const seconds = Math.max(1, Math.round((nowMs - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function RepoCard({ repoKey, label, meta, branches, index }: { repoKey: RepoKey; label: string; meta: RepoMeta; branches: BranchData[]; index: number }): ReactNode {
  const { ref, inView } = useInView<HTMLAnchorElement>();
  const contributors = new Set(branches.flatMap((b) => b.authors.map((a) => a.login))).size;
  return (
    <a
      ref={ref}
      href={meta.htmlUrl}
      target="_blank"
      rel="noreferrer"
      className={`repo-card hof-reveal${inView ? " is-in" : ""}`}
      style={{ "--d": `${index * 120}ms` } as CSSProperties}
    >
      <span className="repo-card-top">
        <span className="repo-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="15" height="15"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" /></svg>
        </span>
        <span className="repo-name">{label}</span>
        <span className="repo-arrow">↗</span>
      </span>
      <p className="repo-desc">{meta.description}</p>
      <span className="repo-stats">
        <span>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" /></svg>
          <strong>{formatNumber(meta.stars)}</strong>
        </span>
        <span>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" /></svg>
          <strong>{formatNumber(meta.forks)}</strong>
        </span>
        <span>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-.25-6.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0Z" /></svg>
          <strong>{formatNumber(meta.issues)}</strong>
        </span>
      </span>
      <span className="repo-branches">
        {branches.map((b) => (
          <span key={`${repoKey}-${b.branch}`} className="repo-branch">
            <i className="branch-dot" aria-hidden="true" />
            {b.label} · {b.commits} commits
          </span>
        ))}
      </span>
      <span className="repo-foot">
        <span><strong>{contributors}</strong> contributors</span>
        <span>view repo</span>
      </span>
    </a>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

function DotGrid(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--hof-accent").trim() || "#69d28d";
    const spacing = 32;
    const radius = 140;
    const maxDisplace = 24;
    const dots: { bx: number; by: number; x: number; y: number }[] = [];
    let width = 0;
    let height = 0;
    let mouseX = -10000;
    let mouseY = -10000;
    let raf = 0;

    const build = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots.length = 0;
      const cols = Math.ceil(width / spacing);
      const rows = Math.ceil(height / spacing);
      for (let row = 0; row <= rows; row += 1) {
        for (let col = 0; col <= cols; col += 1) {
          const bx = col * spacing;
          const by = row * spacing;
          dots.push({ bx, by, x: bx, y: by });
        }
      }
    };

    const draw = (): void => {
      ctx.clearRect(0, 0, width, height);
      for (const dot of dots) {
        const dx = mouseX - dot.x;
        const dy = mouseY - dot.y;
        const dist = Math.hypot(dx, dy);
        let tx = dot.bx;
        let ty = dot.by;
        if (dist < radius && dist > 0.001) {
          const pull = (1 - dist / radius) * maxDisplace;
          tx = dot.bx + (dx / dist) * pull;
          ty = dot.by + (dy / dist) * pull;
        }
        dot.x += (tx - dot.x) * 0.14;
        dot.y += (ty - dot.y) * 0.14;
        const near = dist < radius;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, near ? 2.4 : 1.4, 0, Math.PI * 2);
        ctx.fillStyle = near ? accent : "rgba(158, 170, 164, 0.32)";
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    const drawStatic = (): void => {
      ctx.clearRect(0, 0, width, height);
      for (const dot of dots) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(158, 170, 164, 0.32)";
        ctx.fill();
      }
    };

    const onMove = (event: MouseEvent): void => {
      mouseX = event.clientX;
      mouseY = event.clientY;
    };
    const onLeave = (): void => {
      mouseX = -10000;
      mouseY = -10000;
    };
    const onResize = (): void => {
      build();
      if (reduced) drawStatic();
    };

    build();
    if (reduced) {
      drawStatic();
    } else {
      window.addEventListener("mousemove", onMove, { passive: true });
      document.documentElement.addEventListener("mouseleave", onLeave);
      draw();
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="hof-dotgrid" aria-hidden="true" />;
}

function ContributorCard({ person, repoList, index }: { person: MergedContributor; repoList: RepoInfo[]; index: number }): ReactNode {
  const { ref, inView } = useInView<HTMLElement>();
  const ranked = index < 3;
  return (
    <article
      ref={ref}
      className={`contributor-card hof-reveal${inView ? " is-in" : ""}${ranked ? ` is-ranked rank-${index + 1}` : ""}`}
      style={{ "--d": `${Math.min(index * 45, 900)}ms` } as CSSProperties}
    >
      {ranked ? <span className="medal" aria-label={`Rank ${index + 1}`}>{MEDALS[index]}</span> : null}
      <span className="avatar-wrap">
        {person.avatar ? (
          <img src={person.avatar} alt="" width={96} height={96} loading="lazy" />
        ) : (
          <span className="avatar-fallback" aria-hidden="true">{person.login.slice(0, 1).toUpperCase()}</span>
        )}
        <span className="avatar-ring" aria-hidden="true" />
      </span>
      {person.htmlUrl ? (
        <a className="contributor-login" href={person.htmlUrl} target="_blank" rel="noreferrer">
          @{person.login}
        </a>
      ) : (
        <span className="contributor-login">{person.login}</span>
      )}
      <span className="contributor-total" aria-label={`${person.total} total contributions`}>
        {person.total} <em>commits</em>
      </span>
      <span className="contributor-repos">
        {repoList.map((repo) => {
          const count = person.repos[repo.key];
          if (!count) return null;
          return (
            <span key={repo.key} className={`repo-chip chip-${repo.key}`}>
              <i className="chip-dot" aria-hidden="true" />
              {repo.label} · {count}
            </span>
          );
        })}
      </span>
      {person.htmlUrl ? (
        <a className="contributor-link" href={person.htmlUrl} target="_blank" rel="noreferrer">
          profile <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <span className="contributor-link">profile</span>
      )}
    </article>
  );
}

function ContributorsApp(): ReactNode {
  const [data, setData] = useState<CachedData | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState<SortMode>("top");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const loadingRef = useRef(false);
  const dataRef = useRef<CachedData | null>(data);
  dataRef.current = data;

  const refresh = async (silent = false): Promise<void> => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!dataRef.current) void refresh(true);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, []);

  const { merged, repos, repoList } = data ?? { merged: [] as MergedContributor[], repos: null, repoList: [] as RepoInfo[] };
  const starCount = repos?.openmouse?.stars ?? null;
  const totalCommits = merged.reduce((s, c) => s + c.total, 0);
  const combinedStars = repoList.reduce((s, info) => s + (repos?.[info.key]?.stars ?? 0), 0);
  const committed = useCountUp(totalCommits, Boolean(data));
  const contributed = useCountUp(merged.length, Boolean(data));
  const starred = useCountUp(combinedStars, Boolean(data));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = merged;
    if (filter === "both") list = list.filter((c) => Object.keys(c.repos).length >= 2);
    else if (filter !== "all") list = list.filter((c) => c.repos[filter]);
    if (q) list = list.filter((c) => c.login.toLowerCase().includes(q));
    if (sort === "az") list = [...list].sort((a, b) => a.login.localeCompare(b.login));
    return list;
  }, [merged, filter, query, sort]);

  const gridReveal = useInView<HTMLDivElement>();
  const heroReveal = useInView<HTMLElement>();

  return (
    <div className="hof-shell">
      <div className="hof-bg" aria-hidden="true">
        <DotGrid />
      </div>

      <header className="hof-header">
        <a className="hof-wordmark" href="/" aria-label="OpenMouse home">
          <img className="hof-logo" src="/logo.png" alt="" width={181} height={268} />
          OpenMouse
        </a>
        <nav className="hof-nav" aria-label="Sections">
          <a href="/supported.html">Devices</a>
          <a href="/contributors.html" aria-current="page" className="is-current">Hall of Fame</a>
          <a href="/check.html">Mouse Check</a>
        </nav>
        <div className="hof-actions">
          <a className="hof-github" href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
            <span className="hof-github-label">GitHub</span>
            <span className="hof-stars" aria-label={`${starCount ?? 0} stars`}>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" /></svg>
              {starCount === null ? "–" : formatNumber(starCount)}
            </span>
          </a>
        </div>
      </header>

      <main>
        <section ref={heroReveal.ref} className={`hof-hero hof-reveal${heroReveal.inView ? " is-in" : ""}`}>
          <p className="hof-eyebrow">OPENMOUSE PROJECT · OPENSOURCE</p>
          <h1>Developer Hall<br />of <em>Fame</em></h1>
          <p className="hof-lead">
            Every developer who shaped the <strong>OpenMouse Project</strong> — combined into one live leaderboard.
          </p>

          <div className="hof-stats">
            <span className="hof-stat">
              <strong>{committed}</strong>
              <small>total commits</small>
            </span>
            <span className="hof-stat">
              <strong>{contributed}</strong>
              <small>contributors</small>
            </span>
            <span className="hof-stat">
              <strong>{starred}</strong>
              <small>combined ★</small>
            </span>
          </div>

          <div className="hof-live">
            <span className="live-dot" aria-hidden="true" />
            Live data
            {data ? <span className="live-time">· updated {timeAgo(data.fetchedAt, now)}</span> : null}
            <button
              className="hof-refresh"
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
              aria-label="Refresh contributor data"
            >
              <span className={`refresh-icon${loading ? " is-spinning" : ""}`} aria-hidden="true">↻</span>
              {loading ? "Fetching…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p className="hof-error" role="alert">
              {stale ? "Showing cached data — " : ""}Could not reach GitHub ({error}). Retrying automatically.
            </p>
          ) : null}
        </section>

        <section className="hof-repos" aria-label="Repository status">
          {repos ? repoList.map((info, index) => {
            const meta = repos[info.key];
            if (!meta) return null;
            return (
              <RepoCard
                key={info.key}
                repoKey={info.key}
                label={info.label}
                meta={meta}
                branches={(data?.branches ?? []).filter((b) => b.key === info.key)}
                index={index}
              />
            );
          }) : (
            <>
              <div className="skeleton repo-skeleton" />
              <div className="skeleton repo-skeleton" />
            </>
          )}
        </section>

        <section className="hof-controls" aria-label="Filter contributors">
          <input
            className="hof-search"
            type="search"
            placeholder="Search a username…"
            value={query}
            autocomplete="off"
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
          <div className="hof-filters" role="tablist" aria-label="Repository filter">
            {([
              { key: "all", label: "All" },
              ...repoList.map((info) => ({ key: info.key, label: info.label })),
              { key: "both", label: "Both" },
            ] as { key: FilterMode; label: string }[]).map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`hof-filter${filter === f.key ? " is-on" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            className="hof-sort"
            aria-label="Sort contributors"
            value={sort}
            onChange={(event) => setSort((event.target as HTMLSelectElement).value as SortMode)}
          >
            <option value="top">Most contributions</option>
            <option value="az">A–Z</option>
          </select>
        </section>

        <section className="hof-results" aria-label="Contributors">
          <div className="hof-result-head">
            <span>HALL OF FAME · {visible.length} DEVELOPER{visible.length === 1 ? "" : "S"}</span>
          </div>
          <div ref={gridReveal.ref} className={`hof-grid${gridReveal.inView ? " is-revealed" : ""}`}>
            {visible.length === 0 ? (
              <p className="hof-empty">No contributors match — try a different search or filter.</p>
            ) : (
              visible.map((person, index) => (
                <ContributorCard key={person.login} person={person} repoList={repoList} index={index} />
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="hof-footer">
        <span>OpenMouse · Hall of Fame — powered by the GitHub API, refreshed live.</span>
        <div className="hof-footer-links">
          <a href="https://x.com/openmouseapp" target="_blank" rel="noreferrer">Follow @openmouseapp on X ↗</a>
          <a href="https://github.com/OpenMouse-Project/openmouse" target="_blank" rel="noreferrer">View source on GitHub ↗</a>
        </div>
      </footer>
    </div>
  );
}

const root = document.querySelector<HTMLDivElement>("#contributors-app");
if (!root) throw new Error("contributors-app root not found");
createRoot(root).render(<ContributorsApp />);
