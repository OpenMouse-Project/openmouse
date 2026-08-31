# Device artwork

Top-down product images shown in the persistent device panel. These are
**not committed to the repo** — they're hosted in the public `openmouse-devices`
Cloudflare R2 bucket and served from its r2.dev URL
(`DEVICE_IMAGE_BASE_URL` in `src/ui/device-images.ts`). This file stays as
the provenance/licensing record for every image that's been uploaded, and as
the local staging folder before upload.

Adding one:

1. Save a **transparent** PNG or WebP named after the model in kebab-case, e.g.
   `razer-viper-v3-pro.png`. The panel sits on a dark background, so an image
   with a white backdrop shows as a white block.
2. Keep enough resolution for a product panel up to roughly 340 px wide.
3. Upload it to the bucket:
   ```bash
   npx wrangler r2 object put openmouse-devices/<name>.png --file=<name>.png --remote
   ```
   (requires `wrangler login` against the OpenMouse Cloudflare account first).
4. Map the device to it in `src/ui/device-images.ts`, keyed by
   `vendorId:productId` in lowercase hex — value is the bare filename, not a
   path. A mouse with separate wired and receiver product ids needs an entry
   for each.
5. Record the source/licensing note for the file below, for provenance.

Upload the file and add its mapping in the same commit. A mapping whose file
is missing from the bucket fails at load rather than at build, and the panel
then drops the thumbnail.

## Licensing

Vendor product renders are usually copyrighted marketing assets, and this
repository is public. Prefer artwork you made or can redistribute — a traced
silhouette is enough at this size — over an official render lifted from a
product page.

`logitech-pro-x-superlight-2c.png` was supplied for the redesign from Logitech's
official PRO X SUPERLIGHT 2c product gallery. Confirm redistribution terms
before including it in a public release package.

`logitech-pro-x2-superstrike.png` was supplied from Logitech G's official
PRO X2 SUPERSTRIKE product gallery. Confirm redistribution terms before
including it in a public release package.

The three `logitech-g502*.png` files were supplied from Lenovo, Logitech G,
and MyXprs product-image URLs. They were normalized to matching 700×700
transparent canvases; the original G502 backdrop was extracted from its source
render. Confirm redistribution terms before including them in a public release
package.

`logitech-g703.png` was supplied from Logitech G's official G703 HERO product
gallery (`resource.logitechg.com` DAM `g703-mouse-top-angle-gallery-1.png`)
and normalized to the same 700×700 transparent canvas as the G502 set. Confirm
redistribution terms before including it in a public release package.

`logitech-mx-master-4.png` is a line-art trace made for this repository, not a
vendor render. Only geometry derives from the source: the outer silhouette and
the shell seams — button split, scroll-wheel housing, thumb rest, thumb wheel,
side-panel crease and the wheel-mode button — were authored as paths against a
product image. No colour, shading, texture or lettering was carried over, and
the Logitech wordmark on the shell was deliberately excluded rather than faded,
since it is a trademark and this repository is public. This render is currently
parked (no acceptable re-render was sourced), so the MX Master 4 resolves to the
generic `unknown-device.png` placeholder until a clean render is supplied.

`endgame-gear-op1-8k.png` was supplied from an Overclockers UK product-image
URL for the OP1 8K. Confirm redistribution terms before including it in a
public release package.

`endgame-gear-op1we.png` was supplied from an Overclockers UK product-image
URL for the OP1we.

`razer-viper-v2-pro.png` was supplied from Razer's support FAQ device-layout
asset (`dl.razerzone.com/src/6048-1-en-v10.png`). Ideally replace it with a
higher-resolution image if one is found. Confirm redistribution terms before
including it in a public release package.

`teevolution-terra-pro.png` was supplied from Teevolution's Terra PRO Shopify
CDN product render. Confirm redistribution terms before including it in a
public release package.

`crdrako-ko-one.png` was supplied from CRDRAKO's KO-ONE Shopify CDN product
render and converted to a transparent PNG. Confirm redistribution terms before
including it in a public release package.

