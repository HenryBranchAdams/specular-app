import {
  useRef,
  useState,
  type RefObject,
} from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { assertNever } from '../domain/contracts';
import type {
  Capsule,
  CapsuleId,
  ThreadId,
  WorkingConclusion,
} from '../domain/contracts';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { useModalFocus } from './use-modal-focus';

export interface CapsuleLibraryProps {
  busy: boolean;
  capsules: readonly Capsule[];
  currentThread: { id: ThreadId; title: string } | null;
  onClose: () => void;
  onDeleteAll: () => Promise<void>;
  onDeleteCapsule: (capsuleId: CapsuleId) => Promise<void>;
  onDeleteThread: (threadId: ThreadId) => Promise<void>;
  onExport: () => Promise<void>;
  onUpdateCapsule: (
    capsuleId: CapsuleId,
    conclusion: WorkingConclusion,
  ) => Promise<void>;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

interface CapsuleDetailProps {
  busy: boolean;
  capsule: Capsule;
  onSave: (capsuleId: CapsuleId, conclusion: WorkingConclusion) => Promise<void>;
}

type DeleteRequest =
  | {
    artifactTitle: string;
    capsuleId: CapsuleId;
    kind: 'capsule';
    restoreFocusTo: HTMLElement;
  }
  | {
    artifactTitle: string;
    kind: 'thread';
    restoreFocusTo: HTMLElement;
    threadId: ThreadId;
  }
  | {
    artifactTitle: string;
    kind: 'all';
    restoreFocusTo: HTMLElement;
  };

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function localDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function CapsuleDetail({ busy, capsule, onSave }: CapsuleDetailProps) {
  const [draft, setDraft] = useState<WorkingConclusion>(() => capsule.conclusion);
  const [insights, setInsights] = useState(() => capsule.conclusion.insights.join('\n'));
  const [observations, setObservations] = useState(() => (
    capsule.conclusion.observations.join('\n')
  ));
  const [tensions, setTensions] = useState(() => capsule.conclusion.tensions.join('\n'));
  const [caveats, setCaveats] = useState(() => capsule.conclusion.caveats.join('\n'));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (busy || saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave(capsule.id, {
        ...draft,
        insights: parseLines(insights),
        observations: parseLines(observations),
        tensions: parseLines(tensions).slice(0, 3),
        caveats: parseLines(caveats),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="capsule-detail-title" className="capsule-detail">
      <h3 id="capsule-detail-title">{capsule.title}</h3>
      <p className="capsule-detail__date">{localDate(capsule.createdAt)}</p>
      <label className="capsule-detail__field">
        <span>Current conclusion</span>
        <textarea
          onChange={(event) => {
            const thesis = event.currentTarget.value;
            setDraft((current) => ({ ...current, thesis }));
          }}
          rows={6}
          value={draft.thesis}
        />
      </label>
      <label className="capsule-detail__field">
        <span>Original insights</span>
        <textarea
          onChange={(event) => { setInsights(event.currentTarget.value); }}
          rows={6}
          value={insights}
        />
      </label>
      <label className="capsule-detail__field">
        <span>Supporting observations</span>
        <textarea
          onChange={(event) => { setObservations(event.currentTarget.value); }}
          rows={5}
          value={observations}
        />
      </label>
      <label className="capsule-detail__field">
        <span>Unresolved tensions</span>
        <textarea
          onChange={(event) => { setTensions(event.currentTarget.value); }}
          rows={5}
          value={tensions}
        />
      </label>
      <label className="capsule-detail__field">
        <span>Caveats</span>
        <textarea
          onChange={(event) => { setCaveats(event.currentTarget.value); }}
          rows={4}
          value={caveats}
        />
      </label>
      <button
        className="capsule-library__primary touch-target"
        disabled={busy || saving}
        onClick={() => { void save(); }}
        type="button"
      >
        {saving ? 'Saving…' : 'Save capsule edits'}
      </button>
    </section>
  );
}

export function CapsuleLibrary({
  busy,
  capsules,
  currentThread,
  onClose,
  onDeleteAll,
  onDeleteCapsule,
  onDeleteThread,
  onExport,
  onUpdateCapsule,
  open,
  triggerRef,
}: CapsuleLibraryProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<CapsuleId | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useModalFocus({
    active: open,
    containerRef: modalRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
    restoreFocusTo: triggerRef.current,
  });

  if (!open) {
    return null;
  }

  const orderedCapsules = [...capsules].sort((left, right) => right.createdAt - left.createdAt);
  const selected = selectedId === null
    ? null
    : orderedCapsules.find((capsule) => capsule.id === selectedId) ?? null;

  const updateCapsule = async (
    capsuleId: CapsuleId,
    conclusion: WorkingConclusion,
  ): Promise<void> => {
    if (busy) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await onUpdateCapsule(capsuleId, conclusion);
      setNotice('Capsule updated.');
    } catch {
      setError('The capsule edit could not be saved. Your local draft remains on screen.');
    }
  };

  const exportArchive = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await onExport();
      setNotice('Export downloaded.');
    } catch {
      setError('The export could not be downloaded. No local content was changed.');
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const request = deleteRequest;
    if (busy || request === null) {
      return;
    }
    switch (request.kind) {
      case 'capsule':
        await onDeleteCapsule(request.capsuleId);
        setSelectedId(null);
        break;
      case 'thread':
        await onDeleteThread(request.threadId);
        onClose();
        break;
      case 'all':
        await onDeleteAll();
        onClose();
        break;
      default:
        assertNever(request);
    }
  };

  const confirmLabel = deleteRequest?.kind === 'capsule'
    ? 'Permanently delete capsule'
    : deleteRequest?.kind === 'thread'
      ? 'Permanently delete thread'
      : 'Permanently delete all local content';

  return (
    <div
      aria-labelledby="capsule-library-title"
      aria-modal="true"
      className="capsule-library"
      ref={modalRef}
      role="dialog"
    >
      <header className="capsule-library__header">
        {selected === null ? null : (
          <button
            aria-label="Back to capsule list"
            className="icon-button touch-target"
            onClick={() => { setSelectedId(null); }}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={22} />
          </button>
        )}
        <h2 id="capsule-library-title">Capsules</h2>
        <button
          aria-label="Close capsule library"
          className="icon-button touch-target"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <X aria-hidden="true" size={24} />
        </button>
      </header>

      <div className="capsule-library__body">
        {orderedCapsules.length === 0 ? (
          <p className="capsule-library__empty">No capsules yet.</p>
        ) : selected === null ? (
          <ol aria-label="Saved capsules" className="capsule-library__list">
            {orderedCapsules.map((capsule) => (
              <li key={capsule.id}>
                <button
                  aria-label={`${capsule.title}, ${localDate(capsule.createdAt)}`}
                  className="capsule-library__row touch-target"
                  disabled={busy}
                  onClick={() => { setSelectedId(capsule.id); }}
                  type="button"
                >
                  <span>{capsule.title}</span>
                  <time dateTime={new Date(capsule.createdAt).toISOString()}>
                    {localDate(capsule.createdAt)}
                  </time>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <CapsuleDetail
            busy={busy}
            capsule={selected}
            key={selected.id}
            onSave={updateCapsule}
          />
        )}
      </div>

      {error === null ? null : <p aria-live="assertive" role="alert">{error}</p>}
      <p aria-live="polite" className="capsule-library__notice" role="status">{notice}</p>

      <footer className="capsule-library__footer">
        <button
          className="capsule-library__secondary touch-target"
          disabled={busy}
          onClick={() => { void exportArchive(); }}
          type="button"
        >
          Export
        </button>
        {selected === null ? null : (
          <button
            className="capsule-library__danger touch-target"
            disabled={busy}
            onClick={(event) => {
              setDeleteRequest({
                artifactTitle: selected.title,
                capsuleId: selected.id,
                kind: 'capsule',
                restoreFocusTo: event.currentTarget,
              });
            }}
            type="button"
          >
            Permanently delete capsule
          </button>
        )}
        {selected !== null || currentThread === null ? null : (
          <button
            className="capsule-library__danger touch-target"
            disabled={busy}
            onClick={(event) => {
              setDeleteRequest({
                artifactTitle: currentThread.title,
                kind: 'thread',
                restoreFocusTo: event.currentTarget,
                threadId: currentThread.id,
              });
            }}
            type="button"
          >
            Delete current thread
          </button>
        )}
        {selected === null ? (
          <button
            className="capsule-library__danger touch-target"
            disabled={busy}
            onClick={(event) => {
              setDeleteRequest({
                artifactTitle: 'All local content',
                kind: 'all',
                restoreFocusTo: event.currentTarget,
              });
            }}
            type="button"
          >
            Delete all local content
          </button>
        ) : null}
      </footer>

      {deleteRequest === null ? null : (
        <ConfirmDeleteDialog
          artifactTitle={deleteRequest.artifactTitle}
          confirmLabel={confirmLabel}
          confirmDisabled={busy}
          onCancel={() => { setDeleteRequest(null); }}
          onConfirm={confirmDelete}
          restoreFocusTo={deleteRequest.restoreFocusTo}
        />
      )}
    </div>
  );
}
