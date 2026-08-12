# Device artwork

Top-down product images shown in the persistent device panel. Vite serves
this folder from the site root, so a file here is reachable at
`/devices/<name>.png`.

Adding one:

1. Save a **transparent** PNG or WebP named after the model in kebab-case, e.g.
   `razer-viper-v3-pro.png`. The panel sits on a dark background, so an image
   with a white backdrop shows as a white block.
2. Keep enough resolution for a product panel up to roughly 340 px wide.
3. Map the device to it in `src/ui/device-images.ts`, keyed by
   `vendorId:productId` in lowercase hex. A mouse with separate wired and
   receiver product ids needs an entry for each.

Add the file and its mapping in the same commit. A mapping whose file is missing
fails at load rather than at build, and the panel then drops the thumbnail.

## Licensing

Vendor product renders are usually copyrighted marketing assets, and this
repository is public. Prefer artwork you made or can redistribute — a traced
silhouette is enough at this size — over an official render lifted from a
product page.

`logitech-pro-x-superlight-2c.png` was supplied for the redesign from Logitech's
official PRO X SUPERLIGHT 2c product gallery. Confirm redistribution terms
before including it in a public release package.

The three `logitech-g502*.png` files were supplied from Lenovo, Logitech G,
and MyXprs product-image URLs. They were normalized to matching 700×700
transparent canvases; the original G502 backdrop was extracted from its source
render. Confirm redistribution terms before including them in a public release
package.

`logitech-mx-master-4.png` is a line-art trace made for this repository, not a
vendor render. Only geometry derives from the source: the outer silhouette and
the shell seams — button split, scroll-wheel housing, thumb rest, thumb wheel,
side-panel crease and the wheel-mode button — were authored as paths against a
product image. No colour, shading, texture or lettering was carried over, and
the Logitech wordmark on the shell was deliberately excluded rather than faded,
since it is a trademark and this repository is public.

`endgame-gear-op1-8k.png` was supplied from an Overclockers UK product-image
URL for the OP1 8K. Confirm redistribution terms before including it in a
public release package.

`razer-viper-v2-pro.png` was supplied from Razer's support FAQ device-layout
asset (`dl.razerzone.com/src/6048-1-en-v10.png`). Ideally replace it with a
higher-resolution image if one is found. Confirm redistribution terms before
including it in a public release package.

`keychron-nape-pro.png` was supplied from Keychron's sysmgr cover CDN for the
Nape Pro. Confirm redistribution terms before including it in a public release
package.

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

`razer-viper.webp` was supplied from a Best Buy shopping page for the device. Confirm redistribution
terms before including it in a public release package.
