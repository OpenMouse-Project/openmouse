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
    let meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "color-scheme");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", dark ? "dark light" : "light dark");
    const toSlug = (name) =>
      String(name || "")
        .toLowerCase()
        .replace("é", "e")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const themes = ["matt", "emerald", "violet", "ice", "ember", "mono", "miku", "catppuccin-mocha", "catppuccin-macchiato", "catppuccin-frappe", "nier-automata", "light"];
    const themeSlug = toSlug(saved.theme);
    document.documentElement.dataset.interfaceTheme = themeSlug && themes.indexOf(themeSlug) !== -1 ? themeSlug : "emerald";
    const langs = { pt: "pt-BR", es: "es", fr: "fr", de: "de", zh: "zh-CN", ja: "ja", ko: "ko", ru: "ru", vi: "vi", ar: "ar", tr: "tr", en: "en" };
    const locale = typeof saved.locale === "string" && langs[saved.locale] ? saved.locale : null;
    document.documentElement.lang = locale ? langs[locale] : "en";
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  } catch {
  }
})();
