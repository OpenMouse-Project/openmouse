import type { BridgeGame, BridgeProfile, BridgeTargetMetadata, LocalApplication } from "../bridge/bridge";

export function targetActivation(target: BridgeTargetMetadata & { kind?: "game" | "app" }): "running" | "focused" {
  return target.activation ?? (target.kind === "app" ? "focused" : "running");
}

function targetMetadata(target: BridgeTargetMetadata): BridgeTargetMetadata {
  return {
    ...(target.activation !== undefined ? { activation: target.activation } : {}),
    ...(target.bundlePath !== undefined ? { bundlePath: target.bundlePath } : {}),
    ...(target.bundleIdentifier !== undefined ? { bundleIdentifier: target.bundleIdentifier } : {}),
  };
}

export function localGame(application: LocalApplication): BridgeGame {
  return { name: application.name, executables: [application.executable], id: application.id, source: "local", path: application.path, kind: application.kind, ...targetMetadata(application) };
}

export function parseLocalTarget(input: string): { executable: string; path: string } | null {
  let value = input.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  if (!value || [...value].length > 1024 || /[\x00-\x1f\x7f-\x9f"<>|?*;`]/.test(value)) return null;
  const unc = /^[\\/]{2}/.test(value);
  if (unc && !/^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/][^\\/]/.test(value)) return null;
  const windows = /^[a-z]:[\\/]/i.test(value) || unc;
  const absolute = windows || value.startsWith("/");
  if (!absolute && /[\\/:]/.test(value)) return null;
  const parts = value.split(/[\\/]/);
  if (parts.some((part) => part === "." || part === "..") || /:/.test(windows ? value.slice(2) : value)) return null;
  const executable = parts.pop() ?? "";
  if (!executable || executable === "." || executable === ".." || [...executable].length > 255 || /:/.test(executable) || /\.exe\s|\s[-/]/i.test(executable)) return null;
  return { executable, path: absolute ? value : "" };
}

export function presetGames(bridge: BridgeGame[], catalog: BridgeGame[]): BridgeGame[] {
  const presets = bridge.filter((game) => game.source !== "local");
  return presets.length ? presets : catalog;
}

export function gameIdentity(game: BridgeGame): string {
  return game.source === "local" && game.id ? game.id : `preset:${game.name.toLowerCase()}`;
}

export function matchesGame(profile: BridgeProfile, game: BridgeGame): boolean {
  return game.source === "local"
    ? Boolean(game.id) && profile.application.localId === game.id
    : !profile.application.localId && profile.application.name.toLowerCase() === game.name.toLowerCase();
}

export function profileApplication(game: BridgeGame): BridgeProfile["application"] {
  return { name: game.name, executable: game.executables[0] ?? "", path: game.source === "local" ? game.path ?? "" : "", ...(game.source === "local" && game.id ? { localId: game.id, ...targetMetadata(game) } : {}) };
}

export function localTargetIdentity(target: { executable: string; path: string }): string {
  if (!target.path) return `exe:${target.executable.toLowerCase()}`;
  const path = target.path.replace(/\\/g, "/");
  return `path:${/^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path}`;
}

export function replaceGameProfile(profiles: BridgeProfile[], game: BridgeGame, deviceId: string, next: BridgeProfile | null): BridgeProfile[] {
  const remaining = profiles.filter((profile) => !(matchesGame(profile, game) && profile.device.id === deviceId));
  return next ? [...remaining, next] : remaining;
}
