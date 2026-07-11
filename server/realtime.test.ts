import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './config';
import { createServiceError } from './operation-service';
import {
  CapturingRealtimeMetadataSink,
  EPHEMERAL_VALUE,
  LONG_LIVED_KEY,
  NOW_MS,
  NOW_SECONDS,
  RAW_PROVIDER_SECRET,
  REQUEST_ID,
  ScriptedRealtimeProvider,
} from './realtime-test-harness';
import {
  createOpenAIRealtimeCredentialProvider,
  createRealtimeCredentialService,
  type OpenAIRealtimeClient,
} from './realtime';

describe('Realtime server configuration', () => {
  it('defaults Realtime off with a separate bounded model and short credential TTL', () => {
    const config = loadServerConfig({});

    expect(config.enableRealtime).toBe(false);
    expect(config.realtimeModel).toBe('gpt-realtime');
    expect(config.realtimeModel).not.toBe(config.openAiModel);
    expect(config.realtimeCredentialTtlSeconds).toBe(60);
  });

  it('parses explicit strict Realtime settings', () => {
    const config = loadServerConfig({
      ENABLE_REALTIME: 'true',
      OPENAI_REALTIME_MODEL: 'gpt-realtime-2.1-mini',
      REALTIME_CREDENTIAL_TTL_SECONDS: '120',
    });

    expect(config).toMatchObject({
      enableRealtime: true,
      realtimeModel: 'gpt-realtime-2.1-mini',
      realtimeCredentialTtlSeconds: 120,
    });
  });

  it.each([
    [{ ENABLE_REALTIME: 'yes' }, 'ENABLE_REALTIME'],
    [{ OPENAI_REALTIME_MODEL: 'bad model' }, 'OPENAI_REALTIME_MODEL'],
    [{ REALTIME_CREDENTIAL_TTL_SECONDS: '9' }, 'REALTIME_CREDENTIAL_TTL_SECONDS'],
    [{ REALTIME_CREDENTIAL_TTL_SECONDS: '7201' }, 'REALTIME_CREDENTIAL_TTL_SECONDS'],
    [{ REALTIME_CREDENTIAL_TTL_SECONDS: '10.5' }, 'REALTIME_CREDENTIAL_TTL_SECONDS'],
  ])('rejects invalid strict Realtime configuration %#', (environment, expected) => {
    expect(() => loadServerConfig(environment)).toThrow(expected);
  });
});

describe('OpenAI Realtime credential provider', () => {
  it('sends the exact bounded audio session and returns only the normalized credential', async () => {
    type CreateMethod = OpenAIRealtimeClient['realtime']['clientSecrets']['create'];
    const calls: {
      body: Parameters<CreateMethod>[0];
      options: Parameters<CreateMethod>[1];
    }[] = [];
    const create = (
      body: Parameters<CreateMethod>[0],
      options: Parameters<CreateMethod>[1],
    ) => {
      calls.push({ body, options });
      return Promise.resolve({
        value: EPHEMERAL_VALUE,
        expires_at: NOW_SECONDS + 60,
        session: {
          id: 'sess_private_provider_shape',
          object: 'realtime.session' as const,
          type: 'realtime' as const,
        },
      });
    };
    const client: OpenAIRealtimeClient = {
      realtime: {
        clientSecrets: {
          create: create as unknown as CreateMethod,
        },
      },
    };
    const safetySecret = new Uint8Array(32).fill(7);
    const provider = createOpenAIRealtimeCredentialProvider({
      apiKey: undefined,
      client,
      credentialTtlSeconds: 60,
      model: 'gpt-realtime-2.1-mini',
      safetySecret,
      timeoutMs: 1_234,
    });
    const controller = new AbortController();

    const result = await provider.create({ requestId: REQUEST_ID, signal: controller.signal });

    expect(result).toEqual({ value: EPHEMERAL_VALUE, expiresAt: NOW_SECONDS + 60 });
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'value']);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined || call.body.session?.type !== 'realtime') {
      throw new Error('Expected a Realtime session request.');
    }
    const instructions = call.body.session.instructions ?? '';
    expect(call.body).toEqual({
      expires_after: { anchor: 'created_at', seconds: 60 },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1-mini',
        max_output_tokens: 128,
        output_modalities: ['text'],
        audio: {
          input: { transcription: { model: 'gpt-4o-mini-transcribe' } },
        },
        instructions,
      },
    });
    expect(instructions.length).toBeLessThanOrEqual(1_200);
    expect(instructions.toLocaleLowerCase('en-US')).toContain('one question mark');
    expect(instructions.toLocaleLowerCase('en-US')).toContain('45 words');
    expect(instructions.toLocaleLowerCase('en-US')).toContain('never ask why');
    expect(instructions.toLocaleLowerCase('en-US')).toContain('filler');
    expect(instructions.toLocaleLowerCase('en-US')).toContain('challenge');
    expect(instructions.toLocaleLowerCase('en-US')).toContain('conclusion');
    expect(instructions).not.toContain(REQUEST_ID);
    const expectedSafetyIdentifier = createHmac('sha256', safetySecret)
      .update(REQUEST_ID)
      .digest('hex');
    expect(call.options).toMatchObject({
      headers: { 'OpenAI-Safety-Identifier': expectedSafetyIdentifier },
      maxRetries: 0,
      signal: controller.signal,
      timeout: 1_234,
    });
    expect(JSON.stringify(calls)).not.toContain(LONG_LIVED_KEY);
    expect(JSON.stringify(result)).not.toContain('sess_private_provider_shape');
    expect(JSON.stringify(result)).not.toContain(expectedSafetyIdentifier);
  });

  it('rejects malformed provider credentials without exposing the provider body', async () => {
    type CreateMethod = OpenAIRealtimeClient['realtime']['clientSecrets']['create'];
    const create = () => Promise.resolve({
      value: '   ',
      expires_at: NOW_SECONDS + 60,
      session: { raw: RAW_PROVIDER_SECRET },
    });
    const client: OpenAIRealtimeClient = {
      realtime: {
        clientSecrets: {
          create: create as unknown as CreateMethod,
        },
      },
    };
    const provider = createOpenAIRealtimeCredentialProvider({
      apiKey: undefined,
      client,
      credentialTtlSeconds: 60,
      model: 'gpt-realtime',
      safetySecret: new Uint8Array(32).fill(3),
      timeoutMs: 500,
    });

    await expect(provider.create({
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })).rejects.not.toThrow(RAW_PROVIDER_SECRET);
  });
});

