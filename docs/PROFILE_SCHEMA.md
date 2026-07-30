# Profile schema

OpenDroid profile documents are UTF-8 JSON. Version 1 stores every on-screen
position as a normalized fraction of the current decoded video surface:

- `x = 0` is the left edge and `x = 1` is the right edge.
- `y = 0` is the top edge and `y = 1` is the bottom edge.
- Joystick and mouse-look `radius` values are fractions of the video’s shorter
  edge, preserving a physically circular range at any aspect ratio.

The runtime validator rejects unknown schema versions, malformed mapping
variants, empty triggers, invalid timestamps, coordinates outside `[0, 1]`,
and impossible duration/radius/settings values.

The authoritative machine-readable definition is
[`profile.schema.json`](profile.schema.json).

## Root object

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Profile format version |
| `id` | non-empty string | Stable local/export identity |
| `name` | non-empty string | User-facing profile name |
| `game` | object, optional | Optional `title` and Android `packageName` metadata |
| `createdAt` / `updatedAt` | ISO-compatible date strings | Lifecycle timestamps |
| `reference.orientation` | `any`, `portrait`, or `landscape` | Original authoring intent |
| `reference.width` / `height` | positive numbers, optional | Informational reference dimensions; never used as fixed runtime dimensions |
| `settings.emergencyCode` | DOM `KeyboardEvent.code` | Immediate release/disable key |
| `settings.exclusiveInput` | boolean | Legacy schema-v1 field retained for import compatibility; ignored because Play always forwards unmapped input |
| `settings.overlayOpacity` | number in `[0, 1]` | Overlay opacity |
| `settings.mouseSensitivity` | positive number | Profile-level mouse-look fallback |
| `mappings` | array | Ordered visual control layers |

## Shared mapping fields

Every mapping has:

```json
{
  "id": "mapping-unique-id",
  "name": "Jump",
  "type": "tap",
  "enabled": true,
  "position": { "x": 0.78, "y": 0.78 },
  "orientation": "any"
}
```

`orientation` lets one profile contain separate controls for portrait and
landscape. A change of live orientation releases active synthetic touches
before the newly applicable layer is enabled.

## Mapping variants

### Tap

Adds `trigger: {"kind":"key","code":"Space"}` and positive `durationMs`. A
first key-down emits touch DOWN and a timer emits UP.

### Hold

Adds a key `trigger`. DOWN is held until the corresponding key-up, profile
change, orientation change, pause, blur, or disconnect.

### Repeated tap

Adds a key `trigger`, positive `intervalMs`, and positive `pressMs` where
`pressMs <= intervalMs`. Each pulse has a complete DOWN/UP lifecycle.

### Swipe / drag

Adds a key `trigger`, normalized `end`, positive `durationMs`, and
`releaseOnComplete`. MOVE events interpolate from `position` to `end`.
When `releaseOnComplete` is false, the touch remains at `end` until key-up.

### Joystick

Adds `keys.up/down/left/right`, `radius`, and `smoothing` in `[0, 1]`.
Opposing directions cancel. Diagonals are normalized, and smoothing controls
how quickly the touch approaches the target vector (`0` means immediate).

### Mouse button

Adds browser `button` (`0` primary, `1` middle, `2` secondary, `3` back,
`4` forward), `behavior` (`tap` or `hold`), and positive `durationMs`.

### Mouse-look

Adds positive `sensitivity`, normalized `radius`, and `invertX`/`invertY`.
Entering Pointer Lock begins an independent synthetic touch at `position`.
Relative motion generates MOVE events to the aspect-correct `radius`; at the
boundary the mapping emits UP, begins again at `position`, and consumes the
remaining delta. This touch-emulation mapping can therefore move continuously
without a circular dead end. Leaving Pointer Lock emits UP.

## Identity and imports

Exports preserve IDs so profiles can be versioned externally. Importing an ID
that already exists in the current origin generates a new profile ID and new
mapping IDs; it does not silently overwrite the existing profile.

See [`examples/profiles/battle-royale.json`](../examples/profiles/battle-royale.json)
for a complete, importable landscape profile.