`razer-viper-mini.webp` was supplied from a Discord attachment URL for the
Razer Viper Mini (wired). Confirm redistribution terms before including it in
a public release package.

`zaunkoenig-m3k.png` was supplied from the OpenMouse product-image storage URL
for Zaunkoenig M3K and is also used for the M2K entry. Confirm redistribution
terms before including it in a public release package.

`attackshark-r5-ultra.png` is the top-down render of the Attack Shark R5 Ultra
extracted from Attack Shark's official product gallery
(`cdn.shopify.com/s/files/1/0823/5050/6282/files/R5ULTRA_C06_3.png`), keyed
out of its white backdrop and downscaled. Confirm redistribution terms before
including it in a public release package.

`razer-viper.webp` was supplied from a Best Buy shopping page for the device. Confirm redistribution
terms before including it in a public release package.

`logitech-mx-master-3s.png` was supplied from Logitech's product CDN (MX Master
3S Bluetooth Edition graphite top view). Confirm redistribution terms before
including it in a public release package.

`pulsar-x2-v2.png` was supplied from Pulsar Gaming Gears' Japan CDN product
render for the X2 v2 [Red Edition] Gaming Mouse (top-down view of the Medium
shell), cropped to the mouse, resized, and centered on a transparent canvas.
Confirm redistribution terms before including it in a public release package.

`wlmouse-beast-max.png` is the black colorway, extracted from WL Mouse Hub
(`gm.wlmouse.gg`, the official WLMouse configurator) after pairing a Beast Max
over WebHID — the driver only serves the connected device's own product
renders, so this can't be fetched without real hardware. Confirm
redistribution terms before including it in a public release package.

The following were added to cover additional `supported` devices from the
support catalog, sourced from official brand/media CDNs and retailer product
renders, then normalized to transparent PNGs (white backgrounds keyed out where
needed). Confirm redistribution terms before including any in a public release
package:

- `logitech-g203.png` (G203 LIGHTSYNC / PRODIGY, G102 share the shell) — Logitech / retailer render
- `logitech-g402.png` — Logitech G402 render
- `logitech-g303.png` — Logitech G303 render
- `logitech-g403.png` — Logitech G403 render
- `logitech-g903.png` — Logitech G903 render
- `logitech-g305.png` — Logitech G305 LIGHTSPEED (G304 shares the shell)
- `logitech-g-pro.png` — Logitech G Pro (2017) / G Pro Hero / G Pro Wireless classic shell
- `logitech-g-pro-2.png` — Logitech G Pro 2
- `logitech-g309.png` — Logitech G309 Lightspeed
- `logitech-mx-anywhere-3.png` — Logitech MX Anywhere 3 top-view render
- `logitech-mx-ergo-s.png` — Logitech MX Ergo S top-view render
- `razer-deathadder-v2.png` — Razer DeathAdder V2 (V2 / V2 Pro / Essential share the shell)
- `razer-deathadder-v3.png` — Razer DeathAdder V3 render
- `razer-deathadder-v4-pro.png` — Razer DeathAdder V4 Pro (Carbon Fiber SKU shares the shell)
- `razer-viper-v3-hyperspeed.png` — Razer Viper V3 HyperSpeed render
- `razer-viper-v4-pro.png` — Razer Viper V4 Pro render
- `endgame-gear-xm2-8k.png` — Endgame Gear XM2 8K top-down render
- `endgame-gear-xm2w.png` — Endgame Gear XM2w 4K top-down render
- `wlmouse-sword-x.png` — WLMouse Sword X render (Beast X / Beast Mini / Beast X Pro have no render yet; they resolve to the generic placeholder)
- `vgn-dragonfly-f2.png` — VGN Dragonfly F2 Master+ render
- `lamzu-maya-x.png` — Lamzu Maya X render
- `atk-f1-v2-ultra-max.png` — ATK F1 V2 Ultra Max render
- `finalmouse-ulx.png` — Finalmouse Starlight-12 / ULX low-profile shape render
