// "Request a game or app" — the Games page's counterpart to
// ArtworkRequestDialog. Collects what Bridge's detector needs to add an entry
// to Desktop's `games.json` (a name plus the executable it watches for) — a
// game, or a regular app like Premiere Pro that deserves its own profile —
// and who to ask about it, then shows the exact Discord embed before anything
// is sent.
// It rides the same `/api/feedback` relay as feedback: a plain JSON embed,
// no attachment, so there is nothing to screen server-side.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Gamepad2 } from "lucide-react";
import * as control from "../device/controller";
import { bridgeApplicationIconUrl, bridgeRunningApplications, type BridgeApplication, type BridgeGame } from "../bridge";
import { t, tp, type I18nKey } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";

const REQUEST_URL = "/api/feedback";
const MAX_NAME_LENGTH = 80;
const MAX_PATH_LENGTH = 400;
const COOLDOWN_KEY = "openmouse.gamereq.sentAt";
const COOLDOWN_MS = 60_000;
// Discord's current username rules: 2–32 of lowercase letters, digits, `_` and `.`.
const DISCORD_USERNAME = /^[a-z0-9_.]{2,32}$/;

type Platform = "windows" | "macos" | "linux";
type RequestKind = "game" | "app";

const KIND_TITLES: Record<RequestKind, string> = { game: "Game Request", app: "App Request" };

// Each command prints the path of the running game or app's executable.
// macOS asks for the frontmost window directly, so it waits a few seconds for
// the user to switch to it first.
const COMMANDS: Record<Platform, { shell: string; command: string; hint: I18nKey }> = {
  windows: {
    shell: "PowerShell",
    command: "Get-Process | Where-Object MainWindowTitle | Select-Object MainWindowTitle, Path | Format-List",
    hint: "gamereq.cmdWindowsHint",
  },
  macos: {
    shell: "Terminal",
    command: "sleep 5; ps -o comm= -p $(osascript -e 'tell application \"System Events\" to unix id of first process whose frontmost is true')",
    hint: "gamereq.cmdMacHint",
  },
  linux: {
    shell: "Terminal",
    command: "ps -eo args= | grep -iE '\\.exe|steamapps' | grep -v grep | sort -u",
    hint: "gamereq.cmdLinuxHint",
  },
};

const PATH_EXAMPLES: Record<RequestKind, Record<Platform, string>> = {
  game: {
    windows: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Game\\game.exe",
    macos: "/Applications/Game.app/Contents/MacOS/Game",
    linux: "/home/you/.steam/steam/steamapps/common/Game/game",
  },
  app: {
    windows: "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe",
    macos: "/Applications/Adobe Premiere Pro 2026/Adobe Premiere Pro 2026.app/Contents/MacOS/Adobe Premiere Pro 2026",
    linux: "/usr/bin/blender",
  },
};

const PLATFORM_LABELS: Record<Platform, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

function detectPlatform(): Platform {
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform
    ?? "";
  if (/mac/i.test(hint)) return "macos";
  if (/linux|x11|cros/i.test(hint)) return "linux";
  return "windows";
}

