import { useState } from 'react';
import type { WorkingConclusion } from '../domain/contracts';

export type ConclusionEditorAction = 'finish' | 'keep' | 'save' | null;

export interface ConclusionEditorProps {
  conclusion: WorkingConclusion;
  onFinish: (conclusion: WorkingConclusion) => void;
  onKeepDigging: (conclusion: WorkingConclusion) => void;
  onSaveCapsule: (conclusion: WorkingConclusion) => void;
  pendingAction: ConclusionEditorAction;
}

function wordCount(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length;
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function ConclusionEditor({
  conclusion,
  onFinish,
  onKeepDigging,
  onSaveCapsule,
  pendingAction,
}: ConclusionEditorProps) {
  const [draft, setDraft] = useState<WorkingConclusion>(() => conclusion);
  const [observations, setObservations] = useState(() => conclusion.observations.join('\n'));
  const [caveats, setCaveats] = useState(() => conclusion.caveats.join('\n'));
  const busy = pendingAction !== null;
  const updateListItem = (
    field: 'insights' | 'tensions',
    index: number,
    value: string,
  ) => {
    setDraft((current) => {
      const next = [...current[field]];
      next[index] = value;
      return { ...current, [field]: next };
    });
  };
  const conclusionForAction = (): WorkingConclusion => ({
    ...draft,
    insights: draft.insights.map((insight) => insight.trim()),
    observations: parseLines(observations),
    tensions: draft.tensions.map((tension) => tension.trim()).filter((tension) => (
      tension.length > 0
    )),
    caveats: parseLines(caveats),
  });

  return (
    <form
      aria-busy={busy}
      className="conclusion-editor"
      onSubmit={(event) => { event.preventDefault(); }}
    >
      <div className="conclusion-editor__fields">
        <label className="conclusion-field conclusion-field--thesis">
          <span className="conclusion-field__label">My current read is…</span>
          <textarea
            aria-label="My current read is…"
            aria-describedby="conclusion-thesis-guide"
            onChange={(event) => {
              const thesis = event.currentTarget.value;
              setDraft((current) => ({ ...current, thesis }));
            }}
            rows={5}
            value={draft.thesis}
          />
          <span className="conclusion-field__guide" id="conclusion-thesis-guide">
            {String(wordCount(draft.thesis))} / 150 words
          </span>
        </label>

        <fieldset className="conclusion-fieldset">
          <legend>Original insights</legend>
          <p>Keep 3–5 insights that are distinctly yours.</p>
          {draft.insights.map((insight, index) => (
            <label className="conclusion-field" key={`insight-${String(index)}`}>
              <span className="sr-only">Original insight {String(index + 1)}</span>
              <textarea
                aria-label={`Original insight ${String(index + 1)}`}
                onChange={(event) => {
                  const insight = event.currentTarget.value;
                  updateListItem('insights', index, insight);
                }}
                rows={2}
                value={insight}
              />
            </label>
          ))}
        </fieldset>

        <label className="conclusion-field">
          <span className="conclusion-field__label">Supporting observations</span>
          <textarea
            onChange={(event) => {
              setObservations(event.currentTarget.value);
            }}
            rows={4}
            value={observations}
          />
        </label>

        <fieldset className="conclusion-fieldset">
          <legend>Unresolved tensions</legend>
          <p>Keep no more than three tensions in view.</p>
          {draft.tensions.map((tension, index) => (
            <label className="conclusion-field" key={`tension-${String(index)}`}>
              <span className="sr-only">Unresolved tension {String(index + 1)}</span>
              <textarea
                aria-label={`Unresolved tension ${String(index + 1)}`}
                onChange={(event) => {
                  const tension = event.currentTarget.value;
                  updateListItem('tensions', index, tension);
                }}
                rows={2}
                value={tension}
              />
            </label>
          ))}
        </fieldset>

        <label className="conclusion-field">
          <span className="conclusion-field__label">Caveats</span>
          <textarea
            onChange={(event) => {
              setCaveats(event.currentTarget.value);
            }}
            rows={4}
            value={caveats}
          />
        </label>
      </div>

      <div className="conclusion-editor__actions">
        <button
          className="conclusion-editor__action touch-target"
          disabled={busy}
          onClick={() => { onKeepDigging(conclusionForAction()); }}
          type="button"
        >
          Keep digging
        </button>
        <button
          className="conclusion-editor__action touch-target"
          disabled={busy}
          onClick={() => { onSaveCapsule(conclusionForAction()); }}
          type="button"
        >
          Save as capsule
        </button>
        <button
          className="conclusion-editor__action conclusion-editor__action--primary touch-target"
          disabled={busy}
          onClick={() => { onFinish(conclusionForAction()); }}
          type="button"
        >
          Finish
        </button>
      </div>
    </form>
  );
}
