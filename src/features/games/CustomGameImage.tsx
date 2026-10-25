import { useEffect, useState, type ReactNode } from "react";
import { Gamepad2 } from "lucide-react";
import { customGameImageUrl } from "../bridge/bridge";

/** The picture a custom game was given, or the default icon when it has none. */
export function CustomGameImage({ name, version = 0, size = 28 }: { name: string; version?: number; size?: number }): ReactNode {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name, version]);
  if (failed) return <Gamepad2 size={size} strokeWidth={1.6} aria-hidden="true" />;
  return <img src={customGameImageUrl(name, version)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}
