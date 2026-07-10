import { z } from 'zod';
import { assertNever } from '../domain/contracts';
import type { PreferencesRepository } from '../storage/repositories';

export const TELEMETRY_ENABLED_KEY = 'telemetryEnabled';
export const PRODUCT_TELEMETRY_EVENTS_KEY = 'productTelemetryEvents';
export const MAX_QUEUED_PRODUCT_EVENTS = 1_000;

const productTelemetryEventNameSchema = z.enum([
  'thread_started',
  'turn_sent',
  'challenge_requested',
  'conclusion_requested',
  'capsule_saved',
  'voice_started',
  'recoverable_error',
]);

const productTelemetryEventSchema = z.object({
  name: productTelemetryEventNameSchema,
  timestamp: z.number().int().nonnegative().finite(),
}).strict();

const productTelemetryEventsSchema = z
  .array(productTelemetryEventSchema)
  .max(MAX_QUEUED_PRODUCT_EVENTS);

export type ProductTelemetryEventName = z.infer<typeof productTelemetryEventNameSchema>;
export type ProductTelemetryEvent = z.infer<typeof productTelemetryEventSchema>;

interface ProductTelemetryOptions {
  now?: () => number;
}

function assertProductTelemetryEventName(value: ProductTelemetryEventName): void {
  switch (value) {
    case 'thread_started':
    case 'turn_sent':
    case 'challenge_requested':
    case 'conclusion_requested':
    case 'capsule_saved':
    case 'voice_started':
    case 'recoverable_error':
      return;
    default:
      return assertNever(value);
  }
}

export class ProductTelemetry {
  private readonly now: () => number;

  constructor(
    private readonly preferences: PreferencesRepository,
    options: ProductTelemetryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async isEnabled(): Promise<boolean> {
    const stored = await this.preferences.get(TELEMETRY_ENABLED_KEY);
    if (stored === true) {
      return true;
    }

    await this.preferences.delete(PRODUCT_TELEMETRY_EVENTS_KEY);
    if (stored !== false) {
      await this.preferences.put(TELEMETRY_ENABLED_KEY, false);
    }
    return false;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.preferences.delete(PRODUCT_TELEMETRY_EVENTS_KEY);
    }
    await this.preferences.put(TELEMETRY_ENABLED_KEY, enabled);
  }

  async record(name: ProductTelemetryEventName): Promise<void> {
    const parsedName = productTelemetryEventNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new Error('Invalid product telemetry event.');
    }
    assertProductTelemetryEventName(parsedName.data);
    if (!await this.isEnabled()) {
      return;
    }

    const event = productTelemetryEventSchema.parse({
      name: parsedName.data,
      timestamp: this.now(),
    });
    const current = await this.readStoredEvents();
    const events = [...current, event].slice(-MAX_QUEUED_PRODUCT_EVENTS);
    await this.preferences.put(
      PRODUCT_TELEMETRY_EVENTS_KEY,
      events.map((stored) => ({ ...stored })),
    );
  }

  async listEvents(): Promise<ProductTelemetryEvent[]> {
    if (!await this.isEnabled()) {
      return [];
    }
    return this.readStoredEvents();
  }

  private async readStoredEvents(): Promise<ProductTelemetryEvent[]> {
    const stored = await this.preferences.get(PRODUCT_TELEMETRY_EVENTS_KEY);
    if (stored === undefined) {
      return [];
    }
    const parsed = productTelemetryEventsSchema.safeParse(stored);
    if (!parsed.success) {
      await this.preferences.delete(PRODUCT_TELEMETRY_EVENTS_KEY);
      return [];
    }
    return parsed.data;
  }
}
