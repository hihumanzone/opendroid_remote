import type { Adb } from "@yume-chan/adb";
import {
  AdbScrcpyClient,
  AdbScrcpyExitedError,
  AdbScrcpyOptionsLatest,
} from "@yume-chan/adb-scrcpy";
import {
  DefaultServerPath,
  ScrcpyInstanceId,
  ScrcpyVideoCodecId,
  type ScrcpyControlMessageWriter,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { ReadableStream } from "@yume-chan/stream-extra";

import {
  parseResolution,
  discoverFocusedDisplayId,
  probeUhidMouse,
  type UhidMouseCapability,
} from "../capabilities/androidAdapters";
import type {
  AudioCodec,
  AudioEncoderDescriptor,
  DisplayDescriptor,
  EncoderDescriptor,
  MouseInputMode,
  SessionStats,
  Size,
  StreamQuality,
  VideoCodec,
} from "../core/types";
import type { Diagnostics } from "../debug/Diagnostics";
import {
  PcmAudioPlayer,
  probeBrowserAudioCodecs,
  type BrowserAudioCodecSupport,
} from "./PcmAudioPlayer";
import { ScrcpyControlAdapter } from "./ScrcpyControlAdapter";
import {
  buildCodecCandidates,
  buildStartupAttempts,
  normalizeAudioEncoders,
  normalizeEncoders,
  probeBrowserCodecs,
  type BrowserCodecSupport,
  type CodecCandidate,
} from "./codecNegotiation";
import {
  createAudioSessionOptions,
  createDiscoveryOptions,
} from "./sessionOptions";

const SERVER_VERSION = "3.3.3";
const SERVER_ASSET = "vendor/scrcpy-server-v3.3.3";
const SERVER_SHA256 =
  "7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0";
const FIRST_FRAME_TIMEOUT_MS = 10_000;

class UhidMouseStartupError extends Error {
  constructor(cause: unknown) {
    super(
      "Android rejected UHID mouse creation; restarting without direct mouse input.",
      { cause },
    );
    this.name = "UhidMouseStartupError";
  }
}

export interface AndroidCapabilities {
  displays: DisplayDescriptor[];
  encoders: EncoderDescriptor[];
  audioEncoders: AudioEncoderDescriptor[];
  browserCodecs: BrowserCodecSupport;
  browserAudioCodecs: BrowserAudioCodecSupport;
  uhidMouse: UhidMouseCapability;
  focusedDisplayId?: number;
  recommendedDisplayId?: number;
}

export interface DynamicDisplayUpdate {
  capabilities: AndroidCapabilities;
  focusedDisplayChanged: boolean;
  inventoryRefreshRequired: boolean;
}

export function resolveDynamicDisplayUpdate(
  capabilities: AndroidCapabilities,
  focusedDisplayId: number | undefined,
): DynamicDisplayUpdate {
  if (
    focusedDisplayId === undefined ||
    focusedDisplayId === capabilities.focusedDisplayId
  ) {
    return {
      capabilities,
      focusedDisplayChanged: false,
      inventoryRefreshRequired: false,
    };
  }
  if (
    !capabilities.displays.some(
      (display) => display.id === focusedDisplayId,
    )
  ) {
    return {
      capabilities,
      focusedDisplayChanged: true,
      inventoryRefreshRequired: true,
    };
  }
  return {
    capabilities: {
      ...capabilities,
      displays: capabilities.displays.map((display) => ({
        ...display,
        focused: display.id === focusedDisplayId,
      })),
      focusedDisplayId,
      recommendedDisplayId: focusedDisplayId,
    },
    focusedDisplayChanged: true,
    inventoryRefreshRequired: false,
  };
}

export interface ScrcpySessionSnapshot {
  phase:
    | "idle"
    | "preparing"
    | "negotiating"
    | "starting"
    | "streaming"
    | "stopping"
    | "error";
  message: string;
  stats: SessionStats;
  audio: AudioPlaybackSnapshot;
  capabilities?: AndroidCapabilities;
  error?: string;
}

export interface AudioPlaybackSnapshot {
  status:
    | "off"
    | "starting"
    | "playing"
    | "blocked"
    | "unavailable"
    | "error";
  codec?: string;
  message?: string;
}

type SessionListener = (snapshot: ScrcpySessionSnapshot) => void;
type ClipboardListener = (content: string) => void;

function codecName(id: number): VideoCodec {
  switch (id) {
    case ScrcpyVideoCodecId.H264:
      return "h264";
    case ScrcpyVideoCodecId.H265:
      return "h265";
    case ScrcpyVideoCodecId.AV1:
      return "av1";
    default:
      throw new Error(`Unsupported scrcpy codec ID: ${id}`);
  }
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function errorMessage(error: unknown): string {
  if (error instanceof AdbScrcpyExitedError) {
    const output = error.output.filter(Boolean).slice(-12).join("\n");
    return output
      ? `scrcpy server output:\n${output}`
      : `${error.message} (the Android process returned no diagnostic output)`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function resolveAudioCodec(
  requested: StreamQuality["audio"]["codec"],
  support: BrowserAudioCodecSupport,
): AudioCodec {
  if (requested === "auto") {
    if (support.raw) return "raw";
    const fallback = (["opus", "aac", "flac"] as const).find(
      (codec) => support[codec],
    );
    if (fallback) return fallback;
    throw new Error("This browser cannot play a supported Android audio codec");
  }
  if (!support[requested]) {
    throw new Error(
      `This browser cannot decode the requested ${requested} audio stream`,
    );
  }
  return requested;
}

export class ScrcpySession {
  readonly #listeners = new Set<SessionListener>();
  readonly #clipboardListeners = new Set<ClipboardListener>();
  readonly #pushedTo = new WeakSet<Adb>();
  readonly #diagnostics: Diagnostics;

  #client?: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  #decoder?: WebCodecsVideoDecoder;
  #control?: ScrcpyControlAdapter;
  readonly #audioPlayer = new PcmAudioPlayer();
  #closing = false;
  #videoPipe?: Promise<void>;
  #audioTask?: Promise<void>;
  #outputTask?: Promise<void>;
  #clipboardTask?: Promise<void>;
  #statsTimer?: number;
  #capabilities?: AndroidCapabilities;
  #capabilitiesAdb?: Adb;
  #sessionAdb?: Adb;
  #audio: AudioPlaybackSnapshot = { status: "off" };
  #snapshot: ScrcpySessionSnapshot = {
    phase: "idle",
    message: "Connect an Android device to begin.",
    audio: { status: "off" },
    stats: {
      framesRendered: 0,
      framesSkipped: 0,
      width: 0,
      height: 0,
    },
  };

  constructor(diagnostics: Diagnostics) {
    this.#diagnostics = diagnostics;
  }

  get snapshot(): ScrcpySessionSnapshot {
    return this.#snapshot;
  }

  get control(): ScrcpyControlAdapter | undefined {
    return this.#control;
  }

  get videoSize(): Size {
    return {
      width: this.#snapshot.stats.width,
      height: this.#snapshot.stats.height,
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeClipboard(listener: ClipboardListener): () => void {
    this.#clipboardListeners.add(listener);
    return () => this.#clipboardListeners.delete(listener);
  }

  async unlockAudio(): Promise<boolean> {
    const unlocked = await this.#audioPlayer.unlock();
    if (
      unlocked &&
      this.#client &&
      this.#audio.status === "blocked"
    ) {
      this.#setAudio({
        status: "playing",
        codec: this.#audio.codec ?? "raw",
        message: "Playing through this computer.",
      });
    }
    return unlocked;
  }

  setAudioVolume(volume: number): void {
    this.#audioPlayer.setVolume(volume);
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.#audioPlayer.close();
    this.#listeners.clear();
    this.#clipboardListeners.clear();
  }

  async prepare(adb: Adb, forceRefresh = false): Promise<AndroidCapabilities> {
    const wasStreaming = this.#snapshot.phase === "streaming";
    if (!wasStreaming) {
      this.#setSnapshot({
        ...this.#snapshot,
        phase: "preparing",
        message: "Verifying and pushing the scrcpy server…",
        error: undefined,
      });
    }
    await this.#ensureServer(adb);
    if (
      this.#capabilities &&
      this.#capabilitiesAdb === adb &&
      !forceRefresh
    ) {
      return this.#capabilities;
    }
    if (!wasStreaming) {
      this.#setSnapshot({
        ...this.#snapshot,
        phase: "negotiating",
        message: "Discovering displays, encoders, and browser codecs…",
      });
    }

    const focusedDisplayIdPromise = discoverFocusedDisplayId(
      adb,
      this.#diagnostics,
    );
    const uhidMousePromise = probeUhidMouse(adb, this.#diagnostics);
    let rawDisplays: Awaited<ReturnType<typeof AdbScrcpyClient.getDisplays>> = [];
    try {
      rawDisplays = await AdbScrcpyClient.getDisplays(
        adb,
        DefaultServerPath,
        createDiscoveryOptions(),
      );
    } catch (error) {
      this.#diagnostics.warn(
        "display",
        "display-list-failed",
        "scrcpy display listing failed; server-default display selection remains available.",
        error,
      );
    }

    let rawEncoders: Awaited<ReturnType<typeof AdbScrcpyClient.getEncoders>> = [];
    try {
      rawEncoders = await AdbScrcpyClient.getEncoders(
        adb,
        DefaultServerPath,
        createDiscoveryOptions(),
      );
    } catch (error) {
      this.#diagnostics.warn(
        "codec",
        "encoder-list-failed",
        "scrcpy encoder listing failed; Android default encoder negotiation remains available.",
        error,
      );
    }

    const [
      focusedDisplayId,
      browserCodecs,
      browserAudioCodecs,
      uhidMouse,
    ] = await Promise.all([
      focusedDisplayIdPromise,
      probeBrowserCodecs(this.#diagnostics),
      probeBrowserAudioCodecs(this.#diagnostics),
      uhidMousePromise,
    ]);
    const displays = rawDisplays.map((display) => {
      const resolution = parseResolution(display.resolution);
      return {
        id: display.id,
        resolution: display.resolution,
        width: resolution?.width,
        height: resolution?.height,
        focused: display.id === focusedDisplayId,
      };
    });
    const recommendedDisplayId =
      displays.find((display) => display.id === focusedDisplayId)?.id ??
      (displays.length === 1 ? displays[0]!.id : undefined);
    const encoders = normalizeEncoders(rawEncoders);
    const audioEncoders = normalizeAudioEncoders(rawEncoders);
    this.#capabilities = {
      displays,
      encoders,
      audioEncoders,
      browserCodecs,
      browserAudioCodecs,
      uhidMouse,
      focusedDisplayId,
      recommendedDisplayId,
    };
    this.#capabilitiesAdb = adb;
    this.#diagnostics.info(
      "display",
      "display-discovery",
      `Discovered ${displays.length} display(s).`,
      this.#capabilities,
    );
    this.#diagnostics.info(
      "codec",
      "encoder-discovery",
      `Discovered ${encoders.length} video encoder(s).`,
      encoders,
    );
    this.#setSnapshot(
      wasStreaming
        ? { ...this.#snapshot, capabilities: this.#capabilities }
        : {
            ...this.#snapshot,
            phase: "idle",
            message: "Device capabilities are ready.",
            capabilities: this.#capabilities,
          },
    );
    return this.#capabilities;
  }

  async start(
    adb: Adb,
    canvas: HTMLCanvasElement,
    quality: StreamQuality,
  ): Promise<void> {
    await this.stop();
    this.#closing = false;
    this.#audioPlayer.setVolume(quality.audio.volume);
    const capabilities = await this.prepare(adb);
    const displayId =
      quality.displayId !== undefined
        ? quality.displayId
        : capabilities.recommendedDisplayId;
    const candidates = buildCodecCandidates(
      capabilities.encoders,
      capabilities.browserCodecs,
      quality.codec,
      quality.encoder,
    );
    if (candidates.length === 0) {
      throw new Error(
        "No codec is supported by both this browser and the requested stream settings.",
      );
    }
    const audioCodec = quality.audio.enabled
      ? resolveAudioCodec(
          quality.audio.codec,
          capabilities.browserAudioCodecs,
        )
      : "raw";
    const attempts = buildStartupAttempts(candidates, quality.tunnel);
    let lastError: unknown;
    for (const [index, attempt] of attempts.entries()) {
      const { candidate } = attempt;
      // A failed streaming process may execute scrcpy's cleanup handler and
      // remove the server file. Re-verify the deployment before every retry.
      await this.#ensureServer(adb);
      this.#setSnapshot({
        ...this.#snapshot,
        phase: "starting",
        message: `Starting ${candidate.reason} over ${attempt.tunnelLabel} (${index + 1}/${attempts.length})…`,
        error: undefined,
      });
      this.#diagnostics.info(
        "scrcpy",
        "start-attempt",
        `Starting scrcpy with ${candidate.reason} over ${attempt.tunnelLabel}.`,
        {
          candidate,
          audioCodec,
          displayId,
          quality,
          tunnelForward: attempt.tunnelForward,
          tunnelLabel: attempt.tunnelLabel,
          attempt: index + 1,
          attemptCount: attempts.length,
        },
      );
      try {
        await this.#startCandidate(
          adb,
          canvas,
          quality,
          candidate,
          audioCodec,
          displayId,
          attempt.tunnelForward,
          attempt.tunnelLabel,
        );
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof UhidMouseStartupError) {
          // A rejected UHID_CREATE may terminate scrcpy's controller thread.
          // Retry this media choice in a fresh process with mouse disabled.
          attempts.splice(index + 1, 0, attempt);
        }
        this.#diagnostics.warn(
          "scrcpy",
          "start-attempt-failed",
          `scrcpy startup failed for ${candidate.reason} over ${attempt.tunnelLabel}; trying the next negotiated option.`,
          {
            error,
            serverOutput:
              error instanceof AdbScrcpyExitedError ? error.output : undefined,
            candidate,
            displayId,
            tunnelForward: attempt.tunnelForward,
            tunnelLabel: attempt.tunnelLabel,
          },
        );
        await this.#cleanupCandidate();
        this.#invalidateServer(
          adb,
          "The previous startup process may have removed the server file.",
        );
      }
    }
    const message = errorMessage(lastError);
    this.#setSnapshot({
      ...this.#snapshot,
      phase: "error",
      message: "Unable to start mirroring.",
      error: message,
    });
    throw new Error(message, {
      cause: lastError instanceof Error ? lastError : undefined,
    });
  }

  async stop(): Promise<void> {
    if (
      !this.#client &&
      !this.#decoder &&
      this.#snapshot.phase !== "streaming" &&
      this.#snapshot.phase !== "starting"
    ) {
      return;
    }
    this.#closing = true;
    const adb = this.#sessionAdb;
    this.#setSnapshot({
      ...this.#snapshot,
      phase: "stopping",
      message: "Stopping the local mirroring session…",
    });
    await this.#cleanupCandidate();
    if (adb) {
      this.#invalidateServer(
        adb,
        "The stopped streaming process used scrcpy cleanup.",
      );
    }
    this.#setSnapshot({
      phase: "idle",
      message: "Mirroring stopped.",
      audio: { status: "off" },
      capabilities: this.#capabilities,
      stats: {
        framesRendered: 0,
        framesSkipped: 0,
        width: 0,
        height: 0,
      },
    });
  }

  async refreshCapabilities(adb: Adb): Promise<AndroidCapabilities> {
    return this.prepare(adb, true);
  }

  /**
   * Cheap background check for display changes. Full scrcpy capability probes
   * launch short-lived server processes, so they must not run repeatedly next
   * to a live video/audio session. Only escalate when the focused display
   * actually changes.
   */
  async refreshDynamicDisplayState(
    adb: Adb,
  ): Promise<DynamicDisplayUpdate | undefined> {
    const capabilities = this.#capabilities;
    if (!capabilities || this.#capabilitiesAdb !== adb) return undefined;

    const focusedDisplayId = await discoverFocusedDisplayId(
      adb,
      this.#diagnostics,
    );
    const update = resolveDynamicDisplayUpdate(
      capabilities,
      focusedDisplayId,
    );
    if (update.inventoryRefreshRequired) {
      this.#diagnostics.info(
        "display",
        "new-focused-display",
        `Focused display changed to ${focusedDisplayId}; a serialized capability refresh is required.`,
      );
      return update;
    }
    if (!update.focusedDisplayChanged) return update;

    this.#capabilities = update.capabilities;
    this.#setSnapshot({
      ...this.#snapshot,
      capabilities: this.#capabilities,
    });
    this.#diagnostics.info(
      "display",
      "focused-display-changed",
      `Focused display changed to ${focusedDisplayId}.`,
    );
    return {
      ...update,
      capabilities: this.#capabilities,
    };
  }

  async #ensureServer(adb: Adb): Promise<void> {
    if (this.#pushedTo.has(adb)) return;
    const assetUrl = new URL(SERVER_ASSET, document.baseURI);
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(
        `Could not load the bundled scrcpy server (${response.status})`,
      );
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const digest = toHex(await crypto.subtle.digest("SHA-256", data));
    if (digest !== SERVER_SHA256) {
      throw new Error("Bundled scrcpy server integrity verification failed");
    }
    this.#diagnostics.info(
      "scrcpy",
      "server-verified",
      `Verified scrcpy server ${SERVER_VERSION}.`,
      { bytes: data.byteLength, sha256: digest },
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    await AdbScrcpyClient.pushServer(adb, stream, DefaultServerPath);
    this.#pushedTo.add(adb);
    this.#diagnostics.info(
      "scrcpy",
      "server-pushed",
      `Pushed scrcpy server ${SERVER_VERSION} over ADB.`,
    );
  }

  #invalidateServer(adb: Adb, reason: string): void {
    const wasTracked = this.#pushedTo.delete(adb);
    if (!wasTracked) return;
    this.#diagnostics.debug(
      "scrcpy",
      "server-file-invalidated",
      reason,
      { wasTracked },
    );
  }

  async #startCandidate(
    adb: Adb,
    canvas: HTMLCanvasElement,
    quality: StreamQuality,
    candidate: CodecCandidate,
    audioCodec: AudioCodec,
    displayId: number | undefined,
    tunnelForward: boolean,
    tunnelLabel: string,
  ): Promise<void> {
    const requestedMouseMode = quality.mouse.mode;
    const mouseMode: MouseInputMode =
      requestedMouseMode === "uhid" &&
      !this.#capabilities?.uhidMouse.supported
        ? "disabled"
        : requestedMouseMode;
    if (requestedMouseMode !== mouseMode) {
      this.#diagnostics.warn(
        "control",
        "mouse-mode-unavailable",
        "Physical UHID mouse access is unavailable on this Android build. Direct mouse input is disabled; SDK compatibility mode remains an explicit opt-in.",
        this.#capabilities?.uhidMouse,
      );
    }
    const options = new AdbScrcpyOptionsLatest({
      scid: ScrcpyInstanceId.random(),
      logLevel: "info",
      video: true,
      ...createAudioSessionOptions(quality.audio, audioCodec),
      control: true,
      cleanup: true,
      clipboardAutosync: quality.clipboardAutosync,
      powerOn: quality.powerOn,
      downsizeOnError: quality.downsizeOnError,
      stayAwake: quality.stayAwake,
      showTouches: quality.showTouches,
      maxSize: quality.maxSize,
      videoBitRate: quality.bitRate,
      videoCodecOptions:
        quality.iFrameInterval === undefined
          ? undefined
          : `i-frame-interval=${quality.iFrameInterval}`,
      maxFps: quality.maxFps,
      videoCodec: candidate.codec,
      videoEncoder: candidate.encoder,
      displayId,
      crop: quality.crop,
      captureOrientation:
        quality.captureOrientation === "auto"
          ? undefined
          : quality.captureOrientation === "initial"
            ? "@"
            : `@${quality.captureOrientation}`,
      sendDeviceMeta: true,
      sendCodecMeta: true,
      sendFrameMeta: true,
      tunnelForward,
    });
    const client = await AdbScrcpyClient.start(adb, DefaultServerPath, options);
    this.#client = client;
    this.#sessionAdb = adb;
    this.#outputTask = this.#consumeOutput(client);
    this.#setAudio(
      quality.audio.enabled
        ? {
            status: "starting",
            codec: audioCodec,
            message: "Starting computer audio playback…",
          }
        : { status: "off", message: "Audio streaming is disabled." },
    );
    if (quality.audio.enabled) {
      this.#audioTask = this.#consumeAudio(
        client,
        quality.audio.bufferMs,
      ).catch((error) => {
        if (this.#closing || this.#client !== client) return;
        this.#diagnostics.error(
          "audio",
          "audio-pipeline-failed",
          "The computer audio pipeline stopped.",
          error,
        );
        this.#setAudio({
          status: "error",
          codec: audioCodec,
          message: errorMessage(error),
        });
      });
    }
    const video = await client.videoStream;
    if (!video) throw new Error("scrcpy did not return a video stream");
    if (!client.controller) throw new Error("scrcpy control channel is unavailable");
    const renderer = this.#createRenderer(canvas, quality.renderer);
    const decoder = new WebCodecsVideoDecoder({
      codec: video.metadata.codec,
      renderer,
      hardwareAcceleration: quality.hardwareAcceleration,
    });
    this.#decoder = decoder;
    const actualCodec = codecName(video.metadata.codec);
    const control = new ScrcpyControlAdapter(
      client.controller as ScrcpyControlMessageWriter,
      () => this.videoSize,
      this.#diagnostics,
      mouseMode,
      quality.mouse.sensitivity,
    );
    try {
      await control.initializeMouse();
    } catch (error) {
      if (mouseMode !== "uhid") throw error;
      const reason =
        "Android allowed the /dev/uhid probe but rejected physical mouse creation.";
      if (this.#capabilities) {
        this.#capabilities = {
          ...this.#capabilities,
          uhidMouse: { supported: false, reason },
        };
      }
      this.#diagnostics.warn(
        "control",
        "uhid-mouse-create-failed",
        `${reason} Restarting with direct mouse input disabled.`,
        error,
      );
      throw new UhidMouseStartupError(error);
    }
    this.#control = control;
    this.#diagnostics.info(
      "control",
      "mouse-mode-selected",
      mouseMode === "uhid"
        ? "Using a relative Android UHID physical mouse."
        : mouseMode === "sdk"
          ? "Using the explicitly selected Android SDK mouse compatibility path."
          : "Direct mouse input is disabled because physical UHID access is unavailable.",
      { requestedMouseMode, mouseMode },
    );

    let cancelFirstFrameWait = () => {};
    const firstFrame = new Promise<Size>((resolve, reject) => {
      let removeListener = () => {};
      const timer = window.setTimeout(() => {
        removeListener();
        reject(
          new Error(
            "Timed out waiting for a decodable video frame from the selected encoder.",
          ),
        );
      }, FIRST_FRAME_TIMEOUT_MS);
      removeListener = decoder.sizeChanged((size) => {
        if (size.width <= 0 || size.height <= 0) return;
        window.clearTimeout(timer);
        removeListener();
        resolve(size);
      });
      cancelFirstFrameWait = () => {
        window.clearTimeout(timer);
        removeListener();
      };
    });
    const rawVideoPipe = video.stream.pipeTo(decoder.writable);
    this.#videoPipe = rawVideoPipe.catch((error) => {
      if (this.#closing || this.#client !== client) return;
      this.#diagnostics.error(
        "codec",
        "decoder-pipeline-failed",
        "The video decoder pipeline stopped.",
        error,
      );
      if (this.#snapshot.phase === "streaming") {
        this.#setSnapshot({
          ...this.#snapshot,
          phase: "error",
          message: "Video decoding stopped.",
          error: errorMessage(error),
        });
      }
    });
    let size: Size;
    try {
      size = await Promise.race([
        firstFrame,
        rawVideoPipe.then(() => {
          throw new Error(
            "The Android video stream ended before the first frame.",
          );
        }),
      ]);
    } finally {
      cancelFirstFrameWait();
    }
    decoder.sizeChanged((nextSize) => {
      this.#setSnapshot({
        ...this.#snapshot,
        stats: {
          ...this.#snapshot.stats,
          width: nextSize.width,
          height: nextSize.height,
        },
      });
    });
    this.#clipboardTask = this.#consumeClipboard(client);
    this.#setSnapshot({
      phase: "streaming",
      message: `Mirroring ${size.width}×${size.height} via ${candidate.reason} over ${tunnelLabel}.`,
      audio: this.#audio,
      capabilities: this.#capabilities,
      stats: {
        framesRendered: 0,
        framesSkipped: 0,
        width: size.width,
        height: size.height,
        codec: actualCodec,
        encoder: candidate.encoder,
        displayId,
      },
    });
    this.#statsTimer = window.setInterval(() => {
      if (!this.#decoder) return;
      this.#setSnapshot({
        ...this.#snapshot,
        stats: {
          ...this.#snapshot.stats,
          framesRendered: this.#decoder.framesRendered,
          framesSkipped: this.#decoder.framesSkipped,
          width: this.#decoder.width || this.#snapshot.stats.width,
          height: this.#decoder.height || this.#snapshot.stats.height,
        },
      });
    }, 1_000);
    void client.exited.then(() => {
      this.#invalidateServer(
        adb,
        "The scrcpy process exited and may have removed the server file.",
      );
      if (this.#closing || this.#client !== client) return;
      this.#diagnostics.warn(
        "scrcpy",
        "server-exited",
        "The scrcpy server exited.",
      );
      this.#setSnapshot({
        ...this.#snapshot,
        phase: "error",
        message: "The Android mirroring process ended.",
        error: "scrcpy server exited",
      });
    });
  }

  #createRenderer(
    canvas: HTMLCanvasElement,
    preference: StreamQuality["renderer"],
  ) {
    if (
      preference === "webgl" &&
      !WebGLVideoFrameRenderer.isSupported
    ) {
      throw new Error("WebGL rendering was required but is unavailable");
    }
    if (
      preference !== "bitmap" &&
      WebGLVideoFrameRenderer.isSupported
    ) {
      try {
        this.#diagnostics.debug(
          "codec",
          "renderer-selected",
          "Using WebGL video frame rendering.",
        );
        return new WebGLVideoFrameRenderer(canvas);
      } catch (error) {
        if (preference === "webgl") throw error;
        this.#diagnostics.warn(
          "codec",
          "webgl-renderer-failed",
          "WebGL renderer initialization failed; using bitmap rendering.",
          error,
        );
      }
    }
    return new BitmapVideoFrameRenderer(canvas);
  }

  async #consumeOutput(
    client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
  ): Promise<void> {
    const reader = client.output.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const line = result.value.trim();
        if (!line) continue;
        const level = line.includes(" ERROR: ")
          ? "error"
          : line.includes(" WARN: ")
            ? "warn"
            : "debug";
        this.#diagnostics.record(
          level,
          "scrcpy",
          "server-output",
          line,
        );
      }
    } catch (error) {
      if (!this.#closing && this.#client === client) {
        this.#diagnostics.warn(
          "scrcpy",
          "output-stream-ended",
          "scrcpy diagnostic output ended unexpectedly.",
          error,
        );
      }
    } finally {
      reader.releaseLock();
    }
  }

  async #consumeClipboard(
    client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
  ): Promise<void> {
    const stream = client.clipboard;
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        for (const listener of this.#clipboardListeners) listener(result.value);
        if (navigator.clipboard?.writeText && document.hasFocus()) {
          try {
            await navigator.clipboard.writeText(result.value);
          } catch (error) {
            this.#diagnostics.debug(
              "control",
              "clipboard-write-denied",
              "Browser denied automatic clipboard write.",
              error,
            );
          }
        }
      }
    } catch (error) {
      if (!this.#closing && this.#client === client) {
        this.#diagnostics.warn(
          "control",
          "clipboard-stream-ended",
          "Android clipboard stream ended.",
          error,
        );
      }
    } finally {
      reader.releaseLock();
    }
  }

  async #consumeAudio(
    client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
    bufferMs: number,
  ): Promise<void> {
    const audioStream = client.audioStream;
    if (!audioStream) {
      this.#setAudio({
        status: "unavailable",
        message: "This scrcpy session did not expose an audio stream.",
      });
      return;
    }
    const metadata = await audioStream;
    if (this.#client !== client || this.#closing) return;
    if (metadata.type === "disabled") {
      this.#setAudio({
        status: "unavailable",
        message: "Android audio capture is unavailable on this device.",
      });
      this.#diagnostics.info(
        "audio",
        "audio-disabled",
        "Android reported audio capture as unavailable.",
      );
      return;
    }
    if (metadata.type === "errored") {
      this.#setAudio({
        status: "unavailable",
        message:
          "Android could not start audio capture. Android 11 or newer is required.",
      });
      this.#diagnostics.warn(
        "audio",
        "audio-capture-error",
        "Android could not start the scrcpy audio capture stream.",
      );
      return;
    }
    const codec = metadata.codec.optionValue;
    this.#diagnostics.info(
      "audio",
      "audio-stream-ready",
      `Receiving ${codec} audio for local browser playback.`,
    );
    await this.#audioPlayer.play(
      metadata.stream,
      codec as AudioCodec,
      bufferMs,
      (state) => {
        if (this.#client !== client || this.#closing) return;
        if (state === "blocked") {
          this.#setAudio({
            status: "blocked",
            codec,
            message: "Click Enable audio once to allow browser playback.",
          });
        } else if (state === "playing") {
          this.#setAudio({
            status: "playing",
            codec,
            message: "Playing through this computer.",
          });
        } else {
          this.#setAudio({
            status: "unavailable",
            codec,
            message: "The Android audio stream ended.",
          });
        }
      },
    );
  }

  async #cleanupCandidate(): Promise<void> {
    if (this.#statsTimer !== undefined) {
      window.clearInterval(this.#statsTimer);
      this.#statsTimer = undefined;
    }
    const client = this.#client;
    const control = this.#control;
    this.#audioPlayer.stop();
    this.#client = undefined;
    this.#sessionAdb = undefined;
    this.#control = undefined;
    if (control) {
      try {
        await control.close();
      } catch {
        // The control socket may already be gone after a cable disconnect.
      }
    }
    if (client) {
      try {
        await client.close();
      } catch {
        // Server may already have exited.
      }
    }
    this.#decoder?.dispose();
    this.#decoder = undefined;
    this.#videoPipe = undefined;
    this.#audioTask = undefined;
    this.#outputTask = undefined;
    this.#clipboardTask = undefined;
    this.#audio = { status: "off" };
  }

  #setSnapshot(snapshot: ScrcpySessionSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }

  #setAudio(audio: AudioPlaybackSnapshot): void {
    this.#audio = audio;
    this.#setSnapshot({ ...this.#snapshot, audio });
  }
}
