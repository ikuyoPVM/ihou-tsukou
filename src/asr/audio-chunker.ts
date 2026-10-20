import { AppError } from '../shared/errors';
import { encodePcm16Wav } from '../shared/wav';
import { describeAudioCapability } from './types';

export interface AudioChunk {
  wav: ArrayBuffer;
  startTime: number;
  endTime: number;
  sampleRate: number;
}

export interface AudioChunkerOptions {
  chunkSeconds?: number;
  targetSampleRate?: number;
  onChunk: (chunk: AudioChunk) => void;
  onError?: (error: Error) => void;
}

/**
 * Captures an accessible HTMLVideoElement audio stream into standalone 16-bit
 * WAV chunks. This is experimental: DRM and cross-origin media may yield no
 * audio, and timestamps are approximate around playback-rate changes.
 */
export class AudioChunker {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private stream: MediaStream | null = null;
  private pcm: Float32Array[] = [];
  private bufferedSamples = 0;
  private segmentStart = 0;
  private running = false;
  private readonly targetRate: number;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: AudioChunkerOptions,
  ) {
    this.targetRate = options.targetSampleRate ?? 16_000;
  }

  get active(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const capability = describeAudioCapability(this.video);
    if (!capability.canCapture) {
      throw new AppError('AUDIO_UNAVAILABLE', capability.message);
    }
    const captureStream = (
      this.video as HTMLVideoElement & { captureStream: () => MediaStream }
    ).captureStream.bind(this.video);
    try {
      this.stream = captureStream();
    } catch (error) {
      throw new AppError('AUDIO_UNAVAILABLE', '浏览器拒绝捕获该视频的媒体流。', { cause: error });
    }
    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.cleanupStream();
      throw new AppError('AUDIO_UNAVAILABLE', '视频媒体流中没有音轨。');
    }
    const audioStream = new MediaStream(audioTracks);
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      this.cleanupStream();
      throw new AppError('AUDIO_UNAVAILABLE', '当前浏览器不支持 Web Audio。');
    }
    try {
      this.context = new AudioContextCtor();
      if (this.context.state === 'suspended') await this.context.resume();
      this.source = this.context.createMediaStreamSource(audioStream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.context.destination);
      this.processor.onaudioprocess = (event) => this.handleAudio(event);
      this.bufferedSamples = 0;
      this.pcm = [];
      this.segmentStart = this.video.currentTime;
      this.running = true;
    } catch (error) {
      await this.stop();
      throw new AppError(
        'AUDIO_UNAVAILABLE',
        '无法建立音频捕获。该视频可能受跨域限制或 DRM 保护。',
        { cause: error },
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.running && !this.context) return;
    this.running = false;
    if (this.bufferedSamples > this.targetRate) this.flushChunk();
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.source?.disconnect();
    this.sink?.disconnect();
    if (this.context && this.context.state !== 'closed') {
      try {
        await this.context.close();
      } catch {
        // Ignore close races.
      }
    }
    this.context = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.cleanupStream();
    this.pcm = [];
    this.bufferedSamples = 0;
  }

  private cleanupStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore.
        }
      }
    }
    this.stream = null;
  }

  private handleAudio(event: AudioProcessingEvent): void {
    if (!this.running || !this.context) return;
    const input = event.inputBuffer.getChannelData(0);
    const resampled = resampleLinear(input, this.context.sampleRate, this.targetRate);
    this.pcm.push(resampled);
    this.bufferedSamples += resampled.length;
    const targetSamples = Math.floor(this.targetRate * (this.options.chunkSeconds ?? 8));
    if (this.bufferedSamples >= targetSamples) this.flushChunk();
  }

  private flushChunk(): void {
    if (this.bufferedSamples === 0) return;
    const merged = new Float32Array(this.bufferedSamples);
    let offset = 0;
    for (const buffer of this.pcm) {
      merged.set(buffer, offset);
      offset += buffer.length;
    }
    this.pcm = [];
    this.bufferedSamples = 0;
    const wav = encodePcm16Wav(merged, this.targetRate);
    const endTime = this.video.currentTime;
    const startTime = this.segmentStart;
    this.segmentStart = endTime;
    if (endTime <= startTime) return;
    const buffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    try {
      this.options.onChunk({
        wav: buffer,
        startTime,
        endTime,
        sampleRate: this.targetRate,
      });
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
    return new Float32Array(0);
  }
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(input.length - 1, lower + 1);
    const fraction = position - lower;
    output[i] = (input[lower] ?? 0) * (1 - fraction) + (input[upper] ?? 0) * fraction;
  }
  return output;
}