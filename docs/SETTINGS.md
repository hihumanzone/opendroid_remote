# Stream, reconnect, and import settings

Application settings use schema version 1 and are stored locally under the
current HTTPS origin. The runtime parser validates every enum, number, string,
and per-device entry before use. Invalid or unsupported saved values fall back
individually to the automatic defaults.

Stream settings edited while a device is active are saved as an override for
that stable ADB serial. **Reset device override** removes that entry and reloads
the global automatic defaults. Computer volume changes immediately; settings
that affect the scrcpy server, media codec, decoder, renderer, or tunnel take
effect after **Apply & restart**.

## Video

| Setting | Default | Accepted values / behavior |
| --- | --- | --- |
| Performance preset | Balanced values | Low latency, Balanced, and High quality update the related fields once; afterward every field remains independently editable |
| Source display | Auto | Focused display when discovered, the only reported display, or no explicit ID so scrcpy selects its default |
| Maximum dimension | 1920 px | 0 (native/unlimited) through 8192; presets provide 1280, 1920, 2560, and 3840 |
| Video codec | Auto | H.264, H.265, or AV1 only when browser and Android capabilities support it |
| Android video encoder | Negotiated default | Runtime list returned by scrcpy, filtered to the selected codec |
| Video bitrate | 8 Mbps | 0.1–100 Mbps in persisted validation; the UI slider covers 0.5–50 Mbps |
| Frame limit | 60 fps | 0 (unlimited) through 240 |
| I-frame interval | Android default | Empty, or 0–60 seconds; serialized as the upstream codec option |
| Crop | None | `width:height:x:y`, with positive dimensions and non-negative origin |
| Capture orientation | Follow Android | Follow Android, lock initial, or lock 0°, 90°, 180°, or 270° |

The preset names describe the maximum encoded dimension, not a forced display
resolution or aspect ratio. scrcpy scales proportionally and the browser
continues to render with contain semantics.

## Audio

| Setting | Default | Accepted values / behavior |
| --- | --- | --- |
| Stream to computer | On | Android 11+ capture; video/control remain available if capture is unavailable |
| Audio codec | Auto (raw PCM) | Raw PCM, Opus, AAC, or FLAC. Compressed choices are enabled only after `AudioDecoder.isConfigSupported` succeeds |
| Android audio encoder | Negotiated default | Runtime scrcpy encoder list for the selected compressed codec |
| Compressed bitrate | 128 kbps | 16–1000 kbps in persisted validation; the UI slider covers 32–512 kbps. Raw PCM ignores this field |
| Playback buffer | 60 ms | 20–500 ms in persisted validation; the UI slider covers 20–250 ms |
| Computer volume | 90% | 0–100%; applied without restarting |
| Also play on Android | Off | Android 13+ playback capture plus scrcpy `audioDup`; individual apps may deny capture |

Raw audio is interleaved 48 kHz, signed 16-bit stereo PCM. Opus/AAC/FLAC use
WebCodecs `AudioDecoder`, and decoded frames feed the same bounded Web Audio
queue. If browser throttling lets the queue exceed its target by a guarded
margin, stale queued sound is dropped instead of increasing control latency.

## Browser decoder and renderer

| Setting | Default | Accepted values / behavior |
| --- | --- | --- |
| Renderer | Auto | WebGL with bitmap fallback, require WebGL, or bitmap |
| Decoder acceleration | Browser automatic | No preference, prefer hardware, or prefer software; passed to WebCodecs |

Requiring WebGL produces a clear startup error if WebGL cannot be constructed.
Preferences are capability requests; the browser and operating system retain
final decoder-placement control.

## Mouse input

| Android mouse mode | Physical UHID | **Physical UHID** registers a relative five-button kernel HID mouse; **Touchscreen tap** converts clicks/drags directly to touch taps with zero hover detection; **SDK compatibility** explicitly uses scrcpy absolute hover/button/scroll injection; **Disabled** forwards no ordinary desktop mouse input while touch and configured mappings remain available |
| Physical sensitivity | 1× | 0.1–4×; applied before relative deltas are split into signed HID reports, with fractional movement retained between reports |
| Unadjusted browser movement | On | Requests raw/unadjusted Pointer Lock first and retries normal Pointer Lock if unsupported |

Physical mode is enabled only after the Android ADB shell successfully
opens/closes `/dev/uhid`. If that probe fails, the stream still starts but
direct mouse input remains disabled; the app does not silently select the SDK
path. A late UHID creation failure triggers one clean scrcpy restart with mouse
disabled because the failed create may have ended the old controller thread.

Clicking the video in physical mode enters Pointer Lock for continuous relative
movement, including fullscreen. Press Esc to exit. Left, right, middle, Back,
Forward, vertical wheel, and horizontal wheel state are forwarded when the
browser and Android app expose them.

## scrcpy compatibility and reconnect

| Setting | Default | Accepted values / behavior |
| --- | --- | --- |
| ADB tunnel | Auto | Automatic reverse/forward retry, prefer reverse, or force forward |
| Downsize on encoder error | On | Lets scrcpy reduce an unsupported requested size |
| Wake on start | On | Requests `powerOn` at session startup |
| Stay awake while plugged in | Off | Requests scrcpy `stayAwake` |
| Visualize injected touches | Off | Requests Android `showTouches` |
| Clipboard autosync | On | Enables scrcpy clipboard messages; browser permission still applies |
| Automatic reconnect | On | Keeps a reconnect intent after an unexpected physical USB loss |
| Resume mirroring | On | Restarts the prior per-device stream after ADB re-authenticates |

Automatic reconnect never invokes the browser chooser. It is limited to a
device already selected and connected in the current page lifetime. A USB
serial is matched exactly. For firmware that omits the serial descriptor, a
session object/fingerprint match is used only when one candidate and one
reconnect intent make the pairing unambiguous.

## ADB identity persistence

`StableAdbCredentialStore` loads all legacy keys from ya-webadb’s `Tango`
credential store, deduplicates them, and migrates them into a dedicated
OpenDroid key ring. The complete ring is mirrored in IndexedDB and
localStorage. Authentication tries the stable primary key and then every
legacy key, so an Android device that trusted any retained key can accept a
signature without displaying a new authorization dialog.

Generation is serialized and occurs only when no key exists. Reconnect never
rotates the identity. The app also requests Storage Manager persistence when
the browser supports it. Browser data deletion, private browsing, a changed
origin/profile, or Android-side authorization revocation cannot be bypassed and
will require approval again.

## Profile import

| Setting | Default | Accepted values / behavior |
| --- | --- | --- |
| ID collision | Create a copy | Create new profile/mapping IDs, replace the existing profile, or skip it |
| Activate after import | On | Switch to the last successfully imported profile |
| Batch error handling | Continue | Continue after an invalid file, or stop at the first error |
| Maximum file size | 2 MB | 1, 2, 5, 10, 25, or 50 MB per JSON file |
| File selection | Multiple allowed | `.json` or `application/json`; each file must pass the complete profile schema validator |

Imports and exports contain mapping profiles only. Stream and connection
settings remain local application preferences and are not silently embedded in
a game profile.
