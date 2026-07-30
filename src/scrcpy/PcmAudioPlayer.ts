import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import type { ReadableStream } from "@yume-chan/stream-extra";

import type { AudioCodec } from "../core/types";
import type { Diagnostics } from "../debug/Diagnostics";

export const SCRCPY_RAW_AUDIO_SAMPLE_RATE = 48_000;
export const SCRCPY_RAW_AUDIO_CHANNELS = 2;

export interface DecodedPcmChunk {
  left: Float32Array;
  right: Float32Array;
  carry: Uint8Array<ArrayBufferLike>;
}

function sampleToFloat(sample: number): number {
  return sample < 0 ? sample / 32_768 : sample / 32_767;
}

/**
 * scrcpy raw audio is interleaved, signed 16-bit little-endian stereo PCM.
 * A packet is not guaranteed to end on a complete four-byte stereo frame, so
 * callers feed `carry` into the next invocation.
 */
export function decodePcmS16LeStereo(
  chunk: Uint8Array<ArrayBufferLike>,
  carry: Uint8Array<ArrayBufferLike> = new Uint8Array(),
): DecodedPcmChunk {
  const bytes =
    carry.byteLength === 0
      ? chunk
      : (() => {
          const combined = new Uint8Array(carry.byteLength + chunk.byteLength);
          combined.set(carry);
          combined.set(chunk, carry.byteLength);
          return combined;
        })();
  const completeByteLength = bytes.byteLength - (bytes.byteLength % 4);
  const frameCount = completeByteLength / 4;
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, completeByteLength);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * 4;
    left[frame] = sampleToFloat(view.getInt16(offset, true));
    right[frame] = sampleToFloat(view.getInt16(offset + 2, true));
  }

  return {
    left,
    right,
    carry: bytes.slice(completeByteLength),
  };
}

export type PcmPlaybackState = "blocked" | "playing" | "ended";

export type BrowserAudioCodecSupport = Record<AudioCodec, boolean>;

const AUDIO_DECODER_CONFIGS: Record<
  Exclude<AudioCodec, "raw">,
  AudioDecoderConfig
> = {
  opus: {
    codec: "opus",
    sampleRate: SCRCPY_RAW_AUDIO_SAMPLE_RATE,
    numberOfChannels: SCRCPY_RAW_AUDIO_CHANNELS,
  },
  aac: {
    codec: "mp4a.66",
    sampleRate: SCRCPY_RAW_AUDIO_SAMPLE_RATE,
    numberOfChannels: SCRCPY_RAW_AUDIO_CHANNELS,
  },
  flac: {
    codec: "flac",
    sampleRate: SCRCPY_RAW_AUDIO_SAMPLE_RATE,
    numberOfChannels: SCRCPY_RAW_AUDIO_CHANNELS,
  },
};

export async function probeBrowserAudioCodecs(
  diagnostics?: Diagnostics,
): Promise<BrowserAudioCodecSupport> {
  const support: BrowserAudioCodecSupport = {
    raw: typeof AudioContext !== "undefined",
    opus: false,
    aac: false,
    flac: false,
  };
  if (typeof AudioDecoder === "undefined") return support;

  for (const codec of ["opus", "aac", "flac"] as const) {
    try {
      const result = await AudioDecoder.isConfigSupported(
        AUDIO_DECODER_CONFIGS[codec],
      );
      support[codec] = Boolean(result.supported);
    } catch (error) {
      diagnostics?.debug(
        "audio",
        "browser-audio-codec-probe-failed",
        `Browser audio decoder probe failed for ${codec}.`,
        error,
      );
    }
  }
  diagnostics?.info(
    "audio",
    "browser-audio-codecs",
    "Detected browser audio decoder capabilities.",
    support,
  );
  return support;
}

/**
 * Low-latency Web Audio sink for scrcpy raw PCM and WebCodecs-supported
 * compressed streams. It deliberately bounds queued audio so a busy browser
 * tab cannot accumulate seconds of lag.
 */
export class PcmAudioPlayer {
  readonly #sources = new Set<AudioBufferSourceNode>();
  #context?: AudioContext;
  #gain?: GainNode;
  #decoder?: AudioDecoder;
  #generation = 0;
  #nextStartTime = 0;
  #volume = 0.9;
  #targetBufferMs = 60;

  get running(): boolean {
    return this.#context?.state === "running";
  }

  setVolume(volume: number): void {
    this.#volume = Math.min(1, Math.max(0, volume));
    if (this.#gain && this.#context) {
      this.#gain.gain.setValueAtTime(this.#volume, this.#context.currentTime);
    }
  }

