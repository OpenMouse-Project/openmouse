# NOIR S1 support notes

## Implementation

The NOIR S1 uses the existing OpenMouse K-snake protocol client (the app pins
`@openmouse/protocol` 0.22.0). This change adds S1-specific configurator
behavior to the OpenMouse UI; it does not add or fork a protocol driver.

The S1 UI exposes the settings reported by the device: button assignments,
the six DPI stages, polling rate, scroll direction, and the K-snake macro
editor. The Overview profile picker keeps six named slots in browser storage;
Apply writes the selected slot to the mouse. It is not a claim that those six
slots are stored as native onboard profiles.

## Hardware validation recorded during development

- Connected and operated over USB wired and the 2.4 GHz receiver.
- Button remapping, macro assignment/playback, and DPI-stage cycling were
  confirmed by the user on hardware.
- Profiles 2–6 were exercised over 2.4 GHz; restoring the button defaults was
  also confirmed on hardware.
- The 2.4 GHz Hardware Test reported 13 checks passed, 0 failed, and 1 skipped.
  The skipped polling-rate sample required mouse movement, which was not
  observed during that run. This is manual-device evidence, not CI coverage.

## Known limitations

- Macro definitions cannot be reliably read back from the firmware. OpenMouse
  starts the editor with blank local slots and writes the table when saved;
  users should save/export their macro setup before changing computers or
  clearing browser storage.
- The profile slots are browser-local and must be applied to change device
  settings. They are not onboard profile switching.
- Left click is fixed by the shared K-snake protocol and is intentionally not
  offered as a remappable target.
- “Reset to default” covers button mappings only. A complete vendor-style
  factory reset is not implemented or validated by this contribution.
- The vendor configurator image is not bundled. The UI reserves
  `noir-s1.png`; a maintainer-hosted artwork request and rights review are
  separate from this code change. Until the asset is uploaded, the image
  request/fallback flow applies.
