import { describe, expect, it } from "vitest";

import {
  parseFocusedDisplayId,
  parseResolution,
  parseUhidProbe,
} from "../src/capabilities/androidAdapters";
import { Diagnostics } from "../src/debug/Diagnostics";
import {
  buildCodecCandidates,
  buildStartupAttempts,
} from "../src/scrcpy/codecNegotiation";
import { createDiscoveryOptions } from "../src/scrcpy/sessionOptions";
import { AdbScrcpyExitedError } from "@yume-chan/adb-scrcpy";

describe("display discovery adapters", () => {
  it.each([
    ["mTopFocusedDisplayId=4", 4],
    ["mFocusedDisplayId = 12", 12],
    ["topFocusedDisplayId=7", 7],
    ["mCurrentFocus=Window{abc displayId=9}", 9],
  ])("parses focused display output %s", (output, expected) => {
    expect(parseFocusedDisplayId(output)).toBe(expected);
  });

  it("does not invent display zero when Android exposes no focused display", () => {
    expect(parseFocusedDisplayId("DisplayFrames w=2400 h=1080")).toBeUndefined();
  });

  it("parses arbitrary reported resolutions defensively", () => {
    expect(parseResolution(" 3440 x 1440 ")).toEqual({
      width: 3440,
      height: 1440,
    });
    expect(parseResolution("unknown")).toBeUndefined();
    expect(parseResolution("0x1080")).toBeUndefined();
  });

  it("only enables UHID after Android confirms the shell can open it", () => {
    expect(parseUhidProbe("uhid-ok")).toEqual({
      supported: true,
      reason: "Android allowed the ADB shell identity to open /dev/uhid.",
    });
    expect(parseUhidProbe("uhid-unavailable").supported).toBe(false);
  });
});

describe("codec and encoder negotiation", () => {
  const encoders = [
    {
      codec: "h264" as const,
      name: "software.avc",
      hardwareType: "software" as const,
    },
    {
      codec: "h264" as const,
      name: "hardware.avc",
      hardwareType: "hardware" as const,
    },
    {
      codec: "h265" as const,
      name: "hardware.hevc",
      hardwareType: "hardware" as const,
    },
  ];

  it("prefers reliable H.264 auto negotiation and ranks hardware first", () => {
    expect(
      buildCodecCandidates(
        encoders,
        { h264: true, h265: true, av1: false },
        "auto",
      ),
    ).toEqual([
      {
        codec: "h264",
        reason: "h264 with Android's negotiated default encoder",
      },
      {
        codec: "h264",
        encoder: "hardware.avc",
        reason: "h264 via hardware.avc (hardware)",
      },
      {
        codec: "h264",
        encoder: "software.avc",
        reason: "h264 via software.avc (software)",
      },
      {
        codec: "h265",
        reason: "h265 with Android's negotiated default encoder",
      },
      {
        codec: "h265",
        encoder: "hardware.hevc",
        reason: "h265 via hardware.hevc (hardware)",
      },
    ]);
  });

  it("honors an explicitly requested codec and encoder", () => {
    expect(
      buildCodecCandidates(
        encoders,
        { h264: true, h265: true, av1: true },
        "h265",
        "hardware.hevc",
      ),
    ).toEqual([
      {
        codec: "h265",
        encoder: "hardware.hevc",
        reason: "h265 via hardware.hevc (hardware)",
      },
    ]);
  });

  it("returns no invalid fallback when the browser cannot decode a codec", () => {
    expect(
      buildCodecCandidates(
        encoders,
        { h264: false, h265: false, av1: false },
        "auto",
      ),
    ).toEqual([]);
  });

  it("does not guess an Android codec missing from a successful inventory", () => {
    expect(
      buildCodecCandidates(
        encoders,
        { h264: true, h265: true, av1: true },
        "auto",
      ).some((candidate) => candidate.codec === "av1"),
    ).toBe(false);
  });

  it("retains default codec fallbacks when Android inventory is unavailable", () => {
    expect(
      buildCodecCandidates(
        [],
        { h264: true, h265: false, av1: true },
        "auto",
      ).map((candidate) => candidate.codec),
    ).toEqual(["h264", "av1"]);
  });

  it("retries each codec through an explicit ADB forward tunnel", () => {
    const candidates = buildCodecCandidates(
      [],
      { h264: true, h265: false, av1: false },
      "auto",
    );
    expect(buildStartupAttempts(candidates)).toEqual([
      {
        candidate: candidates[0],
        tunnelForward: false,
        tunnelLabel: "automatic reverse/forward tunnel",
      },
      {
        candidate: candidates[0],
        tunnelForward: true,
        tunnelLabel: "forced ADB forward tunnel",
      },
    ]);
  });

  it("honors explicit tunnel compatibility settings", () => {
    const candidates = buildCodecCandidates(
      [],
      { h264: true, h265: false, av1: false },
      "auto",
    );
    expect(buildStartupAttempts(candidates, "forward")).toEqual([
      {
        candidate: candidates[0],
        tunnelForward: true,
        tunnelLabel: "forced ADB forward tunnel",
      },
    ]);
    expect(buildStartupAttempts(candidates, "reverse")).toEqual([
      {
        candidate: candidates[0],
        tunnelForward: false,
        tunnelLabel: "preferred ADB reverse tunnel",
      },
    ]);
  });
});

describe("diagnostic tooling", () => {
  it("exports serializable local startup and control diagnostics", () => {
    const diagnostics = new Diagnostics();
    diagnostics.info("webusb", "chooser", "USB chooser opened");
    diagnostics.error(
      "scrcpy",
      "startup",
      "Encoder failed",
      new Error("codec error"),
    );
    const exported = JSON.parse(diagnostics.export()) as {
      schemaVersion: number;
      entries: Array<{ category: string; details?: { message?: string } }>;
    };
    expect(exported.schemaVersion).toBe(1);
    expect(exported.entries).toHaveLength(2);
    expect(exported.entries[1]!.details?.message).toBe("codec error");
  });

  it("preserves scrcpy server output attached to startup errors", () => {
    const diagnostics = new Diagnostics();
    diagnostics.error(
      "scrcpy",
      "startup",
      "Server stopped",
      new AdbScrcpyExitedError([
        "[server] INFO: Device: Android",
        "[server] ERROR: Encoder not found",
      ]),
    );
    const exported = JSON.parse(diagnostics.export()) as {
      entries: Array<{ details?: { output?: string[] } }>;
    };
    expect(exported.entries[0]!.details?.output).toEqual([
      "[server] INFO: Device: Android",
      "[server] ERROR: Encoder not found",
    ]);
  });
});

describe("scrcpy server lifecycle options", () => {
  it("keeps the pushed server between consecutive capability queries", () => {
    const displayOptions = createDiscoveryOptions();
    displayOptions.setListDisplays();
    expect(displayOptions.serialize()).toContain("cleanup=false");

    const encoderOptions = createDiscoveryOptions();
    encoderOptions.setListEncoders();
    expect(encoderOptions.serialize()).toContain("cleanup=false");
  });

  it("retains info output required by the capability parsers", () => {
    expect(createDiscoveryOptions().serialize()).toContain("log_level=info");
  });
});
