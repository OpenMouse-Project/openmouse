import assert from "node:assert/strict";
import test from "node:test";

let renderLandingPage;

try {
  ({ renderLandingPage } = await import("../src/landing-page.ts"));
} catch {
  // The first TDD run intentionally exercises the not-yet-created module.
}

test("renders the complete landing page with its primary actions", () => {
  assert.equal(typeof renderLandingPage, "function");

  const page = renderLandingPage();

  for (const landmark of [
    /<nav class="site-nav"/,
    /class="[^"]*\bhero\b/,
    /class="[^"]*\bproduct-stage\b/,
    /class="[^"]*\bprinciples\b/,
    /class="[^"]*\bhow-it-works\b/,
    /class="[^"]*\bdevices\b/,
    /class="[^"]*\bsupported-mice\b/,
    /class="[^"]*\broadmap\b/,
    /class="[^"]*\bdiscord-community\b/,
    /class="[^"]*\bfaq\b/,
    /<footer/,
  ]) {
    assert.match(page, landmark);
  }

  assert.match(page, /href="\/demo\.html"/);
  assert.match(page, /href="https:\/\/github\.com\/snekxs\/openmouse"/);
  assert.match(page, /href="https:\/\/discord\.gg\/5Vw9uQV3xB"/);
  assert.match(page, /href="https:\/\/x\.com\/openmouseapp"/);
});

test("renders the verified supported-mice index in the intended section order", () => {
  const page = renderLandingPage();
  const manufacturers = ["WLMouse", "Endgame Gear", "Pulsar", "Logitech", "Orbital"];
  const models = ["Beast G", "Beast X", "Huan", "OP1 8K", "OP1we", "X2 CrazyLight", "Superlight 2C", "Superlight", "Pathfinder"];

  assert.match(page, /href="#supported-mice"/);
  assert.match(page, /<section id="supported-mice"/);
  for (const manufacturer of manufacturers) assert.ok(page.includes(`<h3>${manufacturer}</h3>`), `Missing ${manufacturer}`);
  for (const model of models) assert.ok(page.includes(`<li>${model}</li>`), `Missing ${model}`);

  const devicesIndex = page.indexOf('id="devices"');
  const supportedIndex = page.indexOf('id="supported-mice"');
  const roadmapIndex = page.indexOf('id="roadmap"');
  assert.ok(devicesIndex < supportedIndex && supportedIndex < roadmapIndex);
  assert.match(page, /Don(?:'|&rsquo;)t see your mouse\?/);
});

test("preserves browser support and accessible FAQ markup", () => {
  const page = renderLandingPage();

  for (const browser of ["chrome", "edge", "firefox", "safari"]) {
    assert.ok(page.includes(`data-browser="${browser}"`));
  }

  assert.match(page, /<details>/);
  assert.match(page, /Is my mouse data uploaded anywhere\?/);
  assert.match(page, /Why won(?:’|&rsquo;)t OpenMouse work in Firefox\?/);
});
