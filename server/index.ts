import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHttpServer } from './http';
import { loadServerConfig } from './config';
import { createSpecularMcpServer } from './mcp';
import { createOpenAIQuestioningProvider } from './openai-provider';
import { createOperationService } from './operation-service';
import {
  createOpenAIRealtimeCredentialProvider,
  createRealtimeCredentialService,
  JsonRealtimeMetadataSink,
} from './realtime';
import { JsonMetadataSink } from './telemetry';

const config = loadServerConfig();
const provider = createOpenAIQuestioningProvider({
  apiKey: config.openAiApiKey,
  model: config.openAiModel,
});
const service = createOperationService({
  provider,
  telemetry: new JsonMetadataSink(),
  safetyRegion: config.crisisRegion,
});
const realtimeProvider = createOpenAIRealtimeCredentialProvider({
  apiKey: config.openAiApiKey,
  credentialTtlSeconds: config.realtimeCredentialTtlSeconds,
  model: config.realtimeModel,
  timeoutMs: config.requestTimeoutMs,
});
const realtimeService = createRealtimeCredentialService({
  credentialTtlSeconds: config.realtimeCredentialTtlSeconds,
  provider: realtimeProvider,
  telemetry: new JsonRealtimeMetadataSink(),
});
const widgetHtml = readFileSync(
  new URL('./specular-widget.html', import.meta.url),
  'utf8',
);
const server = createHttpServer({
  config,
  service,
  createMcpServer: () => createSpecularMcpServer({ service, widgetHtml }),
  realtimeService,
  staticRoot: fileURLToPath(new URL('../dist/', import.meta.url)),
});

server.listen(config.port, config.host, () => {
  console.info(
    `Specular model service listening on http://${config.host}:${String(config.port)}.`,
  );
});
