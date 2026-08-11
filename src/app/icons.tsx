import type { ReactNode } from "react";

export function IconEnabled(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9fe0b6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

export function IconDisabled(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#77777c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 8s2.2-4 6-4 6 4 6 4a10 10 0 0 1-1.7 1.9" />
      <path d="M6.3 11.7A7.6 7.6 0 0 0 8 12" />
      <path d="m2 2 12 12" />
    </svg>
  );
}

export function IconLinked(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 9.5a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.7.7" />
      <path d="M9.5 6.5a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.7-.7" />
    </svg>
  );
}

export function IconUnlinked(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M7 4.4l1.1-1.1a2.6 2.6 0 0 1 3.7 3.7L10.7 8.1" />
      <path d="M9 11.6l-1.1 1.1a2.6 2.6 0 0 1-3.7-3.7L5.3 7.9" />
      <path d="M2.6 2.6l10.8 10.8" />
    </svg>
  );
}

export function IconRename(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8b8b90" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.2 2.6a1.7 1.7 0 0 1 2.4 2.4L5.4 13.2 2 14l.8-3.4Z" />
    </svg>
  );
}

export function IconRunning(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9fe0b6" strokeWidth="1.6" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.4" fill="#9fe0b6" stroke="none" />
    </svg>
  );
}

export function IconActivate(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#77777c" strokeWidth="1.6" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}

export function IconRefresh(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.6 6.6A6 6 0 1 0 14 8" />
      <path d="M14 2.4V6.6H9.8" />
    </svg>
  );
}

export function IconTrash(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10" />
      <path d="M6 2.5h4l.6 2H5.4l.6-2Z" />
      <path d="m4.2 4.5.6 9h6.4l.6-9" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}
