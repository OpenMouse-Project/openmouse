import { useState, type ReactNode } from "react";
import { bridgeIconUrl } from "../bridge/bridge";

/**
 * A local target's own app icon from Bridge, or `fallback` when Bridge has none
 * (older Bridge, no icon outside Windows, or extraction failed).
 */
export function AppIcon({ iconId, fallback, className }: { iconId?: string; fallback: ReactNode; className?: string }): ReactNode {
  const [failed, setFailed] = useState<string | null>(null);
  if (!iconId || failed === iconId) return fallback;
  return <img className={className} src={bridgeIconUrl(iconId)} alt="" draggable={false} onError={() => setFailed(iconId)} />;
}
