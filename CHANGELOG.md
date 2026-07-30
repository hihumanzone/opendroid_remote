# Changelog

All notable changes to OpenDroid Remote are documented here.

## 1.6.0 — 2026-07-30

- Serialized device activation, fallback selection, disconnect cleanup, stream
  restart, capability refresh, reconnect resume, and dynamic-display restart
  through one failure-isolated lifecycle queue.
- Prevented full scrcpy display/encoder discovery from running beside an active
  media session; disruptive discovery now performs an orderly
  stop-probe-resume sequence and attempts recovery if the probe fails.
- Added direct Android key ownership so blur, visibility loss, Edit mode,
  profile changes, device switches, and teardown always emit matching key-up
  events before replacing the control channel.
- Made mapping profile/orientation/enabled changes atomic and coalesced,
  preserving active Pointer Lock where appropriate while preventing repeat or
  swipe callbacks from recreating touches during cleanup.
- Tracked and released every held SDK-compatibility mouse button independently
  and corrected direct touchscreen button semantics.
- Extracted profile batch import and major workspace presentation controls into
  dedicated modules, including deterministic collision, timestamp, file, and
  batch-error behavior.
- Expanded deterministic coverage to 107 tests, including lifecycle queue,
  direct-key, dynamic-display, mapping-race, mouse cleanup, and profile-import
  regressions.

## 1.5.0 — 2026-07-30

- Added an Android UHID physical mouse using the upstream scrcpy five-button
  relative HID descriptor, including hover movement, native button state, and
  vertical/horizontal wheel reports.
- Added Pointer Lock capture with unadjusted movement when supported, standard
  Pointer Lock fallback, a visible capture status, and clean Esc/button release.
- Added runtime `/dev/uhid` capability probing and a guarded clean-session
  retry if UHID creation is rejected after the probe.
- Made scrcpy SDK mouse injection an explicit compatibility choice; physical
  mode never silently falls back to touch-compatible primary clicks.
- Reworked touch mouse-look to recenter at its configured radius, preserve
  unconsumed deltas, and serialize concurrent movement without a circular
  dead zone.
- Added persisted mouse mode, sensitivity, and raw-input settings plus UHID,
  SDK compatibility, disabled-mode, and recenter regression tests.

## 1.4.0 — 2026-07-30

- Isolated the saved-key/public-key ADB authentication protocol from WebUSB
  device ownership and reconnect management.
- Centralized and tested connection-state presentation across simultaneous
  connecting, authenticating, authorizing, reconnecting, and live devices.
- Kept one mapping engine alive across profile edits to prevent synthetic touch
  teardown/recreation races.
- Prevented late decoder failures from an old scrcpy client from changing a
  newer session, and made pre-first-frame stream failure fail immediately.
- Hardened ADB identity persistence by waiting for IndexedDB transaction commit
  and closing obsolete database connections on version changes.
- Added deterministic regression coverage for connection state priority and
  finalized lifecycle cleanup.

## 1.3.1 — 2026-07-29

- Distinguished an already-trusted saved-key handshake from a genuine Android
  USB-debugging approval request.
- Added bounded stale-handshake reopening and reconnect retry.
- Merged divergent IndexedDB and localStorage ADB key-ring mirrors.

## 1.3.0 — 2026-07-29

- Added persistent migrated ADB identities, serial-keyed automatic reconnect,
  stream resume, advanced quality controls, and configurable profile imports.
- Added negotiated computer-side raw/compressed Android audio playback.
- Removed the ADB logical-socket stall assertion from long-running media
  sessions and patched production dependency advisories.

## 1.2.1 — 2026-07-29

- Corrected contained-video coordinate conversion outside fullscreen.
- Stabilized long-running dual audio playback and unmapped input passthrough.

## 1.2.0 — 2026-07-29

- Added computer-side Android audio, two-mode mapping controls, mapping profile
  management, contained fullscreen scaling, and responsive layout updates.
