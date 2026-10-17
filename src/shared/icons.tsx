import { CircleDot, Circle, Eye, EyeOff, Link2, Pencil, RefreshCw, Share2, Trash2, Unlink2 } from "lucide-react";
import type { ReactNode } from "react";

export function IconEnabled(): ReactNode {
  return <Eye size={13} strokeWidth={1.8} stroke="currentColor" aria-hidden="true" />;
}

export function IconDisabled(): ReactNode {
  return <EyeOff size={13} strokeWidth={1.8} stroke="currentColor" aria-hidden="true" />;
}

export function IconLinked(): ReactNode {
  return <Link2 size={12} strokeWidth={2} stroke="currentColor" aria-hidden="true" />;
}

export function IconUnlinked(): ReactNode {
  return <Unlink2 size={12} strokeWidth={2} stroke="currentColor" aria-hidden="true" />;
}

export function IconRename(): ReactNode {
  return <Pencil size={13} strokeWidth={1.8} stroke="currentColor" aria-hidden="true" />;
}

export function IconRunning(): ReactNode {
  return <CircleDot size={13} strokeWidth={1.8} stroke="currentColor" aria-hidden="true" />;
}

export function IconActivate(): ReactNode {
  return <Circle size={13} strokeWidth={1.8} stroke="currentColor" aria-hidden="true" />;
}

export function IconRefresh(): ReactNode {
  return <RefreshCw size={13} strokeWidth={1.8} stroke="currentColor" aria-hidden="true" />;
}

export function IconTrash(): ReactNode {
  return <Trash2 size={13} strokeWidth={1.7} stroke="currentColor" aria-hidden="true" />;
}

export function IconShare(): ReactNode {
  return <Share2 size={13} strokeWidth={1.7} stroke="currentColor" aria-hidden="true" />;
}
