# Device artwork

Top-down product images shown as a thumbnail in the device overview. Vite serves
this folder from the site root, so a file here is reachable at
`/devices/<name>.png`.

Adding one:

1. Save a **transparent** PNG named after the model in kebab-case, e.g.
   `razer-viper-v3-pro.png`. The panel sits on a dark background, so an image
   with a white backdrop shows as a white block.
2. Roughly 600 px on the long edge is enough; it renders around 100 px wide.
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
