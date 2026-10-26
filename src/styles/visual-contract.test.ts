import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = JSON.parse(readFileSync(new URL("./visual-contract.json", import.meta.url), "utf8"));
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function block(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block`);
  const body = tokens.slice(tokens.indexOf("{", start) + 1, tokens.indexOf("}", start));
  const vars = new Map<string, string>();
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars.set(match[1]!, match[2]!.trim());
  return vars;
}

const root = block(":root");
const dark = block(":root,\n[data-interface-theme]");
const light = block('[data-interface-theme="light"]');

const px = (name: string): number => {
  const value = root.get(name);
  assert.ok(value, `--${name}`);
  assert.match(value, /^\d+(\.\d+)?px$/, `--${name}`);
  return Number.parseFloat(value);
};

test("shell, page and rail geometry match the shared contract", () => {
  assert.equal(px("sidebar-w"), contract.sidebar);
  assert.equal(px("sidebar-w-collapsed"), contract.sidebarCollapsed);
  assert.equal(px("sidebar-inline"), contract.sidebarInline);
  assert.equal(px("nav-h"), contract.navHeight);
  assert.equal(px("nav-inline"), contract.navInline);
  assert.equal(px("nav-icon"), contract.navIcon);
  assert.equal(px("page-x"), contract.pageX);
  assert.equal(px("page-top"), contract.pageTop);
  assert.equal(px("content-w"), contract.contentMax);
  assert.equal(px("rail-w"), contract.railWide);
  assert.equal(px("rail-w-medium"), contract.railMedium);
  assert.equal(px("rail-gap"), contract.railGap);
  assert.equal(px("rail-art-inset"), contract.railArtInset);
  assert.equal(px("rail-art-stacked"), contract.railArtStacked);
});

test("tabs, panels and controls match the shared contract", () => {
  assert.equal(px("tab-well-h"), contract.tabWell);
  assert.equal(px("tab-h"), contract.tabHeight);
  assert.equal(px("tab-pad"), contract.tabPad);
  assert.equal(px("tab-gap"), contract.tabGap);
  assert.equal(px("panel-pad"), contract.panelPad);
  assert.equal(px("panel-gap"), contract.panelGap);
  assert.equal(px("row-min"), contract.rowMin);
  assert.equal(px("control-h"), contract.control);
  assert.equal(px("switch-w"), contract.switchWidth);
  assert.equal(px("switch-h"), contract.switchHeight);
  assert.equal(px("switch-thumb"), contract.switchThumb);
  assert.deepEqual(["r-xs", "r-sm", "r-md", "r-lg"].map(px), contract.radii);
  assert.equal(px("fs-body"), contract.fontBody);
  assert.equal(px("fs-title"), contract.fontTitle);
  assert.equal(px("fs-h2"), contract.fontPanel);
  assert.equal(px("fs-meta"), contract.fontMeta);
  assert.equal(px("fs-small"), contract.fontSmall);
  assert.equal(px("fs-figure"), contract.figure);
  assert.equal(px("fs-crumb"), contract.crumb);
  assert.equal(px("fs-connection"), contract.connection);
});

test("dark and light palettes are the contract values", () => {
  for (const [name, vars] of [["dark", dark], ["light", light]] as const) {
    const p = contract[name];
    assert.equal(vars.get("ink-0"), p.ink0, `${name} ink-0`);
    assert.equal(vars.get("ink-1"), p.ink1, `${name} ink-1`);
    assert.equal(vars.get("text-1"), p.text1);
    assert.equal(vars.get("text-2"), p.text2);
    assert.equal(vars.get("text-3"), p.text3);
    assert.equal(vars.get("text-4"), p.text4);
    assert.equal(vars.get("accent"), p.accent);
    assert.equal(vars.get("tint-rgb"), p.tint.join(" "));
  }
});

test("common ground and featured panels use native-supported materials", () => {
  const controls = readFileSync(new URL("./controls.css", import.meta.url), "utf8");
  assert.equal(dark.get("ground"), "var(--ink-1)");
  const featured = controls.match(/\.om-panel\.is-lit\s*\{([^}]+)\}/)?.[1];
  assert.ok(featured, "featured panel material");
  assert.doesNotMatch(featured, /radial-gradient|var\(--sheen\)/);
  assert.match(featured, /linear-gradient\(180deg,\s*rgb\(var\(--accent-rgb\)\s*\/\s*0\.07\),\s*transparent 50%\)/);
  assert.match(featured, /linear-gradient\(var\(--surface-1\),\s*var\(--surface-1\)\),\s*var\(--ink-1\)/);
});

test("a selected tab keeps the shared keyboard focus ring", () => {
  const css = readFileSync(new URL("./device.css", import.meta.url), "utf8");
  const focus = css.match(/\.om-tab:focus-visible\s*\{\s*box-shadow:\s*var\(--focus\);\s*\}/);
  assert.ok(focus, "active tabs need their own focus rule");
  assert.ok(focus.index! > css.indexOf(".om-tab.is-active {"), "selected styling must not mask focus");
});

test("DM Sans is self-hosted with its licence and pinned to the native instance", () => {
  const fonts = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");
  assert.match(fonts, /font-family:\s*"DM Sans"/);
  assert.match(fonts, /url\("\/fonts\/DMSans-Variable\.ttf"\)/);
  const font = readFileSync(new URL("../../public/fonts/DMSans-Variable.ttf", import.meta.url));
  assert.equal(font.length, 240_164);
  assert.match(readFileSync(new URL("../../public/fonts/DM-Sans-OFL.txt", import.meta.url), "utf8"), /SIL Open Font License/);
  assert.match(root.get("font-sans") ?? "", /^"DM Sans"/);
  assert.equal(root.get("font-opsz"), '"opsz" 14');
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /family=DM\+Sans/);
});