  async unlock(): Promise<boolean> {
    if (!this.#context) {
      this.#context = new AudioContext({
        latencyHint: "interactive",
        sampleRate: SCRCPY_RAW_AUDIO_SAMPLE_RATE,
      });
      this.#gain = this.#context.createGain();
      this.#gain.gain.value = this.#volume;
      this.#gain.connect(this.#context.destination);
    }
    if (this.#context.state === "suspended") {
      await this.#context.resume();
    }
    return this.#context.state === "running";
  }

  async play(
    stream: ReadableStream<ScrcpyMediaStreamPacket>,
    codec: AudioCodec,
    targetBufferMs: number,
    onState: (state: PcmPlaybackState) => void,
  ): Promise<void> {
    const generation = ++this.#generation;
    this.#closeDecoder();
    this.#stopSources();
    this.#nextStartTime = 0;
    this.#targetBufferMs = Math.min(500, Math.max(20, targetBufferMs));
    let announcedState: PcmPlaybackState | undefined;
    const announce = (state: PcmPlaybackState) => {
      if (state === announcedState) return;
      announcedState = state;
      onState(state);
    };
    announce(this.running ? "playing" : "blocked");

    if (codec !== "raw") {
      await this.#playEncoded(stream, codec, generation, announce);
      return;
    }

    let carry: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const reader = stream.getReader();
    try {
      while (generation === this.#generation) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value.type !== "data") continue;

        const decoded = decodePcmS16LeStereo(result.value.data, carry);
        carry = decoded.carry;
        const context = this.#context;
        const gain = this.#gain;
        if (!context || !gain || context.state !== "running") {
          announce("blocked");
          continue;
        }
        announce("playing");
        if (decoded.left.length === 0) continue;
        this.#schedule(
          decoded.left,
          decoded.right,
          SCRCPY_RAW_AUDIO_SAMPLE_RATE,
        );
      }
      if (generation === this.#generation) announce("ended");
    } finally {
      reader.releaseLock();
    }
  }

  stop(): void {
    this.#generation += 1;
    this.#closeDecoder();
    this.#stopSources();
    this.#nextStartTime = 0;
  }

  async close(): Promise<void> {
    this.stop();
    const context = this.#context;
    this.#context = undefined;
    this.#gain = undefined;
    if (context && context.state !== "closed") await context.close();
  }

  async #playEncoded(
    stream: ReadableStream<ScrcpyMediaStreamPacket>,
    codec: Exclude<AudioCodec, "raw">,
    generation: number,
    announce: (state: PcmPlaybackState) => void,
  ): Promise<void> {
    if (typeof AudioDecoder === "undefined") {
      throw new Error(`This browser cannot decode ${codec} audio`);
    }
    let decoderError: DOMException | undefined;
    let configured = false;
    const baseConfig = AUDIO_DECODER_CONFIGS[codec];
    const decoder = new AudioDecoder({
      output: (audioData) => {
        try {
          if (generation !== this.#generation) return;
          const frames = audioData.numberOfFrames;
          const channels = audioData.numberOfChannels;
          const left = new Float32Array(frames);
          audioData.copyTo(left, {
            planeIndex: 0,
            format: "f32-planar",
          });
          const right =
            channels > 1
              ? (() => {
                  const plane = new Float32Array(frames);
                  audioData.copyTo(plane, {
                    planeIndex: 1,
                    format: "f32-planar",
                  });
                  return plane;
                })()
              : left;
          if (this.running) {
            announce("playing");
            this.#schedule(left, right, audioData.sampleRate);
          } else {
            announce("blocked");
          }
        } finally {
          audioData.close();
        }
      },
      error: (error) => {
        decoderError = error;
      },
    });
    this.#decoder = decoder;
    const reader = stream.getReader();
    let syntheticTimestamp = 0;
    try {
      while (generation === this.#generation) {
        const result = await reader.read();
        if (result.done) break;
        if (decoderError) throw decoderError;
        const packet = result.value;
        if (packet.type === "configuration") {
          if (decoder.state === "configured") decoder.reset();
          decoder.configure({
            ...baseConfig,
            description: new Uint8Array(packet.data).buffer,
          });
          configured = true;
          continue;
        }
        if (!configured) {
          decoder.configure(baseConfig);
          configured = true;
        }
        // Bound decoder work after a heavily throttled background tab.
        if (decoder.decodeQueueSize > 32) continue;
        const timestamp =
          packet.pts === undefined
            ? syntheticTimestamp
            : Number(packet.pts);
        syntheticTimestamp = timestamp + 20_000;
        decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp,
            data: packet.data,
          }),
        );
      }
      if (
        generation === this.#generation &&
        decoder.state === "configured"
      ) {
        await decoder.flush();
      }
      if (decoderError) throw decoderError;
      if (generation === this.#generation) announce("ended");
    } finally {
      reader.releaseLock();
      if (this.#decoder === decoder) this.#closeDecoder();
    }
  }

  #schedule(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
  ): void {
    const context = this.#context;
    const gain = this.#gain;
    if (!context || !gain || context.state !== "running") return;

    // Drop stale queued audio instead of allowing interaction latency to grow
    // after a throttled/backgrounded tab.
    const maximumQueueSeconds = Math.max(
      0.12,
      this.#targetBufferMs / 1_000 + 0.18,
    );
    if (this.#nextStartTime - context.currentTime > maximumQueueSeconds) {
      this.#stopSources();
      this.#nextStartTime = 0;
    }
    const buffer = context.createBuffer(2, left.length, sampleRate);
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.onended = () => {
      source.disconnect();
      this.#sources.delete(source);
    };
    const leadSeconds = this.#targetBufferMs / 1_000;
    const startAt = Math.max(
      context.currentTime + leadSeconds,
      this.#nextStartTime,
    );
    source.start(startAt);
    this.#nextStartTime = startAt + buffer.duration;
    this.#sources.add(source);
  }

  #closeDecoder(): void {
    const decoder = this.#decoder;
    this.#decoder = undefined;
    if (decoder && decoder.state !== "closed") decoder.close();
  }

  #stopSources(): void {
    for (const source of this.#sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source may already have completed between iteration and stop().
      }
      source.disconnect();
    }
    this.#sources.clear();
  }
}
