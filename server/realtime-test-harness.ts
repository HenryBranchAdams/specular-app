import { requestIdSchema } from '../src/domain/schemas';
import type {
  RealtimeCredential,
  RealtimeCredentialProvider,
  RealtimeCredentialRequest,
  RealtimeMetadataEvent,
  RealtimeMetadataSink,
} from './realtime';

export const NOW_MS = 1_800_000_000_000;
export const NOW_SECONDS = Math.floor(NOW_MS / 1_000);
export const REQUEST_ID = requestIdSchema.parse('00000000-0000-4000-8000-000000000001');
export const EPHEMERAL_VALUE = 'ek_test_short_lived_credential';
export const RAW_PROVIDER_SECRET = 'RAW-PROVIDER-BODY-DO-NOT-RETURN';
export const LONG_LIVED_KEY = 'sk-test-LONG-LIVED-KEY-DO-NOT-RETURN';

export class CapturingRealtimeMetadataSink implements RealtimeMetadataSink {
  readonly events: RealtimeMetadataEvent[] = [];

  record(event: RealtimeMetadataEvent): void {
    this.events.push(event);
  }
}

export class ScriptedRealtimeProvider implements RealtimeCredentialProvider {
  readonly configured: boolean;
  readonly providerId = 'scripted-realtime';
  readonly modelId = 'realtime-test-model';
  readonly calls: RealtimeCredentialRequest[] = [];
  private readonly respond: (
    request: RealtimeCredentialRequest,
  ) => RealtimeCredential | Promise<RealtimeCredential>;

  constructor(options: {
    configured?: boolean;
    respond?: (
      request: RealtimeCredentialRequest,
    ) => RealtimeCredential | Promise<RealtimeCredential>;
  } = {}) {
    this.configured = options.configured ?? true;
    this.respond = options.respond ?? (() => ({
      value: EPHEMERAL_VALUE,
      expiresAt: NOW_SECONDS + 60,
    }));
  }

  async create(request: RealtimeCredentialRequest): Promise<RealtimeCredential> {
    this.calls.push(request);
    return await this.respond(request);
  }
}
