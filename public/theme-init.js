// Applies the saved colour scheme before first paint so the app never flashes
// the wrong theme. Kept as its own file rather than inline in index.html so the
// deployed Content-Security-Policy can forbid inline scripts entirely
// (script-src 'self' in public/_headers).
(() => {
  try {
    const saved = JSON.parse(localStorage.getItem("openmouse-interface-settings-v1") || "{}");
    const dark =
      saved.colorMode === "Dark" ||
      (saved.colorMode !== "Light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
  }
})();
