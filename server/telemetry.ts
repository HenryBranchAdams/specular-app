import type { Operation, RequestId, SpecularErrorCode } from '../src/domain/contracts';

export interface ProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type SchemaOutcome = 'not_checked' | 'valid' | 'invalid';

export interface ServerTelemetryEvent {
  requestId: RequestId;
  operation: Operation;
  latencyMs: number;
  providerId: string;
  modelId: string;
  tokenUsage?: ProviderTokenUsage;
  schemaOutcome: SchemaOutcome;
  repairCount: 0 | 1;
  status: 'success' | 'error';
  errorCode?: SpecularErrorCode;
}

export interface MetadataSink {
  record(event: ServerTelemetryEvent): void | Promise<void>;
}

export class JsonMetadataSink implements MetadataSink {
  record(event: ServerTelemetryEvent): void {
    console.info(JSON.stringify(event));
  }
}

export class NullMetadataSink implements MetadataSink {
  record(): void {
    // Deliberately empty. The production default is explicit at composition time.
  }
}
