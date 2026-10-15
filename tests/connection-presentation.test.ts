import { describe, expect, it } from "vitest";

import {
  connectionPhaseLabel,
  deviceOptionStatus,
  dominantPendingStage,
  pendingConnectionPresentation,
  pendingDeviceLabel,
} from "../src/adb/connectionPresentation";
import type {
  AdbTransportSnapshot,
  PendingConnectionStage,
} from "../src/adb/WebUsbAdbTransport";
import { createDeviceDescriptor } from "../src/adb/deviceIdentity";

const DEVICE = createDeviceDescriptor({
  serial: "SERIAL-A",
  name: "Android",
  vendorId: 1,
  productId: 2,
});

function snapshot(
  stages: readonly PendingConnectionStage[] = [],
): AdbTransportSnapshot {
  return {
    phase: stages.includes("authorizing")
      ? "authorizing"
      : stages.includes("reconnecting")
        ? "reconnecting"
        : stages.length > 0
          ? "connecting"
          : "idle",
    devices: [DEVICE],
    connected: [],
    pending: stages.map((stage, index) => ({
      descriptor: {
        ...DEVICE,
        serial: `${DEVICE.serial}-${index}`,
      },
      stage,
      startedAt: index,
    })),
    chooserOpen: false,
  };
}

describe("connection presentation", () => {
  it("uses the highest-action pending state for mixed device connections", () => {
    const state = snapshot([
      "connecting",
      "reconnecting",
      "authenticating",
      "authorizing",
    ]);

    expect(dominantPendingStage(state)).toBe("authorizing");
    expect(pendingConnectionPresentation(state)?.headline).toBe(
      "Waiting for USB debugging approval",
    );
  });

  it("describes saved-key authentication without asking for approval", () => {
    const state = snapshot(["authenticating"]);

    expect(pendingConnectionPresentation(state)).toMatchObject({
      stage: "authenticating",
      headline: "Verifying saved USB debugging authorization",
    });
    expect(
      pendingConnectionPresentation(state)?.description,
    ).toContain("without a popup");
    expect(
      connectionPhaseLabel({
        busy: false,
        streaming: false,
        snapshot: state,
      }),
    ).toBe("Verifying saved ADB trust");
  });

  it("keeps live multi-device work visible while another device connects", () => {
    const state = snapshot(["connecting", "authenticating"]);

    expect(
      connectionPhaseLabel({
        busy: false,
        streaming: true,
        snapshot: state,
      }),
    ).toBe("Live + 2 pending");
  });

  it("provides a label for every pending lifecycle stage", () => {
    expect(
      ([
        "connecting",
        "authenticating",
        "authorizing",
        "reconnecting",
      ] as const).map(pendingDeviceLabel),
    ).toEqual([
      "Opening USB interface",
      "Checking saved ADB identity",
      "Approve on Android",
      "Cable disconnected · reconnecting automatically",
    ]);
  });

  describe("deviceOptionStatus", () => {
    it("never returns 'Live' as a suffix for the active device", () => {
      const status = deviceOptionStatus({
        serial: "DEVICE-1",
        activeSerial: "DEVICE-1",
        isConnected: true,
      });

      expect(status).toBeUndefined();
    });

    it("returns 'ADB ready' for connected non-active devices", () => {
      const status = deviceOptionStatus({
        serial: "DEVICE-2",
        activeSerial: "DEVICE-1",
        isConnected: true,
      });

      expect(status).toBe("ADB ready");
    });

    it("returns 'Reconnecting' when the device stage is reconnecting", () => {
      const status = deviceOptionStatus({
        serial: "DEVICE-2",
        activeSerial: "DEVICE-1",
        isConnected: false,
        pendingStage: "reconnecting",
      });

      expect(status).toBe("Reconnecting");
    });

    it("returns 'Connecting' for other pending stages", () => {
      const status = deviceOptionStatus({
        serial: "DEVICE-2",
        activeSerial: "DEVICE-1",
        isConnected: false,
        pendingStage: "connecting",
      });

      expect(status).toBe("Connecting");
    });

    it("returns 'Authorized' for authorized devices that are not connected or pending", () => {
      const status = deviceOptionStatus({
        serial: "DEVICE-2",
        activeSerial: "DEVICE-1",
        isConnected: false,
      });

      expect(status).toBe("Authorized");
    });
  });
});
