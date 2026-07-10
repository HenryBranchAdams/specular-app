import { z } from 'zod';
import type { Capsule, OwnerScope, Thread, Turn } from '../domain/contracts';
import {
  capsuleSchema,
  ownerScopeSchema,
  threadSchema,
  turnSchema,
} from '../domain/schemas';
import type { JsonValue, UserPreference } from './repositories';

const PREFERENCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_JSON_CHARACTER_ESCAPES: Readonly<Record<string, string>> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export const EXPORT_FORMAT = 'specular-export' as const;
export const EXPORT_VERSION = 1 as const;
export const RECOVERY_FORMAT = 'specular-recovery' as const;
export const RECOVERY_VERSION = 1 as const;

export interface SpecularExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: number;
  ownerScope: OwnerScope;
  threads: Thread[];
  turns: Turn[];
  capsules: Capsule[];
  preferences: UserPreference[];
}

export interface RecoveryStores {
  threads: unknown[];
  turns: unknown[];
  capsules: unknown[];
  preferences: unknown[];
}

export interface RecoverySnapshot {
  format: typeof RECOVERY_FORMAT;
  version: typeof RECOVERY_VERSION;
  exportedAt: number;
  ownerScope: OwnerScope;
  databaseName: string;
  databaseVersion: number;
  stores: RecoveryStores;
}

export class ExportValidationError extends Error {
  constructor(message = 'Invalid Specular export.') {
    super(message);
    this.name = 'ExportValidationError';
  }
}

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const valid = value.every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return false;
  }

  const valid = Object.values(value as Record<string, unknown>)
    .every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

export const userPreferenceSchema = z.object({
  ownerScope: ownerScopeSchema,
  key: z.string().regex(PREFERENCE_KEY_PATTERN),
  value: z.unknown().refine(isJsonValue, 'Preference values must be JSON-safe.'),
}).strict();

const specularExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.number().int().nonnegative().finite(),
  ownerScope: ownerScopeSchema,
  threads: z.array(threadSchema),
  turns: z.array(turnSchema),
  capsules: z.array(capsuleSchema),
  preferences: z.array(userPreferenceSchema),
}).strict().superRefine((archive, refinement) => {
  addDuplicateAggregateIdIssues(archive, refinement);
  addDuplicateKeyIssues(
    archive.preferences,
    'preference',
    refinement,
    (preference) => preference.key,
  );
  addArchiveIntegrityIssues(archive, refinement);
});

function addDuplicateAggregateIdIssues(
  archive: Pick<SpecularExport, 'threads' | 'turns' | 'capsules'>,
  refinement: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  const inspect = (values: { id: string }[], path: string): void => {
    values.forEach((value, index) => {
      if (seen.has(value.id)) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate aggregate identifier.',
          path: [path, index, 'id'],
        });
      }
      seen.add(value.id);
    });
  };

  inspect(archive.threads, 'threads');
  inspect(archive.turns, 'turns');
  inspect(archive.capsules, 'capsules');
}

