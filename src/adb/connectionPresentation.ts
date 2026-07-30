import type {
  AdbTransportSnapshot,
  PendingConnectionStage,
} from "./WebUsbAdbTransport";

export interface PendingConnectionPresentation {
  stage: PendingConnectionStage;
  headline: string;
  description: string;
}

const STAGE_PRIORITY: readonly PendingConnectionStage[] = [
  "authorizing",
  "authenticating",
  "reconnecting",
  "connecting",
];

const PENDING_PRESENTATION: Record<
  PendingConnectionStage,
  Omit<PendingConnectionPresentation, "stage">
> = {
  authorizing: {
    headline: "Waiting for USB debugging approval",
    description:
      "Unlock each listed Android device if it asks for approval. The saved browser ADB identity is reused automatically.",
  },
  authenticating: {
    headline: "Verifying saved USB debugging authorization",
    description:
      "Checking the device with the previously saved ADB identity. Already-trusted devices continue automatically without a popup.",
  },
  reconnecting: {
    headline: "Waiting for USB reconnect",
    description:
      "Reconnect the cable and keep USB debugging enabled. The trusted ADB identity and prior stream choice are retained.",
  },
  connecting: {
    headline: "Connecting Android over USB",
    description:
      "Opening the USB interface asynchronously. The rest of the app remains usable.",
  },
};

export function dominantPendingStage(
  snapshot: Pick<AdbTransportSnapshot, "pending">,
): PendingConnectionStage | undefined {
  return STAGE_PRIORITY.find((stage) =>
    snapshot.pending.some((item) => item.stage === stage),
  );
}

export function pendingConnectionPresentation(
  snapshot: Pick<AdbTransportSnapshot, "pending">,
): PendingConnectionPresentation | undefined {
  const stage = dominantPendingStage(snapshot);
  return stage ? { stage, ...PENDING_PRESENTATION[stage] } : undefined;
}

export function pendingDeviceLabel(stage: PendingConnectionStage): string {
  switch (stage) {
    case "authorizing":
      return "Approve on Android";
    case "authenticating":
      return "Checking saved ADB identity";
    case "reconnecting":
      return "Cable disconnected · reconnecting automatically";
    case "connecting":
      return "Opening USB interface";
  }
}

export function connectionPhaseLabel({
  busy,
  streaming,
  snapshot,
}: {
  busy: boolean;
  streaming: boolean;
  snapshot: AdbTransportSnapshot;
}): string {
  if (busy) return "Starting stream";
  if (streaming && snapshot.pending.length > 0) {
    return `Live + ${snapshot.pending.length} pending`;
  }
  if (streaming) return "Live";

  switch (dominantPendingStage(snapshot)) {
    case "authorizing":
      return "Authorize on Android";
    case "authenticating":
      return "Verifying saved ADB trust";
    case "reconnecting":
      return "Waiting for USB reconnect";
    case "connecting":
      return "Connecting";
    case undefined:
      if (snapshot.connected.length > 0) {
        return `${snapshot.connected.length} ADB ready`;
      }
      return snapshot.phase === "error" ? "Attention" : "Offline";
  }
}
