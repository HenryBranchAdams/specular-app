import { createHttpServer } from './http';
import { loadServerConfig } from './config';
import { createOpenAIQuestioningProvider } from './openai-provider';
import { createOperationService } from './operation-service';
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
const server = createHttpServer({ config, service });

server.listen(config.port, () => {
  console.info(`Specular model service listening on port ${String(config.port)}.`);
});
