# OpenDroid Remote

OpenDroid Remote is an open-source, browser-only Android remote-control and
gaming client. It connects a desktop Chromium browser directly to Android with
WebUSB and ADB, starts the upstream scrcpy server over that local connection,
decodes the video with WebCodecs, and sends keyboard, pointer, clipboard, and
multi-touch control messages back over scrcpy.

There is no Android companion app, native desktop client, account, telemetry,
relay, application backend, or paid service. Once the static assets have
loaded, the Android connection stays between the browser and the USB device.

## What is included

- WebUSB discovery, non-blocking Android authorization, a persistent migrated
  ADB key ring, serial-keyed multi-device connections, automatic cable
  reconnect/session resume, per-device cleanup, live authorized-device
  add/remove tracking, and actionable error states
- Verified, bundled scrcpy server 3.3.3 with the stable ya-webadb 2.x stack
- Runtime display, focused-display, encoder, codec, and renderer discovery
- Automatic H.264/H.265/AV1 fallback across Android encoders and browser
  WebCodecs support, plus runtime raw/Opus/AAC/FLAC audio-decoder probes
- Physical, virtual, mirrored, secondary, and dynamically changing display
  enumeration without a hardcoded display ID
- Low-latency video and Android 11+ output-audio forwarding to the computer,
  plus keyboard, direct text, a physical Android UHID mouse, independent
  touchscreen input, clipboard, rotation, fullscreen, Back/Home/Recents,
  power, and volume
- Resolution-independent visual game mapping editor
- Tap, hold, repeated tap, swipe/drag, WASD or arrow joystick, mouse button,
  and Pointer Lock mouse-look mappings
- Independent scrcpy pointer IDs for simultaneous synthetic and direct touches
- Persisted per-device video/audio/latency/decoder/compatibility settings
- Local per-game profiles with IndexedDB and localStorage fallback
- Versioned JSON batch import/export, configurable collision/error/file
  handling, a formal JSON Schema, and an example profile
- Local diagnostics for WebUSB, ADB authentication, scrcpy server output,
  displays, encoders, decoder startup, clipboard, and control-channel failures
- Two production targets: the hosted application in `dist/` and a completely
  portable static site in `dist-static/`

## Requirements

### Desktop browser

Use a current desktop Chromium-family browser that exposes WebUSB and
WebCodecs, such as Google Chrome, Microsoft Edge, or a compatible Chromium
build. ChromeOS is supported when its browser and device policy allow WebUSB.
Serve the app over HTTPS or use `http://localhost` during development.

Firefox and Safari do not currently expose the required WebUSB API. Mobile
browsers are not a supported host.

See [the compatibility matrix](docs/COMPATIBILITY.md) for the complete API and
Android capability breakdown.

### Android

- A device with an ADB-capable USB interface and USB debugging enabled
- A data-capable USB cable
- A scrcpy-compatible Android build with an encodable display
- An unlocked screen to accept the one-time RSA authorization prompt

No root access and no Android application installation are required.
Video/control use the normal scrcpy Android baseline. Computer-side audio
capture additionally requires Android 11 or newer.

Physical mouse mode additionally requires the Android ADB shell identity to
open `/dev/uhid`. OpenDroid probes that capability instead of assuming it from
an Android version or device model.

## Android setup

1. Open Android Settings and enable **Developer options**. On most Android
   builds, tap **Build number** seven times under **About phone**.
2. Enable **USB debugging** in Developer options.
3. Connect Android with a data-capable cable, unlock it, and select a USB mode
   that exposes the debugging interface if the device asks.
4. Close Android Studio, native `adb`, native scrcpy, and other tabs that might
   already own the USB interface.
5. Open OpenDroid Remote over HTTPS (or localhost) and choose **Connect USB**.
6. Select the Android device in the browser chooser.
7. Accept **Allow USB debugging?** on Android. Enabling “Always allow from this
   computer” lets the stored browser ADB key reconnect without another prompt.

OpenDroid migrates every existing ya-webadb RSA key into an origin-local key
ring, mirrors that ring in dedicated IndexedDB and localStorage, shares it
across every device, and requests persistent browser storage when available.
It never rotates a usable key during reconnect. If a connected cable is
temporarily removed, the device stays in a reconnecting state and the app
re-authenticates with the same key and resumes the prior stream when the USB
serial returns. Android can still ask again if its debugging authorizations
were revoked, browser site data was cleared, private browsing is used, or the
site origin changed.

