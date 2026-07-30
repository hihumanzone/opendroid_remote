# Compatibility and capability matrix

OpenDroid Remote selects behavior from runtime capabilities. It contains no
manufacturer, model, fixed resolution, fixed DPI, navigation-mode, display-ID,
or operating-system branches.

## Browser APIs

| Capability | Required | Used for | Fallback |
| --- | --- | --- | --- |
| Secure context (HTTPS or localhost) | Yes | WebUSB, clipboard permission model, Web Crypto | None |
| WebUSB (`navigator.usb`) | Yes | Direct Android ADB USB transport | None; no native/backend bridge is included |
| WebCodecs `VideoDecoder` | Yes | Low-latency scrcpy H.264/H.265/AV1 decoding | Codec candidates are probed individually; no non-WebCodecs video decoder |
| WebCodecs `AudioDecoder` | For compressed audio | Opus/AAC/FLAC decoding | Auto/raw uses Web Audio PCM; unsupported compressed choices are disabled |
| Web Audio `AudioContext` | For computer audio | Plays scrcpy raw PCM through the host | Video/control remain available; audio capture is disabled so the device is not muted without host playback |
| Web Crypto `subtle` | Yes | SHA-256 server verification and browser credential support | None |
| Pointer Events | Yes | Mouse, pen, direct touch, independent browser touch contacts | None |
| WebGL | No | Preferred low-overhead video renderer | Bitmap renderer |
| Pointer Lock | For unbounded physical mouse or mouse-look | Captured relative motion without a desktop screen edge; unadjusted movement is requested when supported | Uncaptured UHID movement works while the cursor remains over the video; SDK mode remains absolute |
| Fullscreen API | No | Fullscreen video workspace | Normal responsive layout |
| Async Clipboard read/write | No | Desktop ↔ Android clipboard buttons/autosync | Direct text injection remains available |
| IndexedDB | No | Primary profile persistence and one ADB-key-ring mirror | Profiles fall back to localStorage; the ADB ring also has a localStorage mirror |
| localStorage | No | Versioned settings, profile fallback, second ADB-key-ring mirror | Current in-memory state remains usable but cannot survive reload |
| Storage Manager `persist()` | No | Best-effort protection against eviction of the saved ADB identity | Normal origin storage policy; credential reuse still works while site data remains |
| ResizeObserver | Yes in supported Chromium | Live contain-fit and coordinate updates | No legacy polyfill |

## Desktop host matrix

| Host/browser family | Expected status | Notes |
| --- | --- | --- |
| Current Google Chrome on Windows/macOS/Linux | Supported when WebUSB is enabled | HTTPS/localhost; OS must expose the ADB USB interface |
| Current Microsoft Edge on Windows/macOS/Linux | Supported when WebUSB is enabled | Enterprise policy can disable WebUSB |
| Current compatible Chromium/Brave builds | Capability-dependent | Product privacy settings may disable WebUSB or WebCodecs |
| ChromeOS Chrome | Capability-dependent | USB access and administrator policy must allow the device |
| Firefox desktop | Unsupported | No WebUSB |
| Safari desktop | Unsupported | No WebUSB |
| Mobile browsers | Unsupported host | The product is designed for a desktop/laptop input host |

The in-app Debug panel is authoritative for a particular browser build and
policy configuration.

## Android requirements