describe('Realtime credential service', () => {
  it('does not invoke the provider for a pre-aborted request', async () => {
    const provider = new ScriptedRealtimeProvider();
    const service = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider,
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const controller = new AbortController();
    controller.abort();

    const result = await service.create({ requestId: REQUEST_ID, signal: controller.signal });

    expect(result).toEqual({
      ok: false,
      error: createServiceError('timeout', REQUEST_ID),
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('returns a future short-lived credential and records metadata without credential content', async () => {
    const provider = new ScriptedRealtimeProvider();
    const telemetry = new CapturingRealtimeMetadataSink();
    const service = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider,
      telemetry,
    });

    const result = await service.create({
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: true,
      value: { value: EPHEMERAL_VALUE, expiresAt: NOW_SECONDS + 60 },
    });
    expect(telemetry.events).toEqual([{
      requestId: REQUEST_ID,
      latencyMs: 0,
      providerId: 'scripted-realtime',
      modelId: 'realtime-test-model',
      status: 'success',
    }]);
    expect(JSON.stringify(telemetry.events)).not.toContain(EPHEMERAL_VALUE);
  });

  it.each([
    ['expired', NOW_SECONDS],
    ['too long lived', NOW_SECONDS + 90],
    ['not an integer', NOW_SECONDS + 59.5],
  ])('rejects a %s credential expiry', async (_label, expiresAt) => {
    const provider = new ScriptedRealtimeProvider({
      respond: () => ({ value: EPHEMERAL_VALUE, expiresAt }),
    });
    const service = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider,
      telemetry: new CapturingRealtimeMetadataSink(),
    });

    const result = await service.create({
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: false,
      error: createServiceError('invalid_output', REQUEST_ID),
    });
  });

  it('maps missing configuration and raw provider failures to safe typed errors', async () => {
    const unavailable = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider: new ScriptedRealtimeProvider({ configured: false }),
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const failing = createRealtimeCredentialService({
      credentialTtlSeconds: 60,
      now: () => NOW_MS,
      provider: new ScriptedRealtimeProvider({
        respond: () => Promise.reject(new Error(`${RAW_PROVIDER_SECRET}:${LONG_LIVED_KEY}`)),
      }),
      telemetry: new CapturingRealtimeMetadataSink(),
    });
    const request = { requestId: REQUEST_ID, signal: new AbortController().signal };

    const [missingResult, failureResult] = await Promise.all([
      unavailable.create(request),
      failing.create(request),
    ]);

    expect(missingResult).toEqual({
      ok: false,
      error: createServiceError('provider_unavailable', REQUEST_ID),
    });
    expect(failureResult).toEqual({
      ok: false,
      error: createServiceError('provider_unavailable', REQUEST_ID),
    });
    expect(JSON.stringify([missingResult, failureResult])).not.toContain(RAW_PROVIDER_SECRET);
    expect(JSON.stringify([missingResult, failureResult])).not.toContain(LONG_LIVED_KEY);
  });
});
