# Contributing to OpenMouse

Thank you for considering a contribution to OpenMouse.

## Before you begin

OpenMouse is source available, not open source. The
[OpenMouse Source-Available License 1.0](LICENSE) permits private, local
modification for the purpose of preparing a good-faith contribution to the
official project. It does not permit publishing or maintaining an independent
fork.

For a significant change, start with an issue describing the problem and your
proposed approach. Small bug fixes and documentation corrections may be
submitted directly.

## Submitting a contribution

1. Create the minimum private or platform-hosted fork needed to prepare the
   contribution.
2. Keep the change focused and include relevant tests or verification.
3. Submit a pull request to `https://github.com/snekxs/openmouse`.
4. Explain what changed, why it is needed, and how it was tested.
5. Do not include code, assets, or other material that you do not have the
   right to contribute.

A platform-hosted fork may be used only to prepare and submit contributions. Do
not publish releases from it, promote it as a separate project, or use it for
any other purpose prohibited by the license.

## Contributor agreement

By intentionally submitting a contribution to OpenMouse, you represent and
agree that:

1. You created the contribution or otherwise have the legal right to submit it
   under these terms.
2. The contribution does not knowingly violate another person's copyright,
   patent, trademark, trade secret, privacy, or other rights.
3. You grant the OpenMouse copyright holder a perpetual, worldwide,
   non-exclusive, irrevocable, royalty-free, transferable, and sublicensable
   license to use, reproduce, modify, prepare derivative works from, publicly
   display, publicly perform, distribute, commercialize, and otherwise exploit
   the contribution in source or object form under any license or terms.
4. You grant the OpenMouse copyright holder and all recipients of the
   contribution a perpetual, worldwide, non-exclusive, irrevocable,
   royalty-free patent license under patent claims you can license that are
   necessarily infringed by your contribution alone or by its combination with
   the OpenMouse version to which it was submitted.
5. You understand that your contribution may be accepted, changed, relicensed,
   commercially licensed, or not used at all, and that no payment is owed to
   you unless a separate written agreement says otherwise.
6. You retain ownership of your contribution, subject to the rights granted
   above.

If you submit a contribution on behalf of an employer or another organization,
you represent that you are authorized to accept these terms for that
organization. If you are not authorized, do not submit the contribution.

## Development

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

Before submitting a code change, verify the production build:

```sh
npm run build
```