On Windows, the ADB interface must have a WebUSB/WinUSB-compatible driver. On
Linux, browser access can depend on the distribution’s USB permissions or udev
policy. These are host USB access requirements, not OpenDroid runtime
dependencies.

## Use

After connection, the client verifies the bundled scrcpy server, discovers the
available Android displays and video encoders, probes the browser decoders,
selects a focused or server-default display, and starts the first reliable
codec/encoder combination. Failed candidates are logged and retried
automatically. Each candidate first uses ya-webadb's automatic reverse-to-forward
tunnel negotiation, then receives an explicit ADB forward-tunnel retry if the
Android process exits before its media channels open.

Display and encoder queries retain the verified server file across the complete
discovery sequence. Streaming processes use scrcpy cleanup; the client
invalidates its deployment state afterward and re-pushes before a restart or
fallback attempt. Device switches, reconnect resume, disconnect cleanup,
quality restarts, and capability refreshes share one serialized session
lifecycle, so two UI or USB events cannot start or tear down scrcpy
concurrently.

### Normal remote control

- Choose **Add USB device** to authorize more devices without closing the
  current ADB connection. The device selector includes the full serial number;
  selecting an **ADB ready** device moves the one video/control workspace to it
  while every other ADB connection remains open.
- Move the desktop mouse over the video to move Android’s native mouse cursor.
  Left, right, middle, Back, and Forward buttons and both wheel axes are sent
  through scrcpy as reports from a virtual physical HID mouse.
- Click the video to enter Pointer Lock for continuous relative movement. The
  browser cursor disappears and no screen edge limits movement; press **Esc**
  to release it. OpenDroid requests unadjusted movement first and safely falls
  back to standard Pointer Lock.
- Right and middle clicks are native Android mouse buttons, not Back/Home
  shortcuts. Use the bottom dock for Android navigation.
- A touchscreen, pen, or browser touch contact still injects a real Android
  touch contact. Multiple contacts retain independent pointer IDs. Ordinary
  desktop mouse input is never converted to these contacts in physical mode.
- Mouse-wheel or trackpad input over the video is contained, so the surrounding
  page does not scroll until the pointer leaves the video.
- If Android does not permit `/dev/uhid`, physical mode leaves direct mouse
  input disabled. **Stream → Mouse input → SDK compatibility** is an explicit
  absolute-input fallback; on some Android/app combinations its primary click
  can be treated as touch-compatible input.
- Focus the video and use the physical keyboard to inject Android key events.
- Use **Text** to inject a complete string, or **Paste** to set and paste the
  desktop clipboard on Android.
- Use the bottom dock for Android navigation, rotation, volume, power,
  clipboard, and fullscreen.
- Audio is enabled by default on supported Android versions and plays through
  the browser with a bounded low-latency Web Audio queue. The default scrcpy
  output source silences playback on Android. In **Stream → Computer audio**,
  Android 13+ users can explicitly enable duplicated device playback.
- Use **Stream** for presets or independent display, resolution/max dimension,
  video codec/encoder/bitrate/FPS/I-frame/crop, audio codec/encoder/bitrate/
  buffer/volume, physical/compatibility mouse mode and sensitivity, renderer,
  decoder acceleration, orientation, tunnel, and scrcpy compatibility controls.
  Settings are validated and saved per device; choose **Apply & restart** for
  server-side changes.
- Automatic USB reconnect and mirroring resume are enabled by default under
  **Stream → Compatibility and reconnect** and can be disabled independently.

The complete setting ranges, defaults, and application behavior are documented
in [docs/SETTINGS.md](docs/SETTINGS.md).

The video control surface is resized with `contain` semantics. Rendering and
hit-testing share the same padding-free viewport, and each event is mapped
against the contained rectangle of the live decoder frame rather than the
outer CSS box. Browser scaling, fullscreen, letterboxing, arbitrary aspect
ratios, and orientation changes therefore do not require resolution-specific
settings.

### Game mappings

1. Open **Mappings** and choose **Edit**.
2. Add a control type.
3. Drag its marker over the corresponding Android on-screen control.
4. Select the marker or layer and configure its key, mouse button, duration,
   joystick radius/smoothing, orientation, or mouse-look sensitivity.
5. Choose **Play**. Mapped keys now execute controls, unmapped keys continue to
   Android by default, and ordinary mouse/touch/scroll input remains available
   unless a configured mouse mapping intentionally captures it.
