import { createAudioProvider, type ProviderDeps } from '../providers/factory';
import type { AsrAudioInput, AsrProvider, AsrResult } from './types';
import type { ModelConfig } from '../shared/types';

/** Adapter from the extension ASR interface to an OpenAI Audio compatible API. */
export class OpenAIAsrProvider implements AsrProvider {
  readonly id: string;

  constructor(
    private readonly model: ModelConfig,
    private readonly deps: ProviderDeps = {},
  ) {
    if (model.protocol !== 'openai-audio') {
      throw new Error('OpenAIAsrProvider requires an openai-audio model');
    }
    this.id = model.id;
  }

  async transcribe(input: AsrAudioInput): Promise<AsrResult> {
    const provider = createAudioProvider(this.model, this.deps);
    return provider.transcribe(input.bytes, input.mimeType, {
      language: input.language,
      prompt: input.prompt,
      signal: input.signal,
    });
  }

  testConnection(signal?: AbortSignal) {
    return createAudioProvider(this.model, this.deps).testConnection(signal);
  }
}

export function createAsrProvider(model: ModelConfig, deps: ProviderDeps = {}): AsrProvider {
  return new OpenAIAsrProvider(model, deps);
}