| Android capability | Requirement/behavior |
| --- | --- |
| ADB over USB | Required; USB debugging must be enabled and authorized |
| ADB authorization reuse | Android must retain the host public key; OpenDroid retains/migrates the matching browser private key without rotating it |
| Stable identity | USB serial when exposed; otherwise a collision-free browser-session ID is upgraded to `ro.serialno`/`ro.boot.serialno` after ADB authentication |
| Root | Not required |
| Companion APK | Not used |
| scrcpy server execution | Required; pushed to the standard temporary path through authenticated ADB |
| Video encoder | At least one scrcpy-advertised encoder for a browser-supported codec |
| Audio encoder | Optional; raw PCM needs no compressed encoder. Opus/AAC/FLAC choices use a matching runtime-advertised/default encoder and browser decoder |
| Display capture | The chosen display must be capturable by Android’s media projection/display APIs |
| Control injection | Required for touch/key control; the device may impose policy restrictions |
| Physical mouse (UHID) | Preferred direct mouse path. The ADB shell identity must be able to open `/dev/uhid`; OpenDroid probes this at runtime and registers a five-button relative HID mouse without root |
| SDK mouse compatibility | Optional explicit fallback with absolute hover/button/scroll injection. Some Android/app combinations can interpret a primary click as touch-compatible, so it is never selected silently |
| Audio capture | Optional; Android 11+ for computer playback. Android 11 must be unlocked when capture starts; Android 12+ normally works immediately |
| Device/host audio duplication | Optional; Android 13+ `playback` capture with scrcpy `audioDup`. Individual apps may opt out of playback capture |
| Android version | Determined by the bundled upstream scrcpy 3.3.3 server’s supported range; Android 5.0+ is the normal upstream video baseline, with feature availability varying by release/OEM policy |
| Resolution/DPI/aspect | Discovered at runtime; not constrained or hardcoded |
| Orientation | Decoder dimensions are watched live; profile applicability and transforms update automatically |
| Navigation mode | Irrelevant; Back/Home/Recents are injected key events |

## Display handling

1. `AdbScrcpyClient.getDisplays` asks the active scrcpy server for its current
   display list.
2. Capability adapters try supported `dumpsys` shapes to identify the focused
   display. The first parsed result that is also present in the scrcpy list is
   recommended.
3. If exactly one display exists, it is recommended regardless of its numeric
   ID.
4. If focus cannot be discovered and several displays exist, Auto omits
   `displayId` so the scrcpy server chooses its own default. Display zero is
   never invented.
5. While streaming, a lightweight focused-display adapter checks for a change
   every eight seconds. Full one-shot scrcpy discovery runs only after focus
   moves to an unknown display or when the user chooses **Refresh**, avoiding
   competing media sockets beside a stable session. The lifecycle queue stops
   and releases the current stream before that discovery process, then resumes
   it with the refreshed inventory. If an explicitly selected display
   disappears, the stream restarts on the newly recommended/server-default
   display.

Physical, virtual, mirrored, secondary, and dynamically created displays use
the same discovery path. Whether a particular Android build can encode or
inject control into a display is reported by scrcpy startup/control diagnostics.

## Codec and encoder negotiation

The browser probes representative H.264, H.265/HEVC, and AV1
`VideoDecoderConfig` values. The client intersects those results with the
encoders returned by Android.

Auto order is:

1. H.264 with Android’s negotiated default encoder
2. Explicit H.264 encoders, hardware-ranked first
3. H.265 default and explicit encoders
4. AV1 default and explicit encoders

Each failed startup or first-frame decode is cleaned up before the next
candidate. Every codec candidate first uses ya-webadb's automatic
reverse-to-forward tunnel negotiation and then an explicit ADB forward tunnel.
This fallback is selected by connection behavior, not host OS or device model.
A user-forced codec or encoder narrows the candidates and never silently
crosses to a different codec.

When Android returns a usable encoder inventory, Auto mode never guesses a
codec absent from that inventory. If listing itself is unavailable, the client
retains server-default codec fallbacks so a nonessential query failure does not
prevent streaming.

The renderer attempts WebGL first and constructs a bitmap renderer if WebGL
initialization fails.

Audio Auto resolves to raw PCM for the broadest compatibility. Opus, AAC, and
FLAC are enabled only when `AudioDecoder.isConfigSupported` succeeds in the
current browser. Browser support does not guarantee that every Android build
exposes a working encoder; startup diagnostics preserve the Android-side
failure.

## Compatibility adapters

Unavoidable Android output variability is isolated in
`src/capabilities/androidAdapters.ts`. Adapters are keyed by:

- whether a standard ADB shell command succeeds
- whether its output exposes a recognized capability field
- whether the ADB shell identity can actually open `/dev/uhid`

They are not keyed by vendor, device model, Android marketing version, screen
size, or presumed display ID.