6. Click the video when a mouse-look mapping is active to enter Pointer Lock.
   Mouse-look is an explicit touch-emulation mapping: when its synthetic swipe
   reaches the configured recenter radius it lifts, begins again at the center,
   and applies the remaining relative delta without a circular movement limit.
7. Press the profile’s emergency key (default: `Escape`) at any time. The engine
   immediately emits UP for every synthetic touch, clears timers/key state,
   exits Pointer Lock, and returns to Edit.

WASD diagonals are normalized to the configured radius. The radius is stored as
a fraction of the shorter video edge and converted independently on each axis,
so the virtual stick remains physically circular on any aspect ratio.

Play captures mapped keys and suppresses their browser defaults. Supported
unmapped keys always pass directly to Android while the video owns keyboard
focus. Mouse buttons are captured only by an active mapping for the current
orientation; ordinary clicks, drags, and scrolling continue to Android.
Browsers and operating systems reserve a few security shortcuts that a page
cannot override; see [known limitations](docs/KNOWN_LIMITATIONS.md).

### Profiles

Profiles are named sets of mappings and their control preferences. They are
stored locally in IndexedDB; if IndexedDB is unavailable, the repository falls
back to localStorage. No profile leaves the browser unless the user downloads
its JSON.

- **Profiles → Save current mappings** explicitly saves the active control set.
- Create, rename, switch, duplicate, and delete profiles from the same panel.
- **Profiles → Export JSON** downloads the current versioned profile.
- **Profiles → Import JSON** accepts one or more files and validates every
  field and normalized coordinate before saving.
- Persisted import controls choose copy/replace/skip on ID collision, whether
  to activate the last imported profile, whether a batch continues after an
  invalid file, and a 1–50 MB per-file limit. The default creates copies with
  new profile and mapping IDs.

See [the profile format](docs/PROFILE_SCHEMA.md), the machine-readable
[JSON Schema](docs/profile.schema.json), and
[the example shooter profile](examples/profiles/battle-royale.json).

## Development

Node.js 22.13 or newer is recommended. All npm scripts use Node process APIs,
not POSIX shell syntax, so the required workflow is the same on Windows,
macOS, and Linux.

The lockfile uses the newest compatible stable releases. ESLint remains on the
latest 9.x release because the current Next lint plugins do not yet accept
ESLint 10, and TypeScript remains on 5.9 because the current Vinext/Sites
toolchain is not compatible with the native TypeScript 7 CLI. The Vinext 1.0
channel is still beta and is intentionally not treated as a stable upgrade.
Package overrides lift Next’s pinned PostCSS and optional Sharp copies to
compatible patched releases; `npm audit --omit=dev` reports zero known
production vulnerabilities for this lockfile.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Localhost counts as a secure context for
WebUSB.

Verification:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` runs the deterministic Vitest suite. `npm run build` first produces
and validates the hosted Vinext/Sites artifact in `dist/`, then produces the
portable static application in `dist-static/`.

## Production building

```sh
npm install
npm test
npm run typecheck
npm run build
```

Deploy the contents of `dist-static/` as the web root. The output uses relative
asset URLs, so it works at a domain root or a repository subpath. Do not remove
`dist-static/vendor/scrcpy-server-v3.3.3`.

### Vercel

OpenDroid Remote is natively compatible with Vercel zero-configuration deployments.

1. Connect your repository to Vercel.
2. Vercel automatically detects Next.js framework configuration (`vercel.json`) and runs `npm run build`.
3. The build script auto-detects the Vercel deployment environment and compiles the Next.js production build.

Alternatively, build manually for Next.js / Vercel targets:

```sh
npm run build:next
```

### GitHub Pages

The included `.github/workflows/pages.yml` tests, builds, and publishes
`dist-static/`. In the repository settings, select **GitHub Actions** as the
Pages source, then push the default branch.

For a manual Pages upload, publish `dist-static/` with any static Pages action
or copy it to the branch/folder configured as the Pages source.

### Cloudflare Pages

Configure:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist-static` |
| Node version | `22.13` or newer |

No Pages Functions or runtime bindings are needed.

### Other static hosting

Upload `dist-static/` unchanged. The site must be HTTPS and must not send a
`Permissions-Policy` header that disables `usb` for the page. A server component
is neither generated nor required for this target.

