import "./styles.css";
import { renderLandingPage } from "./landing-page";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("OpenMouse could not find its application root.");
}

app.innerHTML = renderLandingPage();

type Browser = {
  id: "chrome" | "edge" | "firefox" | "safari" | "other";
  name: string;
};

function currentBrowser(userAgent: string): Browser {
  if (/\bEdg\//.test(userAgent)) return { id: "edge", name: "Edge" };
  if (/\bFirefox\//.test(userAgent)) return { id: "firefox", name: "Firefox" };
  if (/\bChrome\//.test(userAgent) && !/\b(?:OPR|Edg)\//.test(userAgent)) {
    return { id: "chrome", name: "Chrome" };
  }
  if (/\bSafari\//.test(userAgent) && !/\b(?:Chrome|Chromium|CriOS|FxiOS|EdgiOS)\//.test(userAgent)) {
    return { id: "safari", name: "Safari" };
  }

  return { id: "other", name: "Your browser" };
}

function updateBrowserSupport(): void {
  const browser = currentBrowser(navigator.userAgent);
  const supportsWebHid = "hid" in navigator;
  const currentBrowserBadge = document.querySelector<HTMLElement>(
    `.compatibility [data-browser="${browser.id}"]`,
  );

  currentBrowserBadge?.classList.add("current");
  currentBrowserBadge?.setAttribute("aria-current", "true");
  currentBrowserBadge?.setAttribute(
    "aria-label",
    `${browser.name}, your current browser, ${supportsWebHid ? "compatible with OpenMouse" : "not compatible with OpenMouse"}`,
  );
}

updateBrowserSupport();

const githubStars = document.querySelector<HTMLSpanElement>("#github-stars");

async function updateGithubStars(): Promise<void> {
  if (!githubStars) return;

  try {
    const response = await fetch("https://api.github.com/repos/snekxs/openmouse", {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) return;

    const repository = await response.json() as { stargazers_count?: number };

    if (typeof repository.stargazers_count === "number") {
      githubStars.textContent = `★ ${new Intl.NumberFormat().format(repository.stargazers_count)}`;
      githubStars.hidden = false;
    }
  } catch {
    // The GitHub link remains available when its public API cannot be reached.
  }
}

void updateGithubStars();

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const revealTargets = document.querySelectorAll<HTMLElement>(
  ".principles, .section-block, .discord-community",
);

if ("IntersectionObserver" in window && !reducedMotion.matches) {
  revealTargets.forEach((target) => target.classList.add("reveal"));

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 },
  );

  revealTargets.forEach((target) => revealObserver.observe(target));
}
