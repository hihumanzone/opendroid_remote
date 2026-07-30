# Known limitations

- WebUSB is not implemented by Firefox or Safari. Chromium policy, privacy
  settings, or enterprise administration can also disable it.
- Host USB permissions and drivers still apply. Windows may require a suitable
  ADB/WinUSB driver; Linux may require USB permission rules. These are not
  application runtime components.
- Native ADB, Android Studio, native scrcpy, another tab, or another WebUSB app
  can exclusively claim the Android USB interface.
- The browser device chooser requires a user gesture. A site cannot silently
  connect a never-authorized device.
- Android’s RSA authorization dialog must be accepted on the unlocked device.
- ADB trust is specific to the Android authorization database, browser profile,
  and HTTPS origin. Clearing site data, using private browsing, changing
  origins, revoking USB debugging authorizations, or some enterprise cleanup
  policies necessarily causes Android to ask again.
- Automatic cable reconnect operates while the page remains open and only for
  a device that was already connected. It cannot bypass the browser chooser
  for a never-authorized USB interface.
- Multiple ADB transports can remain connected simultaneously, but this
  release presents one active scrcpy video/control workspace at a time.
  Selecting another ADB-ready serial switches the workspace without
  reauthorizing or closing the other transports.
- WebUSB cannot provide a stable pre-connection identity if firmware omits its
  USB serial descriptor. OpenDroid keeps identical devices separate with
  session-scoped provisional IDs and upgrades each connection from Android’s
  serial property after authentication. A page reload may require reconnecting
  such a serial-less device before its stable Android identity is known again.
  During live automatic reconnect, an ambiguous group of multiple identical
  serial-less devices is deliberately not paired by guesswork.
- DRM-secure video surfaces, banking/protected windows, and policy-restricted
  displays can appear black or refuse capture.
- Some virtual or secondary displays can be listed but not encoded or
  controlled by a particular Android build. The client retries compatible
  codec/encoder choices but cannot bypass platform policy.
- WebCodecs codec availability depends on browser build, operating-system media
  support, hardware, and policy. Auto mode starts with H.264 for broad
  compatibility.
- Compressed audio additionally depends on WebCodecs `AudioDecoder` and a
  compatible Android encoder. Auto audio uses raw PCM; selecting Opus, AAC, or
  FLAC can narrow compatibility even when the browser probe succeeds.
- Computer audio forwarding requires Android 11 or newer. Android 11 must be
  unlocked when capture starts; older versions continue with video/control and
  report audio as unavailable.
- Browser autoplay policy may leave Web Audio suspended until **Enable audio**
  is clicked. The app continues draining the stream and resumes future packets,
  but it cannot synthesize a browser user gesture.
- Device-local playback is off by default while output audio is forwarded.
  Explicit host/device duplication requires Android 13+ and an app that permits
  playback capture; protected apps may remain silent or play only locally.
- Browser/OS-reserved shortcuts such as task switching, secure-attention
  sequences, and some address-bar/window shortcuts may execute before a page
  receives them. The client suppresses cancelable inputs only when an active
  mapping owns them; supported unmapped keys are forwarded while the video
  surface has focus.
- Physical-mouse semantics require Android to expose `/dev/uhid` to the ADB
  shell identity. Some older, vendor-restricted, work-profile, or
  enterprise-managed builds deny it. OpenDroid then leaves direct mouse input
  disabled; the user may explicitly select SDK compatibility, whose primary
  click can be touch-compatible on some Android/app combinations.
- Pointer Lock requires a user gesture and can be denied by browser or
  administrator policy. Without it, UHID movement remains relative but stops
  when the desktop cursor leaves the video. Leaving Pointer Lock releases held
  physical buttons and ends every active mouse-look touch.
- Browsers may reject unadjusted Pointer Lock because of platform support or
  permission policy. OpenDroid retries ordinary Pointer Lock, which remains
  continuous but may include operating-system mouse acceleration.
- Five UHID buttons and horizontal/vertical wheel axes are reported. Android,
  an individual app, the host pointing device, or browser may expose fewer
  buttons or ignore horizontal scrolling.
- UHID is a system-level physical input device, so Android—not scrcpy—routes it
  to the currently focused/input-associated display. Capturing a secondary or
  virtual display does not guarantee that Android will associate physical
  mouse input with that display.
- Physical keyboard injection follows `KeyboardEvent.code` (physical key
  position). Complex IME composition and some international text layouts are
  better sent with the Text or Paste controls.
- Clipboard access is permission- and user-gesture-dependent. Android-to-host
  automatic writes can be denied when the page is unfocused; the Copy button
  retries under a user gesture.
- Browser page zoom and accessibility transforms are supported through the
  contained rendered-video rectangle, but third-party CSS injection that
  transforms the canvas independently of its control surface can invalidate
  coordinates.
- Static hosting must preserve the scrcpy server binary and allow same-origin
  fetches. A restrictive `Permissions-Policy: usb=()` header disables WebUSB.
- A browser refresh stops the active ADB/scrcpy session. Previously authorized
  devices, the mirrored ADB key ring, per-device settings, and profiles remain
  available for reconnect.
- A device may reject both ADB reverse and forward socket setup because of
  firmware or enterprise policy. The client attempts both routes and exports
  the scrcpy server's Android-side output, but it cannot override such policy.
- Automated tests cannot grant WebUSB permission or emulate a real Android
  media codec/control stack. Physical integration is observable through the
  in-app diagnostics and requires actual hardware.
