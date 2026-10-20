// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAudioProvider, createChatProvider, createProvider } from '../src/providers/factory';
import { resolveApiUrl } from '../src/providers/http';
import { createSilentWav } from '../src/shared/wav';
import type { ModelConfig } from '../src/shared/types';

const CORRECT_KEY = 'sk-correct-test-key-123456';

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'model-1',
    name: 'Mock',
    providerName: 'Local',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: CORRECT_KEY,
    protocol: 'openai-chat',
    modelId: 'mock-chat',
    headers: {},
    params: {},
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

interface RecordedRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe('OpenAI-compatible transport', () => {
  let server: Server;
  let baseUrl = '';
  const requests: RecordedRequest[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({ url: req.url ?? '', headers: req.headers, body });
        const auth = req.headers.authorization;
        if (req.url === '/v1/models') {
          if (auth !== `Bearer ${CORRECT_KEY}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `bad key ${String(auth)}` } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-chat-mini' }] }));
          return;
        }
        if (req.url === '/v1/audio/transcriptions') {
          if (auth !== `Bearer ${CORRECT_KEY}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'bad audio key' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: 'mock transcription' }));
          return;
        }
        if (req.url === '/v1/chat/completions') {
          let parsed: { model?: string } = {};
          try {
            parsed = JSON.parse(body) as { model?: string };
          } catch {
            // Ignore malformed test bodies and fail below.
          }
          if (auth !== `Bearer ${CORRECT_KEY}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: { message: `Invalid API key: ${String(auth)}`, code: 'invalid_api_key' },
              }),
            );
            return;
          }
          if (parsed.model === 'slow-model') {
            setTimeout(() => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] }));
            }, 600);
            return;
          }
          if (parsed.model === 'rate-limited') {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Too many requests' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: '{"translations":[{"id":"0","text":"你好"}]}' } }],
              usage: { prompt_tokens: 12, completion_tokens: 3 },
            }),
          );
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('resolves base and full endpoint URLs without duplicating the path', () => {
    expect(resolveApiUrl('https://api.example.com/v1', '/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(resolveApiUrl('https://api.example.com/v1/chat/completions', '/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(resolveApiUrl('http://localhost:11434/v1/', '/models')).toBe(
      'http://localhost:11434/v1/models',
    );
  });

  it('sends headers, params, temperature and max tokens, then parses content', async () => {
    const provider = createChatProvider(
      model({
        baseUrl,
        headers: { 'X-Test-Header': 'polyglot' },
        params: { seed: 42 },
        temperature: 0.3,
        maxTokens: 777,
        maxTokensField: 'max_completion_tokens',
      }),
    );
    const result = await provider.chat([{ role: 'user', content: 'hello' }]);
    expect(result.content).toContain('translations');
    const request = requests.find((item) => item.url === '/v1/chat/completions' && item.body.includes('seed'));
    expect(request?.headers['x-test-header']).toBe('polyglot');
    const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>;
    expect(body.seed).toBe(42);
    expect(body.temperature).toBe(0.3);
    expect(body.max_completion_tokens).toBe(777);
    expect(body.stream).toBe(false);
  });

  it('returns differentiated errors for invalid key and rate limiting', async () => {
    const invalid = createChatProvider(model({ baseUrl, apiKey: 'wrong-key-abcdef' }));
    await expect(invalid.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });

    const limited = createChatProvider(model({ baseUrl, modelId: 'rate-limited' }));
    await expect(limited.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('does not leak the key in an error message or diagnostic', async () => {
    const secret = 'sk-should-never-appear-999';
    const invalid = createChatProvider(model({ baseUrl, apiKey: secret }));
    try {
      await invalid.chat([{ role: 'user', content: 'x' }]);
      expect.fail('Expected invalid key to throw');
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(secret);
      expect((error as { message: string }).message).not.toContain(secret);
    }
  });

  it('times out a slow provider and reports cancellation-compatible code', async () => {
    const slow = createChatProvider(model({ baseUrl, modelId: 'slow-model' }), { timeoutMs: 80 });
    await expect(slow.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('reports a network error for an unreachable local port', async () => {
    const broken = createChatProvider(
      model({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'x' }),
      { timeoutMs: 1000 },
    );
    await expect(broken.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('lists models and rejects protocol mismatches', async () => {
    const chat = createChatProvider(model({ baseUrl }));
    expect(await chat.listModels()).toEqual(['mock-chat', 'mock-chat-mini']);
    expect(() => createAudioProvider(model({ baseUrl }))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_PROTOCOL' }),
    );
    expect(() => createProvider(model({ baseUrl, protocol: 'nope' as ModelConfig['protocol'] }))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_PROTOCOL' }),
    );
  });

  it('sends multipart audio and parses transcription text', async () => {
    const audio = createAudioProvider(
      model({ baseUrl, protocol: 'openai-audio', modelId: 'mock-whisper' }),
    );
    const result = await audio.transcribe(createSilentWav(0.1), 'audio/wav', { language: 'en' });
    expect(result.text).toBe('mock transcription');
    const request = requests.find((item) => item.url === '/v1/audio/transcriptions');
    expect(request?.headers['content-type']).toContain('multipart/form-data');
    expect(request?.body).toContain('name="file"');
    expect(request?.body).toContain('name="model"');
  });
});