# OpenMouse Docs

Documentation site for the OpenMouse Project, built with [Docusaurus](https://docusaurus.io/). Deployed at [docs.openmouse.app](https://docs.openmouse.app).

Lives on the **`docs` branch** of the [`openmouse`](https://github.com/OpenMouse-Project/openmouse) repo — not a separate repo — so it stays next to the code it documents.

Covers the app's architecture and, most importantly, how to add support for a new mouse — reverse-engineering conventions, writing a driver, and getting it registered and verified.

## Local development

```bash
npm install
npm run start
```

## Build

```bash
npm run build
```

Generates static content into `build/`.

## Related

- **[openmouse](https://github.com/OpenMouse-Project/openmouse)** (`control-panel` branch) — the app these docs are for.
- **[mouse-protocol](https://github.com/OpenMouse-Project/mouse-protocol)** — the packet codecs and WebHID drivers these docs explain how to write.

## License

[GNU AGPL-3.0](https://github.com/OpenMouse-Project/openmouse/blob/main/LICENSE), same as the rest of the project.