## Architecture

| Layer | Main modules | Responsibility |
| --- | --- | --- |
| WebUSB / ADB | `src/adb/AdbAuthentication.ts`, `WebUsbAdbTransport.ts`, `StableAdbCredentialStore.ts`, `deviceIdentity.ts`, `connectionPresentation.ts` | Saved-key/public-key handshake, device chooser, committed mirrored RSA key ring, serial-keyed concurrent transports, automatic reconnect and consistent per-device status |
| scrcpy | `src/scrcpy/ScrcpySession.ts`, `PcmAudioPlayer.ts`, `ScrcpyControlAdapter.ts`, `UhidMouseDevice.ts` | Server integrity/push, session startup, decoder/renderer, bounded raw/compressed browser audio, physical UHID mouse reports, retry loop, clipboard and ordered control writes |
| Capabilities | `src/capabilities/` and `src/scrcpy/codecNegotiation.ts` | Browser APIs/codecs, Android displays, focused display adapters, encoders, negotiation |
| Coordinates | `src/coordinates/CoordinateTransform.ts` | Contain-fit, normalized/client/video/crop conversion, rotation and orientation |
| Game input | `src/input/` | Keyboard state, pointer allocation, multi-touch registry, mapping executor, joystick and browser input mapping |
| Profiles | `src/profiles/` | Strong schema, defensive parser, IndexedDB/localStorage repository |
| Settings | `src/settings/AppSettings.ts` | Versioned validation, per-device stream overrides, reconnect and profile-import preferences |
| Diagnostics | `src/debug/Diagnostics.ts` | Sanitized, bounded, exportable local event stream |
| UI | `src/App.tsx`, `src/ui/`, `app/globals.css` | Connection workbench, video surface, overlays, editor, profiles, quality and debug panels |

The full design and cleanup model are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Compatibility workarounds are capability adapters in
`src/capabilities/androidAdapters.ts`. They are ordered by detected command
availability and parsed output shape, never by manufacturer or model name.

## Diagnostics and troubleshooting

Open **Debug** to inspect or export:

- secure-context and browser API checks
- authorized WebUSB enumeration and chooser events
- ADB open/authentication/disconnection details
- scrcpy server digest, push, startup attempts, and server output
- display discovery and focused-display adapter results
- Android encoders and browser codec probes
- WebGL/bitmap renderer choice and decoder failures
- clipboard and ordered control-channel write failures

Common fixes:

| Symptom | Action |
| --- | --- |
| Device absent from chooser | Confirm the cable carries data, USB debugging is enabled, and the Android ADB interface/driver is visible to the host |
| “USB interface is busy” | Stop native ADB/scrcpy/Android Studio device tools and close other browser tabs using the device |
| Verifying saved authorization | This is the normal saved-key handshake, not a request for a popup. An already-trusted device continues automatically. If the USB session is stale, OpenDroid reopens it with the same identity |
| Waiting for USB debugging approval | Android explicitly rejected the saved signatures and requested the browser public key. Unlock Android and accept the RSA dialog |
| Authorization timeout | Unlock Android, accept the RSA dialog, or revoke USB debugging authorizations and retry |
| Authorization appears every time | Update to 1.3.1+, use the same non-private browser profile and HTTPS origin, keep site data enabled, and confirm **Always allow**. OpenDroid merges both credential mirrors, migrates legacy keys, and reuses the same key ring rather than regenerating it. Clearing site data or Android debugging authorizations necessarily removes trust |
| Cable reconnect does not resume | Keep **Automatic reconnect** and **Resume mirroring** enabled, reconnect the same authorized device, and leave the page open. For firmware without a USB serial descriptor, automatic matching is intentionally skipped when several identical candidates make the identity ambiguous |
| Immediate disconnect | Replace the cable/port, avoid unpowered hubs, and close competing USB clients. A diagnostic mentioning a stalled scrcpy reverse socket indicates an old build; update to 1.3.0 or newer |
| “scrcpy server exited prematurely” | Leave display/codec/encoder on Auto and retry. The client refreshes the Android inventories, retries through an explicit ADB forward tunnel, and preserves the Android-side server output in Debug if all attempts fail |
| Black/protected area | DRM-secure surfaces cannot be captured by scrcpy; test an ordinary app |
| Encoder fails | Leave codec and encoder on Auto, reduce maximum dimension/FPS/bitrate, and inspect startup attempts in Debug |
| No computer audio | Audio capture requires Android 11+. Click **Enable audio** if the browser blocked autoplay, keep **Stream Android audio** enabled, apply the stream settings, and inspect Audio events in Debug |
| Audio still plays on Android | Disable **Also play on Android** and apply the stream. Duplication is an explicit Android 13+ option; default output capture redirects playback to the computer |
| Dual audio stopped the session | Update to 1.3.0 or newer. Earlier builds enabled ya-webadb’s 30-second client-debugging stall assertion and ran full display probes beside the live session, which could misclassify healthy scrcpy backpressure as USB loss |
| Wrong screen | Refresh Stream capabilities and choose a discovered display; Auto never assumes display zero |
| Pointer is offset | Update to 1.2.1 or newer. Input is mapped from the exact contained video rectangle and supports page zoom, CSS scaling, fullscreen, and live decoder size changes |
| Android mouse does not move | Apply **Physical UHID** under Stream → Mouse input and inspect the UHID capability message in Debug. If Android blocks `/dev/uhid`, choose SDK compatibility explicitly or use touch/mappings |
| Mouse stops at a desktop edge | Click the video to enter Pointer Lock. The Mouse status changes to **captured**; press Esc to release it |
| Stuck mapping touch | Press the emergency key. Window blur, page hide, profile/orientation changes, disconnect, and Edit-mode entry also release synthetic touches |
| Clipboard denied | Use a user-initiated Paste/Copy button and grant the browser clipboard permission |

