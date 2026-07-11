export type CrisisRegion = 'AU' | 'CA' | 'EU' | 'GB' | 'US' | 'other';
export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  allowedOrigins: string[];
  openAiApiKey?: string;
  openAiModel: string;
  requestTimeoutMs: number;
  requestBytes: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  enableRealtime: boolean;
  realtimeModel?: string;
  realtimeCredentialTtlSeconds?: number;
  crisisRegion: CrisisRegion;
}

export interface LoadedServerConfig extends ServerConfig {
  host: '0.0.0.0' | '127.0.0.1';
  realtimeModel: string;
  realtimeCredentialTtlSeconds: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function parseNodeEnvironment(value: string | undefined): ServerConfig['nodeEnv'] {
  switch (value ?? 'development') {
    case 'development':
      return 'development';
    case 'test':
      return 'test';
    case 'production':
      return 'production';
    default:
      throw new Error('NODE_ENV must be development, test, or production.');
  }
}

function parseHost(
  value: string | undefined,
  nodeEnv: ServerConfig['nodeEnv'],
): LoadedServerConfig['host'] {
  const fallback = nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
  const normalized = value?.trim();
  const host = normalized === undefined || normalized === '' ? fallback : normalized;
  if (host !== '0.0.0.0' && host !== '127.0.0.1') {
    throw new Error('HOST must be 0.0.0.0 or 127.0.0.1.');
  }
  return host;
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return parsed;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  switch (value.toLocaleLowerCase('en-US')) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      throw new Error(`${name} must be true or false.`);
  }
}

function parseOrigin(value: string): string {
  if (value === '*') {
    throw new Error('Allowed origin cannot be a wildcard.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Allowed origin must be a valid absolute origin.');
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new Error('Allowed origin must contain only an http or https origin.');
  }

  return parsed.origin;
}

function parseAllowedOrigins(value: string | undefined, nodeEnv: ServerConfig['nodeEnv']): string[] {
  if (value === undefined || value.trim() === '') {
    return nodeEnv === 'production'
      ? []
      : ['http://localhost:5177', 'http://127.0.0.1:5177'];
  }

  const origins = value.split(',').map((origin) => parseOrigin(origin.trim()));
  if (origins.length === 0 || origins.some((origin) => origin.length === 0)) {
    throw new Error('At least one valid allowed origin is required.');
  }
  return [...new Set(origins)];
}

function parseCrisisRegion(value: string | undefined): CrisisRegion {
  switch ((value ?? 'US').toLocaleUpperCase('en-US')) {
    case 'AU':
      return 'AU';
    case 'CA':
      return 'CA';
    case 'EU':
      return 'EU';
    case 'GB':
    case 'UK':
      return 'GB';
    case 'US':
      return 'US';
    case 'OTHER':
      return 'other';
    default:
      throw new Error('CRISIS_REGION must be AU, CA, EU, GB, US, or other.');
  }
}

function parseModel(
  name: 'OPENAI_MODEL' | 'OPENAI_REALTIME_MODEL',
  value: string | undefined,
  fallback: string,
): string {
  const normalized = value?.trim();
  const model = normalized === undefined || normalized === '' ? fallback : normalized;
  if (model.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(model)) {
    throw new Error(`${name} is invalid.`);
  }
  return model;
}

export function loadServerConfig(environment: Environment = process.env): LoadedServerConfig {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);
  const openAiApiKey = environment.OPENAI_API_KEY?.trim();
  const base: LoadedServerConfig = {
    nodeEnv,
    host: parseHost(environment.HOST, nodeEnv),
    port: parseInteger('PORT', environment.PORT, 8788, 0, 65_535),
    allowedOrigins: parseAllowedOrigins(environment.ALLOWED_ORIGINS, nodeEnv),
    openAiModel: parseModel('OPENAI_MODEL', environment.OPENAI_MODEL, 'gpt-5.5'),
    requestTimeoutMs: parseInteger(
      'REQUEST_TIMEOUT_MS',
      environment.REQUEST_TIMEOUT_MS,
      15_000,
      25,
      120_000,
    ),
    requestBytes: parseInteger(
      'REQUEST_BYTES',
      environment.REQUEST_BYTES,
      512 * 1024,
      128,
      1024 * 1024,
    ),
    rateLimitWindowMs: parseInteger(
      'RATE_LIMIT_WINDOW_MS',
      environment.RATE_LIMIT_WINDOW_MS,
      60_000,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    rateLimitMax: parseInteger(
      'RATE_LIMIT_MAX',
      environment.RATE_LIMIT_MAX,
      30,
      1,
      10_000,
    ),
    enableRealtime: parseBoolean('ENABLE_REALTIME', environment.ENABLE_REALTIME, false),
    realtimeModel: parseModel(
      'OPENAI_REALTIME_MODEL',
      environment.OPENAI_REALTIME_MODEL,
      'gpt-realtime',
    ),
    realtimeCredentialTtlSeconds: parseInteger(
      'REALTIME_CREDENTIAL_TTL_SECONDS',
      environment.REALTIME_CREDENTIAL_TTL_SECONDS,
      60,
      10,
      7_200,
    ),
    crisisRegion: parseCrisisRegion(environment.CRISIS_REGION),
  };

  return openAiApiKey === undefined || openAiApiKey === ''
    ? base
    : { ...base, openAiApiKey };
}
