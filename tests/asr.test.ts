import { describe, expect, it } from 'vitest';
import { createAsrProvider } from '../src/asr/openai';
import { describeAudioCapability } from '../src/asr/types';
import { resampleLinear } from '../src/asr/audio-chunker';
import { encodePcm16Wav } from '../src/shared/wav';
import type { ModelConfig } from '../src/shared/types';

function audioModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'audio_1',
    name: 'ASR',
    providerName: 'Mock',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: 'asr-secret-123456',
    protocol: 'openai-audio',
    modelId: 'whisper-1',
    headers: {},
    params: {},
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ASR boundary', () => {
  it('detects unsupported, no-source, DRM and capturable video without bypassing protection', () => {
    const video = document.createElement('video');
    expect(describeAudioCapability(video)).toMatchObject({
      canCapture: false,
      reason: 'unsupported-element',
    });

    const captureStream = () => new MediaStream();
    Object.defineProperty(video, 'captureStream', { configurable: true, value: captureStream });
    expect(describeAudioCapability(video)).toMatchObject({ canCapture: false, reason: 'no-source' });

    Object.defineProperty(video, 'currentSrc', { configurable: true, value: 'https://cdn.example/v.mp4' });
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
    expect(describeAudioCapability(video).canCapture).toBe(true);

    Object.defineProperty(video, 'mediaKeys', { configurable: true, value: {} });
    expect(describeAudioCapability(video)).toMatchObject({ canCapture: false, reason: 'drm-protected' });
  });

  it('resamples audio deterministically and encodes valid PCM', () => {
    const input = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.5, 0, -0.5]);
    expect(resampleLinear(input, 48_000, 48_000)).toEqual(input);
    const downsampled = resampleLinear(input, 48_000, 16_000);
    expect(downsampled).toHaveLength(2);
    expect([...downsampled].every((sample) => sample >= -1 && sample <= 1)).toBe(true);
    expect(resampleLinear(input, 0, 16_000)).toHaveLength(0);
    expect(encodePcm16Wav(downsampled, 16_000).length).toBe(44 + downsampled.length * 2);
  });

  it('adapts an independent AsrProvider to the OpenAI Audio endpoint', async () => {
    let receivedUrl = '';
    let receivedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      receivedUrl = String(input);
      receivedInit = init;
      return new Response(JSON.stringify({ text: 'transcribed words' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const provider = createAsrProvider(audioModel(), { fetchImpl, timeoutMs: 1000 });
    const result = await provider.transcribe({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      language: 'en',
    });
    expect(result.text).toBe('transcribed words');
    expect(receivedUrl).toBe('http://127.0.0.1:1234/v1/audio/transcriptions');
    expect(receivedInit?.headers).toMatchObject({ Authorization: 'Bearer asr-secret-123456' });
    expect(receivedInit?.redirect).toBe('error');
    expect(receivedInit?.body).toBeInstanceOf(FormData);
    const form = receivedInit?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('en');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('reports a differentiated ASR transport error and rejects a chat model', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'bad asr key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const provider = createAsrProvider(audioModel(), { fetchImpl });
    await expect(
      provider.transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/wav' }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' });
    expect(() => createAsrProvider(audioModel({ protocol: 'openai-chat' }))).toThrow(
      'requires an openai-audio model',
    );
  });

  it('tests the audio connection through a real transcription request shape', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ text: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const provider = createAsrProvider(audioModel(), { fetchImpl });
    const result = await provider.testConnection();
    expect(result.ok).toBe(true);
    expect(calls[0]).toContain('/audio/transcriptions');
  });
});