More detail is in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Security and privacy

- The browser requests only a user-selected ADB-capable USB device.
- ADB private keys are generated and stored by the ya-webadb browser credential
  store on this origin.
- The scrcpy server binary is pinned and SHA-256 verified before every first
  push for an ADB connection.
- No analytics, remote API calls, fonts, advertisements, accounts, or relays
  are present in the application bundle.
- Diagnostics stay in memory until exported. They can include Android banner
  and USB descriptor information, so review an exported file before sharing it.
- Profiles stay in origin-local browser storage until explicitly exported.

## Tests

The suite covers:

- contain-fit, letterboxing, crop endpoints, arbitrary dimensions and all four
  quarter-turn orientations
- raw PCM stereo decoding, signed sample conversion, and split-packet carry
- keyboard press/repeat/release state
- pointer exhaustion, release, and reuse
- simultaneous touch DOWN/MOVE/UP and failure rollback
- serial-keyed concurrent ADB connections, independent disconnect, duplicate
  device labels, stable-key reuse, real-approval detection, stale-handshake
  retry, and mixed-device status priority
- mouse-wheel pixel/line/page normalization and clamping
- upstream UHID descriptor registration, fractional/large relative motion,
  five-button state, two-axis wheel reports, cleanup, disabled-mode isolation,
  and SDK hover compatibility
- joystick cardinal/opposing/diagonal vectors, aspect-correct radii and smoothing
- timed tap, repeated tap, swipe animation, hold, joystick, mouse-look,
  orientation filtering, and emergency mapping execution
- Edit/Play keyboard routing, intentional mouse-capture decisions, continuous
  mouse-look recentering, and concurrent relative-delta serialization
- profile round-trip, malformed input rejection, all mapping types, and the
  shipped example
- focused-display adapters, resolution parsing, codec/encoder ordering, and
  serializable diagnostics

Real USB and video startup require a physical Android device and a browser user
gesture, so they are exercised through the built-in integration diagnostics
rather than mocked in the production path.

Release history is maintained in [CHANGELOG.md](CHANGELOG.md).

## Upstream versions

Runtime dependencies are exact-pinned in `package.json`:

- `@yume-chan/adb` 2.6.2
- `@yume-chan/adb-daemon-webusb` 2.3.2
- `@yume-chan/adb-scrcpy` 2.3.2
- `@yume-chan/scrcpy` 2.3.0
- `@yume-chan/scrcpy-decoder-webcodecs` 2.5.3
- scrcpy server 3.3.3, the server protocol supported by that stable ya stack

When upgrading, update the packages, server binary, digest, license notice,
tests, and compatibility matrix together. Do not substitute a newer scrcpy
server until the ya-webadb options/protocol package supports it.

## License

OpenDroid Remote is available under the [MIT License](LICENSE). The bundled
scrcpy server is Apache-2.0; see [third-party notices](THIRD_PARTY_NOTICES.md).