function addDuplicateKeyIssues<T>(
  values: T[],
  label: string,
  refinement: z.RefinementCtx,
  keyFor: (value: T) => string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = keyFor(value);
    if (seen.has(key)) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${label} identifier.`,
        path: [index],
      });
    }
    seen.add(key);
  });
}

function addArchiveIntegrityIssues(
  archive: Pick<SpecularExport, 'threads' | 'turns' | 'capsules'>,
  refinement: z.RefinementCtx,
): void {
  const threadsById = new Map(archive.threads.map((thread) => [thread.id, thread]));
  const turnsById = new Map(archive.turns.map((turn) => [turn.id, turn]));
  const turnsByThread = new Map<string, { index: number; turn: Turn }[]>();
  const positionsByThread = new Map<string, Set<number>>();

  archive.turns.forEach((turn, index) => {
    if (!threadsById.has(turn.threadId)) {
      addIntegrityIssue(
        refinement,
        'Every turn must reference an exported thread.',
        ['turns', index, 'threadId'],
      );
    }

    const threadTurns = turnsByThread.get(turn.threadId) ?? [];
    threadTurns.push({ index, turn });
    turnsByThread.set(turn.threadId, threadTurns);

    const positions = positionsByThread.get(turn.threadId) ?? new Set<number>();
    if (positions.has(turn.position)) {
      addIntegrityIssue(
        refinement,
        'Turn positions must be unique within a thread.',
        ['turns', index, 'position'],
      );
    }
    positions.add(turn.position);
    positionsByThread.set(turn.threadId, positions);
  });

  archive.threads.forEach((thread, threadIndex) => {
    const referencedTurnIds = new Set<string>();
    let previousPosition: number | undefined;

    thread.turnIds.forEach((turnId, turnIndex) => {
      if (referencedTurnIds.has(turnId)) {
        addIntegrityIssue(
          refinement,
          'Thread turn references must be unique.',
          ['threads', threadIndex, 'turnIds', turnIndex],
        );
      }
      referencedTurnIds.add(turnId);

      const turn = turnsById.get(turnId);
      if (turn === undefined) {
        addIntegrityIssue(
          refinement,
          'Every thread turn reference must resolve to an exported turn.',
          ['threads', threadIndex, 'turnIds', turnIndex],
        );
        return;
      }
      if (turn.threadId !== thread.id) {
        addIntegrityIssue(
          refinement,
          'Every referenced turn must belong to its thread.',
          ['threads', threadIndex, 'turnIds', turnIndex],
        );
        return;
      }
      if (previousPosition !== undefined && turn.position <= previousPosition) {
        addIntegrityIssue(
          refinement,
          'Thread turn references must follow increasing turn positions.',
          ['threads', threadIndex, 'turnIds', turnIndex],
        );
      }
      previousPosition = turn.position;
    });

    for (const { index, turn } of turnsByThread.get(thread.id) ?? []) {
      if (!referencedTurnIds.has(turn.id)) {
        addIntegrityIssue(
          refinement,
          'Every exported turn must appear in its thread turn references.',
          ['turns', index, 'id'],
        );
      }
    }
  });

  archive.capsules.forEach((capsule, capsuleIndex) => {
    const sourceThread = threadsById.get(capsule.sourceThreadId);
    const sourceTurnIds = [
      capsule.sourceTurnRange.startTurnId,
      capsule.sourceTurnRange.endTurnId,
      ...capsule.conclusion.provenance.map((item) => item.turnId),
    ];

    if (sourceThread === undefined) {
      sourceTurnIds.forEach((turnId, referenceIndex) => {
        if (turnsById.has(turnId)) {
          addIntegrityIssue(
            refinement,
            'An archived capsule cannot resolve to turns from a different source thread.',
            ['capsules', capsuleIndex, 'sourceTurnRange', referenceIndex],
          );
        }
      });
      return;
    }

    const sourceTurns = sourceTurnIds.map((turnId, referenceIndex) => {
      const turn = turnsById.get(turnId);
      if (turn?.threadId !== sourceThread.id) {
        addIntegrityIssue(
          refinement,
          'Capsule source and provenance turns must resolve within the source thread.',
          ['capsules', capsuleIndex, 'sourceTurnRange', referenceIndex],
        );
        return undefined;
      }
      return turn;
    });
    const startTurn = sourceTurns[0];
    const endTurn = sourceTurns[1];
    if (
      startTurn !== undefined
      && endTurn !== undefined
      && startTurn.position > endTurn.position
    ) {
      addIntegrityIssue(
        refinement,
        'Capsule source turn ranges must be ordered.',
        ['capsules', capsuleIndex, 'sourceTurnRange'],
      );
    }
    if (startTurn !== undefined && endTurn !== undefined) {
      sourceTurns.slice(2).forEach((turn, provenanceIndex) => {
        if (
          turn !== undefined
          && (turn.position < startTurn.position || turn.position > endTurn.position)
        ) {
          addIntegrityIssue(
            refinement,
            'Capsule provenance turns must fall within the source turn range.',
            ['capsules', capsuleIndex, 'conclusion', 'provenance', provenanceIndex],
          );
        }
      });
    }
  });
}

function addIntegrityIssue(
  refinement: z.RefinementCtx,
  message: string,
  path: (number | string)[],
): void {
  refinement.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path,
  });
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new ExportValidationError();
  }
}

export function parseSpecularExport(input: unknown): SpecularExport {
  const candidate = typeof input === 'string' ? parseJson(input) : input;
  const result = specularExportSchema.safeParse(candidate);
  if (!result.success) {
    const hasDuplicate = result.error.issues.some((issue) => issue.message.startsWith('Duplicate '));
    throw new ExportValidationError(
      hasDuplicate
        ? 'Invalid Specular export: duplicate identifiers.'
        : 'Invalid Specular export.',
    );
  }

  return result.data;
}

export function createExportFilename(exportedAt: number): string {
  if (!Number.isInteger(exportedAt) || exportedAt < 0) {
    throw new ExportValidationError('Invalid export timestamp.');
  }

  const date = new Date(exportedAt);
  if (!Number.isFinite(date.getTime())) {
    throw new ExportValidationError('Invalid export timestamp.');
  }

  return `specular-export-${date.toISOString().slice(0, 10)}.json`;
}

export function serializeExport(archive: SpecularExport): string {
  const validated = parseSpecularExport(archive);
  return JSON.stringify(validated, null, 2).replace(
    /[<>&\u2028\u2029]/gu,
    (character) => SAFE_JSON_CHARACTER_ESCAPES[character] ?? character,
  );
}