/** Strips the quotes Explorer's "Copy as path" and shell output wrap paths in. */
function cleanPath(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

/** The file name Bridge actually matches on (`cs2.exe`, `ghostty`). */
function executableName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** Keeps user text from breaking out of the inline-code span in the embed. */
function codeSpan(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function readSentAt(): number {
  try {
    return Number(window.localStorage.getItem(COOLDOWN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return [copied, (key, text) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(key)).catch(() => undefined);
  }];
}

/** Bridge only extracts icons on Windows; everywhere else the URL 404s. */
function AppIcon({ app }: { app: BridgeApplication }): ReactNode {
  const [failed, setFailed] = useState(false);
  if (failed) return <Gamepad2 size={18} strokeWidth={1.8} aria-hidden="true" />;
  return <img src={bridgeApplicationIconUrl(app)} alt="" onError={() => setFailed(true)} />;
}

export function GameRequestDialog({ open, onClose, locale = "en", bridgeActive, knownGames }: {
  open: boolean;
  onClose: () => void;
  locale?: InterfaceLocale;
  bridgeActive: boolean;
  knownGames: BridgeGame[];
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"form" | "preview">("form");
  const [kind, setKind] = useState<RequestKind>("game");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [discord, setDiscord] = useState("");
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [apps, setApps] = useState<BridgeApplication[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [copied, copy] = useCopied();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (typeof element.close === "function") {
      if (element.open) element.close();
    } else {
      element.removeAttribute("open");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setError(false);
    setApps(null);
    const remaining = COOLDOWN_MS - (Date.now() - readSentAt());
    setCooldown(remaining > 0 ? remaining : 0);
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(0), cooldown);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const trimmedName = name.trim().slice(0, MAX_NAME_LENGTH);
  const cleanedPath = cleanPath(path).slice(0, MAX_PATH_LENGTH);
  const exe = executableName(cleanedPath);
  const handle = discord.trim().replace(/^@/, "").toLowerCase();
  const handleValid = DISCORD_USERNAME.test(handle);
  const canPreview = trimmedName.length > 0 && exe.length > 0 && handleValid;

  const alreadySupported = knownGames.find((game) =>
    game.name.toLowerCase() === trimmedName.toLowerCase()
    || (exe && game.executables.some((known) => known.toLowerCase() === exe.toLowerCase())),
  );

  async function loadRunningApps(): Promise<void> {
    try {
      const list = await bridgeRunningApplications();
      // The window in front is most likely the one being requested.
      setApps(list
        .filter((app) => app.path)
        .sort((a, b) => Number(b.foreground) - Number(a.foreground) || a.name.localeCompare(b.name)));
    } catch {
      setApps([]);
    }
  }

  function pickApp(app: BridgeApplication): void {
    setPath(app.path);
    if (!name.trim()) setName(app.name);
    setApps(null);
  }

  async function send(): Promise<void> {
    if (!canPreview || busy || cooldown > 0) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(REQUEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowed_mentions: { parse: [] },
          embeds: [{
            title: KIND_TITLES[kind],
            color: 0x5dde89,
            fields: [
              { name: kind === "game" ? "Game" : "App", value: `**${trimmedName}**`, inline: true },
              { name: "Executable", value: codeSpan(exe), inline: true },
              { name: "Platform", value: PLATFORM_LABELS[platform], inline: true },
              { name: "Path", value: codeSpan(cleanedPath), inline: false },
            ],
            footer: { text: `@${handle}` },
          }],
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      try {
        window.localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
      } catch {
        /* the cooldown is a courtesy; storage failures just skip it */
      }
      control.pushToast("success", t(locale, "gamereq.sent"), tp(locale, "gamereq.sentDetail", { name: trimmedName }));
      setName("");
      setPath("");
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const command = COMMANDS[platform];

  return (
    <dialog
      ref={dialog}
      className="support-dialog feedback-dialog gamereq-dialog"
      aria-labelledby="gamereq-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <form
        className="support-dialog-inner feedback-dialog-inner"
        onSubmit={(event) => {
          event.preventDefault();
          if (step === "form") {
            if (canPreview) setStep("preview");
          } else {
            void send();
          }
        }}
      >
        <header>
          <div>
            <p className="overline">OpenMouse</p>
            <h2 id="gamereq-dialog-title">
              {t(locale, step === "form" ? "gamereq.title" : "gamereq.previewTitle")}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>

        {step === "form" ? (
          <>
            <p className="feedback-description">{t(locale, "gamereq.description")}</p>

            <div className="gamereq-kind" role="radiogroup" aria-label={t(locale, "gamereq.kindLabel")}>
              {(["game", "app"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={kind === key}
                  className={kind === key ? "is-active" : ""}
                  onClick={() => setKind(key)}
                >
                  {t(locale, key === "game" ? "gamereq.kindGame" : "gamereq.kindApp")}
                </button>
              ))}
            </div>

            <label className="feedback-handle" htmlFor="gamereq-name">
              <span>{t(locale, "gamereq.nameLabel")}</span>
              <input
                id="gamereq-name"
                type="text"
                required
                maxLength={MAX_NAME_LENGTH}
                placeholder={t(locale, kind === "game" ? "gamereq.namePlaceholder" : "gamereq.appNamePlaceholder")}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>

            <div className="gamereq-exe">
              <label className="feedback-handle" htmlFor="gamereq-path">
                <span>{t(locale, "gamereq.pathLabel")}</span>
                <input
                  id="gamereq-path"
                  type="text"
                  required
                  spellcheck={false}
                  maxLength={MAX_PATH_LENGTH + 2}
                  className="gamereq-mono"
                  placeholder={PATH_EXAMPLES[kind][platform]}
                  value={path}
                  onChange={(event) => setPath(event.currentTarget.value)}
                />
              </label>

              <div className="gamereq-finder">
                <p className="gamereq-finder-title">{t(locale, "gamereq.findTitle")}</p>

                {bridgeActive ? (
                  <div className="gamereq-running">
                    <button type="button" className="gamereq-chip" onClick={() => { void loadRunningApps(); }}>
                      {t(locale, "gamereq.pickRunning")}
                    </button>
                    {apps !== null ? (
                      apps.length === 0 ? (
                        <p className="artreq-hint">{t(locale, "gamereq.noRunning")}</p>
                      ) : (
                        <ul className="gamereq-apps">
                          {apps.map((app) => (
                            <li key={app.path}>
                              <button type="button" onClick={() => pickApp(app)}>
                                <AppIcon app={app} />
                                <span>
                                  <strong>{app.name}</strong>
                                  <small className="gamereq-mono">{app.path}</small>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}
                  </div>
                ) : null}

                <div className="gamereq-os" role="tablist" aria-label={t(locale, "gamereq.findTitle")}>
                  {(Object.keys(COMMANDS) as Platform[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={platform === key}
                      className={platform === key ? "is-active" : ""}
                      onClick={() => setPlatform(key)}
                    >
                      {PLATFORM_LABELS[key]}
                    </button>
                  ))}
                </div>
                <p className="artreq-hint">{tp(locale, command.hint, { shell: command.shell })}</p>
                <div className="gamereq-command">
                  <code className="gamereq-mono">{command.command}</code>
                  <button
                    type="button"
                    aria-label={t(locale, "gamereq.copy")}
                    title={t(locale, "gamereq.copy")}
                    onClick={() => copy(platform, command.command)}
                  >
                    {copied === platform ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  </button>
                </div>
                {platform === "windows" ? (
                  <p className="artreq-hint">{t(locale, "gamereq.explorerTip")}</p>
                ) : null}
              </div>
            </div>

            <label className="feedback-handle" htmlFor="gamereq-discord">
              <span>{t(locale, "gamereq.discordLabel")}</span>
              <input
                id="gamereq-discord"
                type="text"
                required
                maxLength={33}
                autoComplete="off"
                spellcheck={false}
                placeholder={t(locale, "fb.handlePlaceholder")}
                value={discord}
                onChange={(event) => setDiscord(event.currentTarget.value)}
              />
            </label>
            {handle && !handleValid ? (
              <p className="feedback-error" role="alert">{t(locale, "gamereq.discordInvalid")}</p>
            ) : null}

            <div className="feedback-actions">
              <button type="button" onClick={onClose}>{t(locale, "common.cancel")}</button>
              <button type="submit" className="is-primary" disabled={!canPreview}>
                {t(locale, "gamereq.preview")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="feedback-description">{t(locale, "gamereq.previewDescription")}</p>

            <div className="gamereq-embed">
              <p className="gamereq-embed-title">{KIND_TITLES[kind]}</p>
              <div className="gamereq-embed-fields">
                <div>
                  <span>{kind === "game" ? "Game" : "App"}</span>
                  <strong>{trimmedName}</strong>
                </div>
                <div>
                  <span>Executable</span>
                  <code className="gamereq-mono">{exe}</code>
                </div>
                <div>
                  <span>Platform</span>
                  <p>{PLATFORM_LABELS[platform]}</p>
                </div>
                <div className="is-wide">
                  <span>Path</span>
                  <code className="gamereq-mono">{cleanedPath}</code>
                </div>
              </div>
              <p className="gamereq-embed-footer">
                <Gamepad2 size={13} aria-hidden="true" /> @{handle}
              </p>
            </div>

            {alreadySupported ? (
              <p className="gamereq-notice" role="status">
                {tp(locale, "gamereq.alreadySupported", { name: alreadySupported.name })}
              </p>
            ) : null}

            {error ? (
              <p className="feedback-error" role="alert">
                {t(locale, "gamereq.error")} {t(locale, "artreq.errorDetail")}
              </p>
            ) : cooldown > 0 ? (
              <p className="feedback-error" role="status">
                {tp(locale, "fb.cooldown", { seconds: Math.ceil(cooldown / 1000) })}
              </p>
            ) : null}

            <div className="feedback-actions">
              <button type="button" onClick={() => setStep("form")} disabled={busy}>
                {t(locale, "gamereq.edit")}
              </button>
              <button type="submit" className="is-primary" disabled={busy || cooldown > 0}>
                {busy ? "…" : t(locale, "gamereq.send")}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
