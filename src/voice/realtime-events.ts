import { z } from 'zod';
import { assertNever } from '../domain/contracts';
import { MAX_TURN_CONTENT_LENGTH } from '../domain/schemas';

const MAX_EVENT_IDENTIFIER_LENGTH = 512;
const eventIdentifierSchema = z.string().min(1).max(MAX_EVENT_IDENTIFIER_LENGTH);
const transcriptSchema = z.string().trim().min(1).max(MAX_TURN_CONTENT_LENGTH);

const inputTranscriptCompletedEventSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.completed'),
  item_id: eventIdentifierSchema,
  transcript: transcriptSchema,
}).passthrough();

const conversationItemCreatedEventSchema = z.object({
  type: z.literal('conversation.item.created'),
  item: z.object({
    id: eventIdentifierSchema,
    type: z.literal('message'),
    role: z.enum(['user', 'assistant', 'system']),
  }).passthrough(),
  previous_item_id: eventIdentifierSchema.nullable().optional(),
}).passthrough();

const outputTextDoneEventSchema = z.object({
  type: z.literal('response.output_text.done'),
  response_id: eventIdentifierSchema,
  item_id: eventIdentifierSchema,
  text: transcriptSchema,
}).passthrough();

const outputAudioTranscriptDoneEventSchema = z.object({
  type: z.literal('response.output_audio_transcript.done'),
  response_id: eventIdentifierSchema,
  item_id: eventIdentifierSchema,
  transcript: transcriptSchema,
}).passthrough();

const responseDoneEventSchema = z.object({
  type: z.literal('response.done'),
  response: z.object({
    id: eventIdentifierSchema,
    status: z.enum(['completed', 'cancelled', 'failed', 'incomplete']),
    output: z.array(z.object({ id: eventIdentifierSchema }).passthrough()).max(16).optional(),
  }).passthrough(),
}).passthrough();

const realtimeErrorEventSchema = z.object({
  type: z.literal('error'),
  error: z.object({}).passthrough(),
}).passthrough();

const supportedEventSchema = z.discriminatedUnion('type', [
  inputTranscriptCompletedEventSchema,
  conversationItemCreatedEventSchema,
  outputTextDoneEventSchema,
  outputAudioTranscriptDoneEventSchema,
  responseDoneEventSchema,
  realtimeErrorEventSchema,
]);

const eventEnvelopeSchema = z.object({ type: z.string() }).passthrough();

type SupportedRealtimeEvent = z.infer<typeof supportedEventSchema>;
type ResponseStatus = z.infer<typeof responseDoneEventSchema>['response']['status'];
type MessageRole = z.infer<typeof conversationItemCreatedEventSchema>['item']['role'];

export type RealtimeMessageOutcome =
  | 'handled'
  | 'ignored'
  | 'malformed'
  | 'realtime_error';

export interface CompletedTranscriptPair {
  assistantTranscript: string;
  userTranscript: string;
}

export interface RealtimeEventAccumulator {
  acceptMessage(data: unknown): RealtimeMessageOutcome;
  clear(): void;
}

interface AssistantTranscript {
  itemId: string;
  text: string;
}

type ParsedProviderEvent =
  | { kind: 'malformed' }
  | { kind: 'supported'; event: SupportedRealtimeEvent }
  | { kind: 'unknown' };

function parseProviderEvent(value: unknown): ParsedProviderEvent {
  const envelope = eventEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { kind: 'unknown' };
  }

  switch (envelope.data.type) {
    case 'conversation.item.input_audio_transcription.completed':
    case 'conversation.item.created':
    case 'response.output_text.done':
    case 'response.output_audio_transcript.done':
    case 'response.done':
    case 'error': {
      const parsed = supportedEventSchema.safeParse(value);
      return parsed.success
        ? { kind: 'supported', event: parsed.data }
        : { kind: 'malformed' };
    }
    default:
      return { kind: 'unknown' };
  }
}

