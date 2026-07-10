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
    let enabled = false;
    await this.preferences.mutatePair(
      TELEMETRY_ENABLED_KEY,
      PRODUCT_TELEMETRY_EVENTS_KEY,
      ([storedEnabled, storedEvents]) => {
        enabled = storedEnabled === true;
        return enabled
          ? [true, storedEvents]
          : [false, undefined];
      },
    );
    return enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.preferences.mutatePair(
      TELEMETRY_ENABLED_KEY,
      PRODUCT_TELEMETRY_EVENTS_KEY,
      ([storedEnabled, storedEvents]) => enabled
        ? [true, storedEnabled === true ? storedEvents : undefined]
        : [false, undefined],
    );
  }

  async record(name: ProductTelemetryEventName): Promise<void> {
    const parsedName = productTelemetryEventNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new Error('Invalid product telemetry event.');
    }
    assertProductTelemetryEventName(parsedName.data);
    await this.preferences.mutatePair(
      TELEMETRY_ENABLED_KEY,
      PRODUCT_TELEMETRY_EVENTS_KEY,
      ([storedEnabled, storedEvents]) => {
        if (storedEnabled !== true) {
          return [false, undefined];
        }
        const parsedEvents = productTelemetryEventsSchema.safeParse(storedEvents);
        const current = parsedEvents.success ? parsedEvents.data : [];
        const event = productTelemetryEventSchema.parse({
          name: parsedName.data,
          timestamp: this.now(),
        });
        const events = [...current, event]
          .slice(-MAX_QUEUED_PRODUCT_EVENTS)
          .map((stored) => ({ ...stored }));
        return [true, events];
      },
    );
  }

  async listEvents(): Promise<ProductTelemetryEvent[]> {
    let events: ProductTelemetryEvent[] = [];
    await this.preferences.mutatePair(
      TELEMETRY_ENABLED_KEY,
      PRODUCT_TELEMETRY_EVENTS_KEY,
      ([storedEnabled, storedEvents]) => {
        if (storedEnabled !== true) {
          return [false, undefined];
        }
        const parsed = productTelemetryEventsSchema.safeParse(storedEvents);
        events = parsed.success ? parsed.data : [];
        return [true, parsed.success ? parsed.data : undefined];
      },
    );
    return events;
  }
}