export function createRealtimeEventAccumulator(
  onCompleted: (pair: CompletedTranscriptPair) => void,
): RealtimeEventAccumulator {
  const assistantItemIds = new Set<string>();
  const assistantTranscriptsByItem = new Map<string, string>();
  const completedResponseIds = new Set<string>();
  const consumedUserItemIds = new Set<string>();
  const itemRoles = new Map<string, MessageRole>();
  const previousItemIds = new Map<string, string | null>();
  const responseItemIds = new Map<string, string>();
  const responseDeclaredItemIds = new Map<string, string | undefined>();
  const responseStatuses = new Map<string, ResponseStatus>();
  const responseTranscripts = new Map<string, AssistantTranscript>();
  const userTranscripts = new Map<string, string>();

  const linkedUserItemId = (assistantItemId: string): string | undefined => {
    const visited = new Set<string>();
    let itemId = previousItemIds.get(assistantItemId);
    while (itemId !== undefined && itemId !== null && !visited.has(itemId)) {
      visited.add(itemId);
      const role = itemRoles.get(itemId);
      if (role === 'user') {
        return userTranscripts.has(itemId) ? itemId : undefined;
      }
      itemId = previousItemIds.get(itemId);
    }
    return undefined;
  };

  const emitCompleted = (): void => {
    for (const [responseId, status] of responseStatuses) {
      if (status !== 'completed' || completedResponseIds.has(responseId)) {
        continue;
      }
      const assistant = responseTranscripts.get(responseId);
      const assistantItemId = assistant?.itemId ?? responseItemIds.get(responseId);
      const userItemId = assistantItemId === undefined
        ? undefined
        : linkedUserItemId(assistantItemId);
      const userTranscript = userItemId === undefined
        ? undefined
        : userTranscripts.get(userItemId);
      if (
        assistant === undefined
        || userItemId === undefined
        || userTranscript === undefined
        || consumedUserItemIds.has(userItemId)
      ) {
        continue;
      }
      completedResponseIds.add(responseId);
      consumedUserItemIds.add(userItemId);
      onCompleted({ assistantTranscript: assistant.text, userTranscript });
    }
  };

  const recordAssistant = (responseId: string, itemId: string, text: string): boolean => {
    const status = responseStatuses.get(responseId);
    const declaredItemId = responseItemIds.get(responseId);
    if (declaredItemId !== undefined && declaredItemId !== itemId) {
      return false;
    }
    const existingResponse = responseTranscripts.get(responseId);
    if (existingResponse !== undefined) {
      return existingResponse.itemId === itemId && existingResponse.text === text;
    }
    const existingItemText = assistantTranscriptsByItem.get(itemId);
    if (existingItemText !== undefined) {
      return existingItemText === text;
    }
    if ((status !== undefined && status !== 'completed') || completedResponseIds.has(responseId)) {
      return true;
    }
    assistantItemIds.add(itemId);
    assistantTranscriptsByItem.set(itemId, text);
    responseItemIds.set(responseId, itemId);
    responseTranscripts.set(responseId, { itemId, text });
    emitCompleted();
    return true;
  };

  const recordResponseStatus = (
    responseId: string,
    status: ResponseStatus,
    outputItemId: string | undefined,
  ): boolean => {
    const transcriptItemId = responseTranscripts.get(responseId)?.itemId;
    const declaredItemId = responseItemIds.get(responseId);
    if (
      outputItemId !== undefined
      && (
        (transcriptItemId !== undefined && transcriptItemId !== outputItemId)
        || (declaredItemId !== undefined && declaredItemId !== outputItemId)
      )
    ) {
      return false;
    }
    if (responseStatuses.has(responseId)) {
      return responseStatuses.get(responseId) === status
        && responseDeclaredItemIds.get(responseId) === outputItemId;
    }
    responseStatuses.set(responseId, status);
    responseDeclaredItemIds.set(responseId, outputItemId);
    if (outputItemId !== undefined) {
      responseItemIds.set(responseId, outputItemId);
    }
    switch (status) {
      case 'completed':
        emitCompleted();
        return true;
      case 'cancelled':
      case 'failed':
      case 'incomplete':
        responseTranscripts.delete(responseId);
        return true;
      default:
        return assertNever(status);
    }
  };

  const handleSupported = (event: SupportedRealtimeEvent): RealtimeMessageOutcome => {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed':
        if (userTranscripts.has(event.item_id)) {
          return userTranscripts.get(event.item_id) === event.transcript
            ? 'handled'
            : 'malformed';
        }
        userTranscripts.set(event.item_id, event.transcript);
        emitCompleted();
        return 'handled';
      case 'conversation.item.created':
        if (
          (itemRoles.has(event.item.id) && itemRoles.get(event.item.id) !== event.item.role)
          || (
            previousItemIds.has(event.item.id)
            && previousItemIds.get(event.item.id) !== (event.previous_item_id ?? null)
          )
        ) {
          return 'malformed';
        }
        itemRoles.set(event.item.id, event.item.role);
        previousItemIds.set(event.item.id, event.previous_item_id ?? null);
        emitCompleted();
        return 'handled';
      case 'response.output_text.done':
        return recordAssistant(event.response_id, event.item_id, event.text)
          ? 'handled'
          : 'malformed';
      case 'response.output_audio_transcript.done':
        return recordAssistant(event.response_id, event.item_id, event.transcript)
          ? 'handled'
          : 'malformed';
      case 'response.done':
        return recordResponseStatus(
          event.response.id,
          event.response.status,
          event.response.output?.[0]?.id,
        ) ? 'handled' : 'malformed';
      case 'error':
        return 'realtime_error';
      default:
        return assertNever(event);
    }
  };

  return {
    acceptMessage(data: unknown): RealtimeMessageOutcome {
      if (typeof data !== 'string') {
        return 'ignored';
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(data) as unknown;
      } catch {
        return 'ignored';
      }
      const parsed = parseProviderEvent(decoded);
      switch (parsed.kind) {
        case 'unknown':
          return 'ignored';
        case 'malformed':
          return 'malformed';
        case 'supported':
          return handleSupported(parsed.event);
        default:
          return assertNever(parsed);
      }
    },

    clear(): void {
      assistantItemIds.clear();
      assistantTranscriptsByItem.clear();
      completedResponseIds.clear();
      consumedUserItemIds.clear();
      itemRoles.clear();
      previousItemIds.clear();
      responseItemIds.clear();
      responseDeclaredItemIds.clear();
      responseStatuses.clear();
      responseTranscripts.clear();
      userTranscripts.clear();
    },
  };
}
