import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Library,
  Link2,
  LoaderCircle,
  Mic,
  Network,
  Paperclip,
  Pause,
  Play,
  Plus,
  Printer,
  Share2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  BrowserDictationController,
  type DictationCaptureHandlers,
  type DictationController,
} from '../dictation/capture';
import { HttpDictationService, type DictationService } from '../dictation/client';
import { clearCachedSession, type AuthenticatedSession } from '../auth/session';
import { deleteHostedAccount, downloadAccountArchive, downloadDeviceRecovery } from '../account/client';
import { downloadMarkdown } from '../thinking/export';
import {
  createInitialWorkspace,
  effectiveStatus,
  newId,
  type ContextScope,
  type DictationDraft,
  type MarginAnnotation,
  type ReflectionDirection,
  type ReflectionMove,
  type SourceReference,
  type ThoughtBlock,
  type ThoughtDocument,
  type ThoughtKind,
  type ThoughtSnapshot,
  type WorkspaceState,
} from '../thinking/model';
import { HttpOrganizer, type Organizer } from '../thinking/organize-client';
import { createWorkspaceStore, type WorkspaceStore } from '../thinking/persistence';
import {
  HttpReflector,
  type ReflectionContextBlock,
  type Reflector,
} from '../thinking/reflect-client';
import {
  HttpSharePublisher,
  listPublishedSnapshots,
  loadPublishedSnapshot,
  revokeHostedSnapshot,
  revokePublishedSnapshot,
  type HostedSnapshotSummary,
  type PublishedSnapshot,
  type SharePublisher,
} from '../thinking/share-client';

export interface AppProps {
  session?: AuthenticatedSession;
  initialState?: WorkspaceState;
  reflector?: Reflector;
  organizer?: Organizer;
  sharePublisher?: SharePublisher;
  storeFactory?: () => Promise<WorkspaceStore>;
  dependencies?: unknown;
  downloadFile?: unknown;
  runtime?: unknown;
  dictationController?: DictationController;
  dictationService?: DictationService;
}

type WorkspaceView = 'document' | 'connections';

const MOVE_LABELS: Readonly<Record<Exclude<ReflectionMove, 'calibrate'>, string>> = {
  reflect: 'Reflect',
  clarify: 'Clarify',
  distinguish: 'Draw a distinction',
  challenge: 'Challenge',
  implications: 'Trace implications',
  perspective: 'Bring another perspective',
  check_premise: 'Check this premise',
};

const KIND_LABELS: Readonly<Record<ThoughtKind, string>> = {
  thought: 'Thought',
  question: 'Question',
  definition: 'Definition',
  hypothesis: 'Hypothesis',
  reference: 'Reference',
};

const STARTERS = [
  ['Explore what I think', 'Begin with the part you can almost say, but not quite.'],
  ['Define something difficult', 'Write the definition that currently feels least wrong.'],
  ['Follow a tension', 'Name the two things that do not sit together cleanly.'],
  ['Respond to a source', 'Start with what the source changes—or fails to change—for you.'],
] as const;

function activeDocument(state: WorkspaceState): ThoughtDocument {
  const document = state.documents.find((item) => item.id === state.activeDocumentId)
    ?? state.documents[0]
    ?? createInitialWorkspace().documents[0];
  if (document === undefined) {
    throw new Error('Specular could not create its initial document.');
  }
  return document;
}

function documentBlocks(state: WorkspaceState, document: ThoughtDocument): ThoughtBlock[] {
  const byId = new Map(state.blocks.map((block) => [block.id, block]));
  return document.blockIds.flatMap((id) => {
    const block = byId.get(id);
    return block === undefined ? [] : [block];
  });
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

function contextBlocksFor(
  state: WorkspaceState,
  document: ThoughtDocument,
  focusBlock: ThoughtBlock,
  scope: ContextScope,
): ReflectionContextBlock[] {
  let blocks: ThoughtBlock[];
  if (scope === 'selection') {
    blocks = [focusBlock];
  } else if (scope === 'connections') {
    const ids = new Set([focusBlock.id]);
    for (const connection of state.connections) {
      if (connection.fromBlockId === focusBlock.id) ids.add(connection.toBlockId);
      if (connection.toBlockId === focusBlock.id) ids.add(connection.fromBlockId);
    }
    blocks = state.blocks.filter((block) => ids.has(block.id));
  } else if (scope === 'document') {
    blocks = documentBlocks(state, document);
  } else {
    blocks = state.blocks;
  }
  return blocks
    .filter((block) => block.content.trim().length > 0)
    .map((block) => ({ id: block.id, content: block.content, kind: block.kind }));
}

function snapshotPayload(
  state: WorkspaceState,
  snapshot: ThoughtSnapshot,
): PublishedSnapshot {
  const blockMap = new Map(state.blocks.map((block) => [block.id, block]));
  return {
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    blocks: snapshot.blockIds.flatMap((id) => {
      const block = blockMap.get(id);
      return block === undefined || block.content.trim().length === 0
        ? []
        : [{
            id: block.id,
            content: block.content,
            kind: block.kind,
            references: block.references.filter((reference) => reference.title.trim().length > 0),
          }];
    }),
  };
}

function PublishedPage({ slug }: { slug: string }) {
  const [snapshot, setSnapshot] = useState<PublishedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadPublishedSnapshot(slug).then(
      (value) => { if (active) setSnapshot(value); },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'This snapshot is unavailable.');
      },
    );
    return () => { active = false; };
  }, [slug]);

  if (error !== null) {
    return <main className="published-page"><p className="published-kicker">Specular</p><h1>{error}</h1></main>;
  }
  if (snapshot === null) {
    return <main className="published-page"><LoaderCircle aria-label="Loading snapshot" className="spin" /></main>;
  }
  const references = snapshot.blocks.flatMap((block) => block.references);
  return (
    <main className="published-page">
      <p className="published-kicker">A Specular reflection</p>
      <h1>{snapshot.title}</h1>
      <p className="published-date">Captured {new Date(snapshot.createdAt).toLocaleDateString()}</p>
      <article className="published-body">
        {snapshot.blocks.map((block) => block.references.length > 0
          ? <blockquote key={block.id}>{block.content}</blockquote>
          : <p key={block.id}>{block.content}</p>)}
      </article>
      {references.length === 0 ? null : (
        <section className="published-references">
          <h2>References</h2>
          <ol>{references.map((reference) => (
            <li key={reference.id}>
              {reference.author.length > 0 ? `${reference.author}. ` : ''}
              {reference.url.length > 0
                ? <a href={reference.url}>{reference.title}</a>
                : reference.title}
            </li>
          ))}</ol>
        </section>
      )}
      <footer>Written and directed by its author in Specular.</footer>
    </main>
  );
}

function DocumentTitleEditor({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const resize = () => {
      element.style.height = '0px';
      element.style.height = `${String(Math.max(68, element.scrollHeight + 4))}px`;
    };
    resize();
    const fonts = Reflect.get(document, 'fonts') as FontFaceSet | undefined;
    if (fonts !== undefined) void fonts.ready.then(resize);
  }, [value]);
  return (
    <textarea
      aria-label="Document title"
      className="document-title"
      onChange={(event) => { onChange(event.target.value); }}
      placeholder="Untitled thought"
      ref={ref}
      rows={1}
      value={value}
    />
  );
}

function BlockEditor({
  block,
  canDictate,
  dictationActive,
  dictationDraft,
  dictationError,
  deletePending,
  focused,
  onAttachSource,
  onBlur,
  onChange,
  onDelete,
  onDeleteCancel,
  onDeleteConfirm,
  onDictationCancel,
  onDictationChange,
  onDictationFinish,
  onDictationKeep,
  onDictationPause,
  onDictationResume,
  onDictationStart,
  onDictationUseVerbatim,
  onFocus,
  onRemoveSource,
  onReferenceChange,
  onRestoreVersion,
  onSelection,
  placeholder,
}: {
  block: ThoughtBlock;
  canDictate: boolean;
  dictationActive: boolean;
  dictationDraft: DictationDraft | null;
  dictationError: string | null;
  deletePending: boolean;
  focused: boolean;
  onAttachSource: () => void;
  onBlur: () => void;
  onChange: (content: string) => void;
  onDelete: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
  onDictationCancel: () => void;
  onDictationChange: (content: string) => void;
  onDictationFinish: () => void;
  onDictationKeep: () => void;
  onDictationPause: () => void;
  onDictationResume: () => void;
  onDictationStart: (offset: number) => void;
  onDictationUseVerbatim: () => void;
  onFocus: () => void;
  onRemoveSource: () => void;
  onReferenceChange: (field: keyof Pick<SourceReference, 'author' | 'excerpt' | 'title' | 'url'>, value: string) => void;
  onRestoreVersion: (index: number) => void;
  onSelection: (text: string) => void;
  placeholder: string | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = '0px';
    textarea.style.height = `${String(Math.max(112, textarea.scrollHeight + 8))}px`;
  };
  useEffect(() => {
    resize();
    const fonts = Reflect.get(document, 'fonts') as FontFaceSet | undefined;
    if (fonts !== undefined) void fonts.ready.then(resize);
  }, [block.content]);
  const readSelection = () => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    onSelection(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd));
  };
  return (
    <article className={`thought-card${focused ? ' thought-card--focused' : ''}`} data-block-id={block.id}>
      <div className="thought-card__rail" aria-hidden="true" />
      <div className="thought-card__content">
        <div className="thought-card__meta">
          {block.parentId === null ? null : <span className="thought-card__linked"><Link2 size={12} /> linked</span>}
          {block.references.length > 0 ? null : (
            <button aria-label="Attach source" className="source-trigger" onClick={onAttachSource} title="Attach source" type="button"><Paperclip size={14} /></button>
          )}
          {deletePending ? (
            <span aria-label="Confirm block deletion" className="delete-confirmation" role="group">
              <button aria-label="Confirm delete block" className="delete-block delete-block--confirm" onClick={onDeleteConfirm} type="button">Delete?</button>
              <button aria-label="Cancel block deletion" className="delete-block" onClick={onDeleteCancel} type="button">Cancel</button>
            </span>
          ) : <button aria-label="Delete block" className="delete-block delete-block--icon" onClick={onDelete} title="Delete block" type="button"><Trash2 size={14} /></button>}
          {focused && !dictationActive && canDictate && !deletePending ? (
            <button
              aria-label="Start dictation"
              className="dictation-trigger"
              onClick={() => { onDictationStart(textareaRef.current?.selectionStart ?? block.content.length); }}
              title="Dictate into this block"
              type="button"
            ><Mic size={15} /></button>
          ) : null}
        </div>
        {block.originPrompt === null ? null : (
          <p className="thought-card__origin"><span>Working from</span>{block.originPrompt}</p>
        )}
        <textarea
          aria-label={`${KIND_LABELS[block.kind]} writing block`}
          className="thought-card__textarea"
          onBlur={onBlur}
          onChange={(event) => { onChange(event.target.value); }}
          onFocus={onFocus}
          onKeyUp={readSelection}
          onMouseUp={readSelection}
          placeholder={placeholder ?? (block.parentId === null
            ? 'Start anywhere. Write what is actually there.'
            : 'Continue in your own words…')}
          ref={textareaRef}
          readOnly={dictationActive}
          value={block.content}
        />
        {dictationDraft === null ? null : (
          <section aria-label="Dictation review" className={`dictation-draft dictation-draft--${dictationDraft.status}`}>
            <div className="dictation-draft__status" aria-live="polite">
              <span className="dictation-dot" aria-hidden="true" />
              {dictationDraft.status === 'recording' ? 'Recording · keep Specular open'
                : dictationDraft.status === 'requesting' ? 'Waiting for microphone permission…'
                : dictationDraft.status === 'paused' ? 'Paused · edit if you need to'
                  : dictationDraft.status === 'processing' ? 'Preparing your transcript…'
                    : dictationDraft.status === 'review' ? 'Review before it becomes writing'
                      : dictationDraft.interruptionReason === 'storage_failure'
                        ? 'Local saving failed · copy this draft before leaving'
                        : 'Dictation was interrupted. Your checkpointed text is still here.'}
            </div>
            {dictationDraft.status === 'interrupted' ? (
              <p className="dictation-interruption" role="alert">{dictationDraft.interruptionReason === 'storage_failure'
                ? 'Specular could not save this draft locally. Copy the text below before closing or reloading.'
                : 'Dictation was interrupted. Check the text below, then continue when ready.'}</p>
            ) : null}
            <textarea
              aria-label="Dictation draft"
              onChange={(event) => { onDictationChange(event.target.value); }}
              readOnly={dictationDraft.status === 'requesting' || dictationDraft.status === 'recording' || dictationDraft.status === 'processing'}
              value={dictationDraft.content}
            />
            {dictationError === null ? null : <p className="inline-error" role="alert">{dictationError}</p>}
            <div className="dictation-draft__actions">
              {dictationDraft.status === 'recording' ? <button aria-label="Pause dictation" onClick={onDictationPause} type="button"><Pause size={14} />Pause</button> : null}
              {dictationDraft.status === 'paused' ? <button aria-label="Resume dictation" onClick={onDictationResume} type="button"><Play size={14} />Resume</button> : null}
              {dictationDraft.status === 'interrupted' && dictationDraft.interruptionReason !== 'storage_failure' ? <button onClick={onDictationResume} type="button"><Mic size={14} />Continue dictating</button> : null}
              {dictationDraft.status === 'recording' || dictationDraft.status === 'paused'
                ? <button aria-label="Finish dictation" onClick={onDictationFinish} type="button"><Square size={13} />Done</button>
                : null}
              {dictationDraft.status === 'review' ? (
                <>
                  {dictationDraft.content === dictationDraft.verbatim ? null : <button onClick={onDictationUseVerbatim} type="button">Use verbatim</button>}
                  <button className="primary-action" onClick={onDictationKeep} type="button"><Check size={14} />Keep dictation</button>
                </>
              ) : null}
              <button onClick={onDictationCancel} type="button">Cancel</button>
            </div>
            <small>This remains a private draft until you choose Keep.</small>
            <details className="dictation-privacy">
              <summary>Voice privacy</summary>
              <p>Audio is sent in short checkpoints for transcription, then discarded rather than saved in your workspace. Faithful cleanup sends the transcript through a separate text request that may be retained for abuse monitoring for up to 30 days under standard API controls. Choose Verbatim in Library to skip cleanup.</p>
            </details>
          </section>
        )}
        {block.references.length === 0 ? null : (
          <div className="reference-fields">
            <button aria-label="Remove source" className="reference-fields__remove" onClick={onRemoveSource} title="Remove source" type="button"><X size={14} /></button>
            <input aria-label="Reference title" onChange={(event) => { onReferenceChange('title', event.target.value); }} placeholder="Source title" value={block.references[0]?.title ?? ''} />
            <input aria-label="Reference author" onChange={(event) => { onReferenceChange('author', event.target.value); }} placeholder="Author (optional)" value={block.references[0]?.author ?? ''} />
            <input aria-label="Reference URL" onChange={(event) => { onReferenceChange('url', event.target.value); }} placeholder="https://…" type="url" value={block.references[0]?.url ?? ''} />
            <input aria-label="Reference note" onChange={(event) => { onReferenceChange('excerpt', event.target.value); }} placeholder="Why this source matters here (optional)" value={block.references[0]?.excerpt ?? ''} />
          </div>
        )}
        {block.versions.length === 0 ? null : (
          <details className="version-history">
            <summary>History · {block.versions.length} version{block.versions.length === 1 ? '' : 's'}</summary>
            <div>{[...block.versions].reverse().map((version, reverseIndex) => {
              const index = block.versions.length - reverseIndex - 1;
              return (
                <button key={`${String(version.createdAt)}:${String(index)}`} onClick={() => { onRestoreVersion(index); }} type="button">
                  <span>{new Date(version.createdAt).toLocaleString()}</span>
                  {version.content.slice(0, 180)}{version.content.length > 180 ? '…' : ''}
                </button>
              );
            })}</div>
          </details>
        )}
      </div>
    </article>
  );
}

function ReflectionMargin({
  annotation,
  busy,
  calibration,
  calibrationDictationError,
  calibrationDictationStatus,
  contextScope,
  error,
  focusBlock,
  onCalibrate,
  onCalibrationChange,
  onCalibrationDictationFinish,
  onCalibrationDictationStart,
  onContextScope,
  onDismiss,
  onFollow,
  onMove,
  onSave,
  selection,
}: {
  annotation: MarginAnnotation | null;
  busy: boolean;
  calibration: string;
  calibrationDictationError: string | null;
  calibrationDictationStatus: 'idle' | 'requesting' | 'recording' | 'processing' | 'interrupted';
  contextScope: ContextScope;
  error: string | null;
  focusBlock: ThoughtBlock | null;
  onCalibrate: (text: string) => void;
  onCalibrationChange: (text: string) => void;
  onCalibrationDictationFinish: () => void;
  onCalibrationDictationStart: (offset: number) => void;
  onContextScope: (scope: ContextScope) => void;
  onDismiss: () => void;
  onFollow: (direction: ReflectionDirection) => void;
  onMove: (move: Exclude<ReflectionMove, 'calibrate'>) => void;
  onSave: () => void;
  selection: string;
}) {
  const calibrationRef = useRef<HTMLTextAreaElement>(null);
  const canReflect = focusBlock !== null && focusBlock.content.trim().length > 0;
  return (
    <aside aria-label="Reflection margin" className="reflection-margin">
      <div className="reflection-margin__heading">
        <select
          aria-label="Context scope"
          onChange={(event) => { onContextScope(event.target.value as ContextScope); }}
          value={contextScope}
        >
          <option value="selection">Selection</option>
          <option value="connections">Connections</option>
          <option value="document">Current document</option>
          <option value="workspace">Entire workspace</option>
        </select>
      </div>
      {annotation === null ? (
        <div className="reflection-empty">
          <p>{selection.trim().length > 0
            ? `“${selection.trim().slice(0, 150)}${selection.trim().length > 150 ? '…' : ''}”`
            : 'Select a passage or focus a block when you reach an edge in your thinking.'}</p>
          <button className="primary-action" disabled={!canReflect || busy} onClick={() => { onMove('reflect'); }} type="button">
            {busy ? 'Reflecting…' : 'Reflect'}
          </button>
          <details className="move-menu">
            <summary>Choose a move <ChevronDown size={14} /></summary>
            <div>
              {Object.entries(MOVE_LABELS).filter(([move]) => move !== 'reflect').map(([move, label]) => (
                <button disabled={!canReflect || busy} key={move} onClick={() => { onMove(move as Exclude<ReflectionMove, 'calibrate'>); }} type="button">
                  {label}
                </button>
              ))}
            </div>
          </details>
          <small>Nothing enters your document unless you write it.</small>
          {error === null ? null : <p className="inline-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div className="reflection-card">
          <div className="reflection-card__topline">
            <span>What I’m hearing</span>
            <button aria-label="Dismiss reflection" onClick={onDismiss} type="button"><X size={15} /></button>
          </div>
          <p className="reflection-card__mirror">{annotation.mirror}</p>
          <div className="direction-list">
            {annotation.directions.map((direction) => (
              <button key={`${direction.label}:${direction.prompt}`} onClick={() => { onFollow(direction); }} type="button">
                {direction.prompt}
              </button>
            ))}
          </div>
          {annotation.sources.length === 0 ? null : (
            <div className="reflection-sources">
              <p className="reflection-card__label">Sources</p>
              {annotation.sources.map((source) => (
                <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                  <span>{source.title}</span><ExternalLink size={12} />
                </a>
              ))}
            </div>
          )}
          <section aria-labelledby="calibration-label" className="calibration">
            <label id="calibration-label" htmlFor="calibration-text">Clarify this reading</label>
            <small>Say what Specular missed, then return to the document to make the thought itself clear.</small>
            {annotation.calibration.map((turn, index) => (
              <p className={`calibration__${turn.role}`} key={`${String(turn.createdAt)}:${String(index)}`}>{turn.content}</p>
            ))}
            <form onSubmit={(event) => {
              event.preventDefault();
              if (calibration.trim().length === 0 || busy) return;
              onCalibrate(calibration.trim());
              onCalibrationChange('');
            }}>
              <div className="calibration-field">
                <textarea
                aria-label="Correct Specular's understanding"
                id="calibration-text"
                onChange={(event) => { onCalibrationChange(event.target.value); }}
                placeholder="Say what it missed. Then return to the document to make it clear."
                readOnly={calibrationDictationStatus === 'requesting' || calibrationDictationStatus === 'recording' || calibrationDictationStatus === 'processing'}
                ref={calibrationRef}
                value={calibration}
                />
                <button
                  aria-label={calibrationDictationStatus === 'recording' ? 'Finish calibration dictation' : 'Start calibration dictation'}
                  className="calibration-mic"
                  disabled={busy || calibrationDictationStatus === 'requesting' || calibrationDictationStatus === 'processing'}
                  onClick={() => {
                    if (calibrationDictationStatus === 'recording') onCalibrationDictationFinish();
                    else onCalibrationDictationStart(calibrationRef.current?.selectionStart ?? calibration.length);
                  }}
                  title={calibrationDictationStatus === 'recording' ? 'Finish dictation' : 'Dictate a correction'}
                  type="button"
                >{calibrationDictationStatus === 'recording' ? <Square size={13} /> : <Mic size={14} />}</button>
              </div>
              {calibrationDictationStatus === 'requesting' ? <p className="calibration-status" role="status">Waiting for microphone permission…</p> : null}
              {calibrationDictationStatus === 'recording' ? <p className="calibration-status" role="status">Recording · keep Specular open</p> : null}
              {calibrationDictationStatus === 'processing' ? <p className="calibration-status" role="status">Preparing transcript…</p> : null}
              {calibrationDictationError === null ? null : <p className="inline-error" role="alert">{calibrationDictationError}</p>}
              <button disabled={busy || calibration.trim().length === 0 || calibrationDictationStatus === 'requesting' || calibrationDictationStatus === 'recording' || calibrationDictationStatus === 'processing'} type="submit">Respond</button>
            </form>
          </section>
          <div className="reflection-card__actions">
            <button onClick={onSave} type="button">Save for later</button>
            <span>{annotation.referencedBlockIds.length} source block{annotation.referencedBlockIds.length === 1 ? '' : 's'}</span>
          </div>
          {error === null ? null : <p className="inline-error" role="alert">{error}</p>}
        </div>
      )}
    </aside>
  );
}

function ConnectionsView({
  blocks,
  documentId,
  dormancyDays,
  onOpenBlock,
  onKindChange,
}: {
  blocks: ThoughtBlock[];
  documentId: string;
  dormancyDays: number;
  onOpenBlock: (block: ThoughtBlock) => void;
  onKindChange: (blockId: string, kind: ThoughtKind) => void;
}) {
  const [kind, setKind] = useState<ThoughtKind | 'all'>('all');
  const [scope, setScope] = useState<'document' | 'workspace'>('document');
  const [status, setStatus] = useState<'all' | 'active' | 'resting' | 'dormant' | 'closed'>('all');
  const visible = blocks.filter((block) => (
    block.content.trim().length > 0
    && (scope === 'workspace' || block.documentId === documentId)
    && (kind === 'all' || block.kind === kind)
    && (status === 'all' || effectiveStatus(block.updatedAt, block.status, dormancyDays) === status)
  ));
  return (
    <section aria-label="Connections" className="connections-view">
      <header>
        <div><p className="eyebrow">Connections</p><h1>The shape of this thinking</h1></div>
        <div className="graph-filters">
          <select aria-label="Connections scope" onChange={(event) => { setScope(event.target.value as typeof scope); }} value={scope}>
            <option value="document">Current document</option>
            <option value="workspace">Entire workspace</option>
          </select>
          <select aria-label="Filter connections by kind" onChange={(event) => { setKind(event.target.value as ThoughtKind | 'all'); }} value={kind}>
            <option value="all">All kinds</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="Filter connections by status" onChange={(event) => { setStatus(event.target.value as typeof status); }} value={status}>
            <option value="all">All states</option>
            <option value="active">Active</option><option value="resting">Resting</option><option value="dormant">Dormant</option><option value="closed">Closed</option>
          </select>
        </div>
      </header>
      {visible.length === 0 ? (
        <div className="graph-empty"><Network size={22} /><p>Connections will become visible as you write and branch.</p></div>
      ) : (
        <div className="thought-graph">
          {visible.map((block, index) => (
            <article
              className={`graph-node graph-node--${block.kind}`}
              key={block.id}
              style={{ '--node-order': index } as React.CSSProperties}
            >
              <button className="graph-node__open" onClick={() => { onOpenBlock(block); }} type="button">
                <span>{effectiveStatus(block.updatedAt, block.status, dormancyDays)}</span>
                <strong>{block.content.slice(0, 180)}{block.content.length > 180 ? '…' : ''}</strong>
                <small>{block.content.trim().split(/\s+/u).length} words</small>
              </button>
              <label className="graph-node__kind">
                <span className="sr-only">Correct kind for this block</span>
                <select aria-label={`Correct kind for ${block.content.slice(0, 40)}`} onChange={(event) => { onKindChange(block.id, event.target.value as ThoughtKind); }} value={block.kind}>
                  {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SnapshotEditor({
  error,
  onClose,
  onPrint,
  onPublish,
  onRevoke,
  onToggleBlock,
  onTitleChange,
  onTitleConfirm,
  publishing,
  snapshot,
  state,
}: {
  error: string | null;
  onClose: () => void;
  onPrint: () => void;
  onPublish: () => void;
  onRevoke: () => void;
  onToggleBlock: (blockId: string) => void;
  onTitleChange: (title: string) => void;
  onTitleConfirm: () => void;
  publishing: boolean;
  snapshot: ThoughtSnapshot;
  state: WorkspaceState;
}) {
  const payload = snapshotPayload(state, snapshot);
  const allBlocks = documentBlocks(state, activeDocument(state)).filter((block) => block.content.trim().length > 0);
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    if (snapshot.publishedUrl === null) return;
    await navigator.clipboard.writeText(snapshot.publishedUrl);
    setCopied(true);
  };
  return (
    <div aria-label="Snapshot editor" aria-modal="true" className="snapshot-overlay" role="dialog">
      <section className="snapshot-panel">
        <header>
          <div><p className="eyebrow">Snapshot</p><h1>{snapshot.title}</h1></div>
          <button aria-label="Close snapshot" onClick={onClose} type="button"><X /></button>
        </header>
        <div className="snapshot-layout">
          <aside>
            <label className="snapshot-title-field">
              <span>Snapshot title</span>
              <input onChange={(event) => { onTitleChange(event.target.value); }} value={snapshot.title} />
            </label>
            {snapshot.titleConfirmed ? null : (
              <div className="snapshot-title-confirmation">
                <p>This title was suggested by Specular. Edit it or confirm it before sharing.</p>
                <button onClick={onTitleConfirm} type="button">Use this title</button>
              </div>
            )}
            <h2>Included writing</h2>
            {allBlocks.map((block) => (
              <label key={block.id}>
                <input checked={snapshot.blockIds.includes(block.id)} onChange={() => { onToggleBlock(block.id); }} type="checkbox" />
                <span>{block.content.slice(0, 90)}{block.content.length > 90 ? '…' : ''}</span>
              </label>
            ))}
            <p>Only your writing, confirmed order, and references appear in the artifact.</p>
          </aside>
          <article className="snapshot-preview">
            <p className="published-kicker">A Specular reflection</p>
            <h1>{payload.title}</h1>
            {payload.blocks.map((block) => block.references.length > 0
              ? <blockquote key={block.id}>{block.content}</blockquote>
              : <p key={block.id}>{block.content}</p>)}
          </article>
        </div>
        <footer>
          <button disabled={!snapshot.titleConfirmed || snapshot.title.trim().length === 0} onClick={() => { downloadMarkdown(payload); }} type="button"><Download size={15} />Markdown</button>
          <button disabled={!snapshot.titleConfirmed || snapshot.title.trim().length === 0} onClick={onPrint} type="button"><Printer size={15} />Print / PDF</button>
          <button className="primary-action" disabled={publishing || payload.blocks.length === 0 || !snapshot.titleConfirmed || snapshot.title.trim().length === 0} onClick={onPublish} type="button">
            {publishing ? <LoaderCircle className="spin" size={15} /> : <Share2 size={15} />}
            Publish page
          </button>
          {snapshot.publishedUrl === null ? null : (
            <>
              <button onClick={() => { void copyLink(); }} type="button">
                {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}
              </button>
              <button onClick={onRevoke} type="button"><Trash2 size={15} />Revoke link</button>
            </>
          )}
          {error === null ? null : <p className="inline-error snapshot-error" role="alert">{error}</p>}
        </footer>
      </section>
    </div>
  );
}

export function App({
  dictationController,
  dictationService,
  initialState,
  organizer = new HttpOrganizer(),
  reflector = new HttpReflector(),
  sharePublisher = new HttpSharePublisher(),
  session,
  storeFactory = createWorkspaceStore,
}: AppProps) {
  const shareMatch = /^\/s\/([a-z0-9-]+)$/u.exec(globalThis.location.pathname);
  if (shareMatch?.[1] !== undefined) {
    return <PublishedPage slug={shareMatch[1]} />;
  }

  const [state, setState] = useState<WorkspaceState>(initialState ?? createInitialWorkspace());
  const [initialized, setInitialized] = useState(initialState !== undefined);
  const [view, setView] = useState<WorkspaceView>('document');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selection, setSelection] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [starterPrompt, setStarterPrompt] = useState<string | null>(null);
  const [reflectionBusy, setReflectionBusy] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [hostedSnapshots, setHostedSnapshots] = useState<HostedSnapshotSummary[]>([]);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [synchronizationStatus, setSynchronizationStatus] = useState<'synchronized' | 'synchronizing' | 'unsynced' | 'locked'>('synchronizing');
  const [pendingDeleteBlockId, setPendingDeleteBlockId] = useState<string | null>(null);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [calibration, setCalibration] = useState('');
  const [calibrationDictationStatus, setCalibrationDictationStatus] = useState<'idle' | 'requesting' | 'recording' | 'processing' | 'interrupted'>('idle');
  const [calibrationDictationError, setCalibrationDictationError] = useState<string | null>(null);
  const storeRef = useRef<WorkspaceStore | null>(null);
  const organizerRef = useRef<Organizer>(organizer);
  const dictationServiceRef = useRef<DictationService>(dictationService ?? new HttpDictationService());
  const dictationControllerRef = useRef<DictationController>(dictationController ?? new BrowserDictationController(dictationServiceRef.current));
  const dictationDraftRef = useRef<DictationDraft | null>(state.dictationDraft);
  const stateRef = useRef(state);
  const calibrationRef = useRef(calibration);
  const calibrationSessionRef = useRef<{ prefix: string; suffix: string; verbatim: string } | null>(null);
  const organizationInFlightRef = useRef(false);
  const lastOrganizationAttemptRef = useRef<string | null>(null);
  dictationDraftRef.current = state.dictationDraft;
  stateRef.current = state;
  calibrationRef.current = calibration;
  organizerRef.current = organizer;

  useEffect(() => {
    if (initialState !== undefined) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void storeFactory().then(async (store) => {
      if (!active) { store.close(); return; }
      storeRef.current = store;
      unsubscribe = store.subscribeStatus?.(setSynchronizationStatus);
      const loaded = await store.load();
      setState(loaded);
      setInitialized(true);
    }).catch(() => {
      if (!active) return;
      if (storeRef.current?.currentStatus?.() !== 'locked') {
        setStorageError('This browser could not open the private workspace. Dictation is unavailable so your speech is never presented as safely checkpointed.');
      }
      setInitialized(true);
    });
    return () => { active = false; unsubscribe?.(); storeRef.current?.close(); storeRef.current = null; };
  }, [initialState, storeFactory]);

  useEffect(() => {
    if (!initialized || initialState !== undefined) return;
    const timeout = window.setTimeout(() => {
      const store = storeRef.current;
      if (store === null) return;
      void store.save(state).then((savedState) => {
        if (savedState === undefined) return;
        setState((current) => {
          if (JSON.stringify(current) !== JSON.stringify(state)) return current;
          return JSON.stringify(current) === JSON.stringify(savedState) ? current : savedState;
        });
      }).catch(() => {
        setStorageError('Local saving failed. Dictation has stopped; copy any provisional text before leaving this page.');
        const draft = dictationDraftRef.current;
        if (draft === null || !['requesting', 'recording', 'processing'].includes(draft.status)) return;
        dictationControllerRef.current.cancel();
        setDictationError('Local saving failed. Copy this draft before closing or reloading.');
        setDictationDraft((current) => current === null ? null : {
          ...current,
          status: 'interrupted',
          interruptionReason: 'storage_failure',
          updatedAt: Date.now(),
        });
      });
    }, 180);
    return () => { window.clearTimeout(timeout); };
  }, [initialState, initialized, state]);

  useEffect(() => {
    if (initialState !== undefined || session === undefined) return;
    const retrySynchronization = () => {
      const store = storeRef.current;
      if (store?.currentStatus?.() !== 'unsynced') return;
      void store.save(stateRef.current).catch(() => {
        setAccountError('Specular could not synchronize this device yet. Your recovery copy remains available.');
      });
    };
    globalThis.addEventListener('online', retrySynchronization);
    return () => { globalThis.removeEventListener('online', retrySynchronization); };
  }, [initialState, session]);

  useEffect(() => {
    if (!libraryOpen || session === undefined) return;
    let active = true;
    void listPublishedSnapshots().then((snapshots) => {
      if (active) setHostedSnapshots(snapshots);
    }).catch((error: unknown) => {
      if (active) setAccountError(error instanceof Error ? error.message : 'Specular could not load your published links.');
    });
    return () => { active = false; };
  }, [libraryOpen, session]);

  const currentDocument = activeDocument(state);
  const blocks = documentBlocks(state, currentDocument);
  const selectedBlock = state.blocks.find((block) => block.id === selectedBlockId) ?? blocks[0] ?? null;
  const currentAnnotation = [...state.annotations].reverse().find((annotation) => (
    annotation.blockId === selectedBlock?.id
    && (annotation.status === 'open' || annotation.status === 'saved')
  )) ?? null;
  const currentSnapshot = state.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
  const isBlank = blocks.every((block) => block.content.trim().length === 0);
  const authoredWordCount = blocks.reduce((total, block) => total + wordCount(block.content), 0);
  const calibrationDictationActive = calibrationDictationStatus !== 'idle' && calibrationDictationStatus !== 'interrupted';

  const signOut = async () => {
    if (session === undefined) return;
    setAccountError(null);
    const store = storeRef.current;
    try {
      if (store !== null) {
        await store.save(state);
        const status = store.currentStatus?.();
        if (status !== undefined && status !== 'synchronized') {
          setAccountError('Sign out is paused because some writing is only on this device. Reconnect until Saved appears, or download this device recovery first.');
          return;
        }
        await store.clear?.();
      }
    } catch {
      setAccountError('Sign out is paused because Specular could not safely save this workspace. Download this device recovery before leaving.');
      return;
    }
    clearCachedSession();
    globalThis.location.assign(session.signOutUrl);
  };

  const downloadHostedArchive = async () => {
    setAccountError(null);
    const store = storeRef.current;
    try {
      if (store !== null) {
        await store.save(state);
        const status = store.currentStatus?.();
        if (status !== undefined && status !== 'synchronized') {
          setAccountError('The hosted archive is paused until this device synchronizes. Download this device recovery for an immediate local copy.');
          return;
        }
      }
      await downloadAccountArchive();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Specular could not prepare your archive.');
    }
  };

  const revokeHostedLink = async (slug: string) => {
    setAccountError(null);
    try {
      await revokeHostedSnapshot(slug);
      setHostedSnapshots((snapshots) => snapshots.map((snapshot) => (
        snapshot.slug === slug ? { ...snapshot, revokedAt: Date.now() } : snapshot
      )));
      setState((current) => ({
        ...current,
        snapshots: current.snapshots.map((snapshot) => snapshot.publishedUrl?.endsWith(`/s/${slug}`) === true
          ? { ...snapshot, publishedUrl: null }
          : snapshot),
      }));
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Specular could not revoke this published link.');
    }
  };

  const deleteAccount = async () => {
    if (session === undefined || !globalThis.confirm('Permanently delete this hosted workspace and revoke every published link? This cannot be undone.')) return;
    setAccountError(null);
    try {
      await deleteHostedAccount();
      await storeRef.current?.clear?.();
      clearCachedSession();
      globalThis.location.assign(session.signOutUrl);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Specular could not delete this account workspace.');
    }
  };

  useEffect(() => {
    if (!initialized || state.settings.automaticOrganization !== 'enabled' || organizationInFlightRef.current) return;
    const eligibleBlocks = blocks.filter((block) => block.kindSource === 'default' && wordCount(block.content) >= 8);
    const titleEligible = currentDocument.titleSource === 'empty' && currentDocument.title.trim().length === 0 && authoredWordCount >= 50;
    if (!titleEligible && eligibleBlocks.length === 0) return;
    const inputBlocks = blocks.filter((block) => block.content.trim().length > 0);
    if (inputBlocks.length === 0) return;
    const fingerprint = `${currentDocument.id}:${String(currentDocument.updatedAt)}:${inputBlocks.map((block) => `${block.id}:${String(block.updatedAt)}:${block.kindSource}`).join('|')}`;
    if (lastOrganizationAttemptRef.current === fingerprint) return;
    const timeout = window.setTimeout(() => {
      lastOrganizationAttemptRef.current = fingerprint;
      organizationInFlightRef.current = true;
      setOrganizationBusy(true);
      const requestedDocumentUpdatedAt = currentDocument.updatedAt;
      const requestedBlockVersions = new Map(inputBlocks.map((block) => [block.id, block.updatedAt]));
      void organizerRef.current.organize({
        documentId: currentDocument.id,
        blocks: inputBlocks.map((block) => ({ id: block.id, content: block.content })),
      }).then((result) => {
        setState((current) => ({
          ...current,
          documents: current.documents.map((document) => {
            if (document.id !== currentDocument.id) return document;
            if (!titleEligible || document.updatedAt !== requestedDocumentUpdatedAt || document.titleSource !== 'empty' || document.title.trim().length > 0) return document;
            return { ...document, title: result.title, titleSource: 'generated' };
          }),
          blocks: current.blocks.map((block) => {
            const generated = result.kinds.find((item) => item.id === block.id);
            if (generated === undefined || block.kindSource !== 'default' || block.updatedAt !== requestedBlockVersions.get(block.id)) return block;
            return { ...block, kind: generated.kind, kindSource: 'generated' };
          }),
        }));
      }).catch(() => undefined).finally(() => {
        organizationInFlightRef.current = false;
        setOrganizationBusy(false);
      });
    }, 2_000);
    return () => { window.clearTimeout(timeout); };
  }, [authoredWordCount, blocks, currentDocument, initialized, state.settings.automaticOrganization]);

  useEffect(() => {
    setCalibration('');
    calibrationSessionRef.current = null;
    setCalibrationDictationStatus('idle');
    setCalibrationDictationError(null);
  }, [currentAnnotation?.id]);

  const setDictationDraft = (update: DictationDraft | null | ((draft: DictationDraft | null) => DictationDraft | null)) => {
    const next = typeof update === 'function' ? update(dictationDraftRef.current) : update;
    dictationDraftRef.current = next;
    setState((current) => ({ ...current, dictationDraft: next }));
  };

  const captureHandlers = (): DictationCaptureHandlers => ({
    onStarted: () => {
      setDictationDraft((draft) => draft === null ? null : {
        ...draft,
        status: 'recording',
        interruptionReason: null,
        updatedAt: Date.now(),
      });
    },
    onTranscript: (transcript) => {
      const addition = transcript.trim();
      if (addition.length === 0) return;
      setDictationDraft((draft) => {
        if (draft === null) return null;
        const join = draft.verbatim.trim().length === 0 ? '' : ' ';
        const verbatim = `${draft.verbatim}${join}${addition}`.slice(0, 40_000);
        return { ...draft, content: verbatim, verbatim, updatedAt: Date.now() };
      });
    },
    onInterrupted: (reason) => {
      setDictationError(null);
      setDictationDraft((draft) => draft === null ? null : {
        ...draft,
        status: 'interrupted',
        interruptionReason: reason,
        updatedAt: Date.now(),
      });
    },
    onError: (message) => {
      setDictationError(message);
      setDictationDraft((draft) => draft === null ? null : {
        ...draft,
        status: 'interrupted',
        interruptionReason: 'transcription_failure',
        updatedAt: Date.now(),
      });
    },
  });

  const calibrationCaptureHandlers = (): DictationCaptureHandlers => ({
    onStarted: () => {
      setCalibrationDictationStatus('recording');
      setCalibrationDictationError(null);
    },
    onTranscript: (transcript) => {
      const addition = transcript.trim();
      const session = calibrationSessionRef.current;
      if (addition.length === 0 || session === null) return;
      const join = session.verbatim.trim().length === 0 ? '' : ' ';
      session.verbatim = `${session.verbatim}${join}${addition}`.slice(0, 2_000);
      const value = `${session.prefix}${session.verbatim}${session.suffix}`.slice(0, 2_000);
      calibrationRef.current = value;
      setCalibration(value);
    },
    onInterrupted: () => {
      setCalibrationDictationStatus('interrupted');
      setCalibrationDictationError('Dictation was interrupted. The transcribed correction remains in the field.');
    },
    onError: (message) => {
      setCalibrationDictationStatus('interrupted');
      setCalibrationDictationError(message);
    },
  });

  const startCalibrationDictation = async (insertionOffset: number) => {
    if (dictationDraftRef.current !== null || calibrationDictationActive) return;
    const current = calibrationRef.current;
    const offset = Math.min(insertionOffset, current.length);
    calibrationSessionRef.current = { prefix: current.slice(0, offset), suffix: current.slice(offset), verbatim: '' };
    setCalibrationDictationStatus('requesting');
    setCalibrationDictationError(null);
    try {
      await dictationControllerRef.current.start(calibrationCaptureHandlers());
    } catch (error) {
      calibrationCaptureHandlers().onError(error instanceof Error ? error.message : 'Microphone access failed.');
    }
  };

  const finishCalibrationDictation = async () => {
    setCalibrationDictationStatus('processing');
    setCalibrationDictationError(null);
    try {
      await dictationControllerRef.current.finish();
      const session = calibrationSessionRef.current;
      if (session === null || session.verbatim.trim().length === 0) {
        setCalibrationDictationStatus('interrupted');
        setCalibrationDictationError('No speech was transcribed. Try dictating again.');
        return;
      }
      let dictated = session.verbatim;
      if (state.settings.dictationCleanup === 'faithful') {
        try { dictated = await dictationServiceRef.current.clean(session.verbatim); }
        catch { /* Keep the safe verbatim text in the field. */ }
      }
      const value = `${session.prefix}${dictated}${session.suffix}`.slice(0, 2_000);
      calibrationRef.current = value;
      setCalibration(value);
      calibrationSessionRef.current = null;
      setCalibrationDictationStatus('idle');
    } catch (error) {
      setCalibrationDictationStatus('interrupted');
      setCalibrationDictationError(error instanceof Error ? error.message : 'Calibration dictation was interrupted.');
    }
  };

  const cancelCalibrationDictation = () => {
    if (calibrationDictationActive) dictationControllerRef.current.cancel();
    calibrationSessionRef.current = null;
    setCalibrationDictationStatus('idle');
    setCalibrationDictationError(null);
  };

  const startDictation = async (blockId: string, insertionOffset: number) => {
    if (dictationDraftRef.current !== null) {
      setSelectedBlockId(dictationDraftRef.current.blockId);
      return;
    }
    const now = Date.now();
    setDictationError(null);
    setDictationDraft({
      id: newId('dictation'),
      blockId,
      content: '',
      verbatim: '',
      insertionOffset,
      cleanupMode: state.settings.dictationCleanup,
      status: 'requesting',
      interruptionReason: null,
      startedAt: now,
      updatedAt: now,
    });
    try {
      await dictationControllerRef.current.start(captureHandlers());
    } catch (error) {
      captureHandlers().onError(error instanceof Error ? error.message : 'Microphone access failed.');
    }
  };

  const pauseDictation = async () => {
    await dictationControllerRef.current.pause();
    setDictationDraft((draft) => draft === null || draft.status === 'interrupted'
      ? draft
      : { ...draft, status: 'paused', updatedAt: Date.now() });
  };

  const resumeDictation = async () => {
    const draft = dictationDraftRef.current;
    if (draft === null) return;
    setDictationError(null);
    try {
      if (draft.status === 'interrupted') await dictationControllerRef.current.start(captureHandlers());
      else await dictationControllerRef.current.resume();
    } catch (error) {
      captureHandlers().onError(error instanceof Error ? error.message : 'Microphone access failed.');
    }
  };

  const finishDictation = async () => {
    let partialTranscriptWarning: string | null = null;
    setDictationError(null);
    setDictationDraft((draft) => draft === null ? null : { ...draft, status: 'processing', updatedAt: Date.now() });
    try {
      await dictationControllerRef.current.finish();
      const draft = dictationDraftRef.current;
      if (draft === null) return;
      if (draft.status === 'interrupted') {
        const hasCompletedCheckpoint = draft.verbatim.trim().length > 0;
        if (draft.interruptionReason !== 'transcription_failure' || !hasCompletedCheckpoint) return;
        partialTranscriptWarning = 'The last checkpoint could not be transcribed. Review the saved text before keeping it.';
        setDictationError(partialTranscriptWarning);
      }
      if (draft.verbatim.trim().length === 0) {
        setDictationError('No speech was transcribed. Continue dictating and try again.');
        setDictationDraft({
          ...draft,
          status: 'interrupted',
          interruptionReason: 'transcription_failure',
          updatedAt: Date.now(),
        });
        return;
      }
      const cleaned = draft.cleanupMode === 'faithful' && draft.verbatim.trim().length > 0
        ? await dictationServiceRef.current.clean(draft.verbatim)
        : draft.verbatim;
      setDictationDraft((current) => current === null ? null : {
        ...current,
        content: cleaned,
        status: 'review',
        interruptionReason: null,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const draft = dictationDraftRef.current;
      const cleanupError = error instanceof Error ? error.message : 'Cleanup unavailable. The verbatim transcript is safe.';
      setDictationError(partialTranscriptWarning === null ? cleanupError : `${partialTranscriptWarning} ${cleanupError}`);
      setDictationDraft(draft === null ? null : {
        ...draft,
        content: draft.verbatim,
        cleanupMode: 'verbatim',
        status: 'review',
        interruptionReason: null,
        updatedAt: Date.now(),
      });
    }
  };

  const cancelDictation = () => {
    const draft = dictationDraftRef.current;
    if (draft !== null && draft.content.trim().length > 0 && !globalThis.confirm('Discard this dictation draft? Its provisional text will be removed.')) return;
    dictationControllerRef.current.cancel();
    setDictationError(null);
    setDictationDraft(null);
  };

  const keepDictation = () => {
    const draft = dictationDraftRef.current;
    if (draft?.status !== 'review') return;
    const now = Date.now();
    setState((current) => ({
      ...current,
      dictationDraft: null,
      blocks: current.blocks.map((block) => {
        if (block.id !== draft.blockId) return block;
        const offset = Math.min(draft.insertionOffset, block.content.length);
        const content = `${block.content.slice(0, offset)}${draft.content}${block.content.slice(offset)}`;
        return {
          ...block,
          content,
          status: 'active',
          updatedAt: now,
          versions: [...block.versions, { content, createdAt: now }].slice(-500),
        };
      }),
      documents: current.documents.map((document) => document.id === current.activeDocumentId
        ? { ...document, status: 'active', updatedAt: now }
        : document),
    }));
    dictationDraftRef.current = null;
    setDictationError(null);
  };

  const updateDocument = (patch: Partial<ThoughtDocument>) => {
    const now = Date.now();
    setState((current) => ({
      ...current,
      documents: current.documents.map((item) => item.id === current.activeDocumentId
        ? { ...item, ...patch, updatedAt: now }
        : item),
    }));
  };

  const updateBlock = (blockId: string, update: (block: ThoughtBlock) => ThoughtBlock) => {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) => block.id === blockId ? update(block) : block),
      documents: current.documents.map((item) => item.id === current.activeDocumentId
        ? { ...item, status: 'active', updatedAt: Date.now() }
        : item),
    }));
  };

  const commitVersion = (blockId: string) => {
    updateBlock(blockId, (block) => {
      const latest = block.versions[block.versions.length - 1];
      if (block.content.trim().length === 0 || latest?.content === block.content) return block;
      return {
        ...block,
        versions: [...block.versions, { content: block.content, createdAt: Date.now() }].slice(-500),
      };
    });
  };

  const addBlock = (
    parentId: string | null = null,
    relationship: 'branches_from' | 'develops' = 'develops',
    originPrompt: string | null = null,
  ) => {
    const now = Date.now();
    const id = newId('block');
    setState((current) => ({
      ...current,
      blocks: [...current.blocks, {
        id,
        documentId: current.activeDocumentId,
        parentId,
        originPrompt,
        content: '',
        kind: 'thought',
        kindSource: 'default',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        versions: [],
        references: [],
      }],
      connections: parentId === null ? current.connections : [...current.connections, {
        id: newId('connection'),
        fromBlockId: parentId,
        toBlockId: id,
        relationship,
        createdAt: now,
      }],
      documents: current.documents.map((item) => item.id === current.activeDocumentId
        ? { ...item, blockIds: [...item.blockIds, id], status: 'active', updatedAt: now }
        : item),
    }));
    setSelectedBlockId(id);
    setSelection('');
    window.setTimeout(() => {
      globalThis.document.querySelector<HTMLTextAreaElement>(`[data-block-id="${id}"] textarea`)?.focus();
    }, 0);
  };

  const deleteBlock = (blockId: string) => {
    if (state.dictationDraft?.blockId === blockId) {
      globalThis.alert('Keep or cancel the dictation draft before deleting this block.');
      return;
    }
    const block = state.blocks.find((item) => item.id === blockId);
    if (block === undefined) return;

    const remainingBlocks = blocks.filter((item) => item.id !== blockId);
    const deletedIndex = blocks.findIndex((item) => item.id === blockId);
    const now = Date.now();
    const replacement = remainingBlocks.length === 0
      ? {
          id: newId('block'),
          documentId: currentDocument.id,
          parentId: null,
          originPrompt: null,
          content: '',
          kind: 'thought' as const,
          kindSource: 'default' as const,
          status: 'active' as const,
          createdAt: now,
          updatedAt: now,
          versions: [],
          references: [],
        }
      : null;
    const nextBlockId = remainingBlocks[deletedIndex]?.id
      ?? remainingBlocks[deletedIndex - 1]?.id
      ?? replacement?.id
      ?? null;

    setState((current) => ({
      ...current,
      blocks: [
        ...current.blocks
          .filter((item) => item.id !== blockId)
          .map((item) => item.parentId === blockId ? { ...item, parentId: null } : item),
        ...(replacement === null ? [] : [replacement]),
      ],
      connections: current.connections.filter((connection) => (
        connection.fromBlockId !== blockId && connection.toBlockId !== blockId
      )),
      annotations: current.annotations.filter((annotation) => annotation.blockId !== blockId),
      documents: current.documents.map((document) => document.id === currentDocument.id
        ? {
            ...document,
            blockIds: replacement === null
              ? document.blockIds.filter((id) => id !== blockId)
              : [replacement.id],
            status: 'active',
            updatedAt: now,
          }
        : document),
      snapshots: current.snapshots.map((snapshot) => ({
        ...snapshot,
        blockIds: snapshot.blockIds.filter((id) => id !== blockId),
      })),
    }));
    setPendingDeleteBlockId(null);
    setSelectedBlockId(nextBlockId);
    setSelection('');
  };

  const requestDeleteBlock = (blockId: string) => {
    if (state.dictationDraft?.blockId === blockId) {
      globalThis.alert('Keep or cancel the dictation draft before deleting this block.');
      return;
    }
    const block = state.blocks.find((item) => item.id === blockId);
    if (block === undefined) return;
    const hasAuthoredMaterial = block.content.trim().length > 0
      || block.versions.length > 0
      || block.references.some((reference) => (
        reference.title.trim().length > 0
        || reference.author.trim().length > 0
        || reference.url.trim().length > 0
        || reference.excerpt.trim().length > 0
      ));
    if (hasAuthoredMaterial) {
      setPendingDeleteBlockId(blockId);
      return;
    }
    deleteBlock(blockId);
  };

  const createDocument = () => {
    const now = Date.now();
    const documentId = newId('document');
    const blockId = newId('block');
    setState((current) => ({
      ...current,
      activeDocumentId: documentId,
      documents: [...current.documents, { id: documentId, title: '', titleSource: 'empty', conflictOfDocumentId: null, conflictStatus: null, status: 'active', blockIds: [blockId], createdAt: now, updatedAt: now }],
      blocks: [...current.blocks, { id: blockId, documentId, parentId: null, originPrompt: null, content: '', kind: 'thought', kindSource: 'default', status: 'active', createdAt: now, updatedAt: now, versions: [], references: [] }],
    }));
    setSelectedBlockId(blockId);
    setLibraryOpen(false);
    setStarterOpen(false);
    setStarterPrompt(null);
    setView('document');
  };

  const runReflection = async (
    move: Exclude<ReflectionMove, 'calibrate'>,
    calibration?: { annotation: MarginAnnotation; text: string },
  ) => {
    if (selectedBlock === null || selectedBlock.content.trim().length === 0) return;
    setReflectionBusy(true);
    setReflectionError(null);
    try {
      const response = await reflector.reflect({
        focus: selection.trim().length > 0 ? selection.trim() : selectedBlock.content,
        focusBlockId: selectedBlock.id,
        move: calibration === undefined ? move : 'calibrate',
        scope: state.settings.contextScope,
        blocks: contextBlocksFor(state, currentDocument, selectedBlock, state.settings.contextScope),
        ...(calibration === undefined ? {} : {
          calibration: calibration.text,
          priorMirror: calibration.annotation.mirror,
        }),
      });
      const now = Date.now();
      if (calibration === undefined) {
        const annotation: MarginAnnotation = {
          id: newId('annotation'),
          documentId: currentDocument.id,
          blockId: selectedBlock.id,
          focus: selection.trim().length > 0 ? selection.trim() : selectedBlock.content,
          move,
          mirror: response.mirror,
          directions: response.directions,
          referencedBlockIds: response.referencedBlockIds,
          sources: response.sources,
          calibration: [],
          status: 'open',
          createdAt: now,
          updatedAt: now,
        };
        setState((current) => ({ ...current, annotations: [...current.annotations, annotation] }));
      } else {
        setState((current) => ({
          ...current,
          annotations: current.annotations.map((annotation) => annotation.id === calibration.annotation.id
            ? {
                ...annotation,
                mirror: response.mirror,
                directions: response.directions,
                referencedBlockIds: response.referencedBlockIds,
                sources: response.sources,
                calibration: [...annotation.calibration,
                  { role: 'user', content: calibration.text, createdAt: now },
                  { role: 'specular', content: response.mirror, createdAt: now + 1 }],
                updatedAt: now,
              }
            : annotation),
        }));
      }
    } catch (error) {
      setReflectionError(error instanceof Error ? error.message : 'Specular could not reflect right now.');
    } finally {
      setReflectionBusy(false);
    }
  };

  const createSnapshot = () => {
    const blockIds = blocks.filter((block) => block.content.trim().length > 0).map((block) => block.id);
    if (blockIds.length === 0) return;
    const now = Date.now();
    const snapshot: ThoughtSnapshot = {
      id: newId('snapshot'),
      documentId: currentDocument.id,
      title: currentDocument.title.trim().length > 0 ? currentDocument.title : 'Untitled reflection',
      titleConfirmed: currentDocument.titleSource !== 'generated',
      blockIds,
      createdAt: now,
      publishedUrl: null,
    };
    setState((current) => ({ ...current, snapshots: [...current.snapshots, snapshot] }));
    setSnapshotId(snapshot.id);
  };

  const publishSnapshot = async () => {
    if (currentSnapshot === null) return;
    setPublishing(true);
    setShareError(null);
    try {
      const result = await sharePublisher.publish(snapshotPayload(state, currentSnapshot));
      setState((current) => ({
        ...current,
        snapshots: current.snapshots.map((snapshot) => snapshot.id === currentSnapshot.id
          ? { ...snapshot, publishedUrl: result.url }
          : snapshot),
      }));
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Specular could not publish this snapshot.');
    } finally {
      setPublishing(false);
    }
  };

  const revokeSnapshot = async () => {
    if (currentSnapshot?.publishedUrl === null || currentSnapshot === null) return;
    setPublishing(true);
    setShareError(null);
    try {
      await revokePublishedSnapshot(currentSnapshot.publishedUrl);
      setState((current) => ({
        ...current,
        snapshots: current.snapshots.map((snapshot) => snapshot.id === currentSnapshot.id
          ? { ...snapshot, publishedUrl: null }
          : snapshot),
      }));
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Specular could not revoke this published link.');
    } finally {
      setPublishing(false);
    }
  };

  if (!initialized) {
    return <main className="workspace-loading"><span>Specular</span><LoaderCircle aria-label="Opening private workspace" className="spin" /></main>;
  }

  if (synchronizationStatus === 'locked' && session !== undefined) {
    return (
      <main className="session-gate">
        <span className="session-gate__brand">Specular</span>
        <div>
          <h1>Workspace locked</h1>
          <p>Your ChatGPT session changed or expired. Cached writing remains hidden for this account until you sign in again.</p>
          <a className="primary-action" href="/signin-with-chatgpt?return_to=%2F">Sign in again</a>
        </div>
      </main>
    );
  }

  return (
    <main className="specular-shell">
      <header className="workspace-header">
        <button className="brand" onClick={() => { setView('document'); }} type="button">Specular</button>
        <div className="header-actions">
          <button disabled={blocks.every((block) => block.content.trim().length === 0) || calibrationDictationActive} onClick={createSnapshot} type="button"><FileText size={15} />Create snapshot</button>
          <button aria-expanded={libraryOpen} disabled={state.dictationDraft !== null || calibrationDictationActive} onClick={() => { setLibraryOpen((open) => !open); }} type="button"><Library size={15} />Library</button>
          {session === undefined ? null : (
            <div className="account-boundary">
              <span className={`sync-status sync-status--${synchronizationStatus}`}>{synchronizationStatus === 'synchronized' ? 'Saved' : synchronizationStatus === 'synchronizing' ? 'Saving' : synchronizationStatus === 'unsynced' ? 'Saved on this device' : 'Locked'}</span>
              <span title={session.email}>{session.email}</span>
              <button onClick={() => { void signOut(); }} type="button">Sign out</button>
            </div>
          )}
        </div>
      </header>
      {accountError === null ? null : <p className="account-error" role="alert">{accountError}</p>}
      <nav aria-label="Workspace views" className="workspace-nav">
        <button aria-current={view === 'document' ? 'page' : undefined} onClick={() => { setView('document'); }} type="button"><BookOpen size={15} />Document</button>
        <button aria-current={view === 'connections' ? 'page' : undefined} disabled={state.dictationDraft !== null || calibrationDictationActive} onClick={() => { setView('connections'); }} type="button"><Network size={15} />Connections</button>
      </nav>

      {libraryOpen ? (
        <aside aria-label="Document library" className="library-drawer">
          <header><div><p className="eyebrow">Private workspace</p><h2>Library</h2></div><button aria-label="Close library" onClick={() => { setLibraryOpen(false); }} type="button"><X size={18} /></button></header>
          <button className="new-document" onClick={createDocument} type="button"><Plus size={16} />New document</button>
          <div className="document-list">
            {[...state.documents].sort((left, right) => right.updatedAt - left.updatedAt).map((item) => (
              <button className={item.id === currentDocument.id ? 'document-row document-row--active' : 'document-row'} key={item.id} onClick={() => {
                setState((current) => ({ ...current, activeDocumentId: item.id }));
                setSelectedBlockId(item.blockIds[0] ?? null);
                setLibraryOpen(false);
                setStarterOpen(false);
                setStarterPrompt(null);
                setView('document');
              }} type="button">
                <span>{item.title.trim().length > 0 ? item.title : 'Untitled thought'}</span>
                <small>{effectiveStatus(item.updatedAt, item.status, state.settings.dormancyDays)} · {item.blockIds.length} block{item.blockIds.length === 1 ? '' : 's'}</small>
              </button>
            ))}
          </div>
          <footer>
            <label><span>Becomes dormant after</span><select aria-label="Dormancy period" onChange={(event) => { setState((current) => ({ ...current, settings: { ...current.settings, dormancyDays: Number(event.target.value) } })); }} value={state.settings.dormancyDays}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
            <label><span>Dictation transcript</span><select aria-label="Dictation cleanup" onChange={(event) => { setState((current) => ({ ...current, settings: { ...current.settings, dictationCleanup: event.target.value as 'faithful' | 'verbatim' } })); }} value={state.settings.dictationCleanup}><option value="faithful">Faithful cleanup</option><option value="verbatim">Verbatim</option></select></label>
            <label><span>Automatic organization</span><select aria-label="Automatic organization" onChange={(event) => { setState((current) => ({ ...current, settings: { ...current.settings, automaticOrganization: event.target.value as 'enabled' | 'disabled' } })); }} value={state.settings.automaticOrganization === 'undecided' ? 'disabled' : state.settings.automaticOrganization}><option value="enabled">On</option><option value="disabled">Off</option></select></label>
            {session === undefined ? null : (
              <section className="account-settings">
                <strong>Hosted workspace</strong>
                <p>Your writing is stored in your private hosted workspace, with an account-scoped cache on this device. Reflection and dictation use hosted inference only when you invoke them.</p>
                <p>Operational limits use content-free counters. Archives exclude margin responses, calibration, audio, and ChatGPT identity; device recovery also excludes interlocutor annotations.</p>
                <div className="hosted-snapshot-list">
                  <strong>Published links</strong>
                  {hostedSnapshots.length === 0 ? <span>No published links yet.</span> : hostedSnapshots.map((snapshot) => (
                    <div key={snapshot.slug}>
                      <span><b>{snapshot.title}</b><small>{snapshot.revokedAt === null ? new Date(snapshot.createdAt).toLocaleDateString() : 'Revoked'}</small></span>
                      {snapshot.revokedAt === null ? <button onClick={() => { void revokeHostedLink(snapshot.slug); }} type="button">Revoke</button> : null}
                    </div>
                  ))}
                </div>
                <button onClick={() => { void downloadHostedArchive(); }} type="button">Download archive</button>
                <button onClick={() => { downloadDeviceRecovery(state); }} type="button">Download this device recovery</button>
                <button className="danger-action" onClick={() => { void deleteAccount(); }} type="button">Delete account data</button>
              </section>
            )}
          </footer>
        </aside>
      ) : null}

      {view === 'connections' ? (
        <ConnectionsView
          blocks={state.blocks}
          documentId={currentDocument.id}
          dormancyDays={state.settings.dormancyDays}
          onOpenBlock={(block) => { setSelectedBlockId(block.id); setView('document'); window.setTimeout(() => { globalThis.document.querySelector<HTMLTextAreaElement>(`[data-block-id="${block.id}"] textarea`)?.focus(); }, 0); }}
          onKindChange={(blockId, kind) => { updateBlock(blockId, (block) => ({ ...block, kind, kindSource: 'author', updatedAt: Date.now() })); }}
        />
      ) : (
        <section className="workspace-grid">
          <article aria-label="Thinking document" className="thinking-document">
            {storageError === null ? null : <p className="workspace-storage-error" role="alert">{storageError}</p>}
            {currentDocument.conflictStatus === 'open' ? (
              <section className="conflict-notice" role="status">
                <p>This is a preserved conflict copy. Compare it with the linked hosted version; Specular has not merged or rewritten either.</p>
                <button onClick={() => { updateDocument({ conflictStatus: 'resolved' }); }} type="button">Mark resolved</button>
              </section>
            ) : null}
            <div className="document-tools">
              {isBlank ? (
                <div className="starter-help">
                  <button
                    aria-controls="writing-starters"
                    aria-expanded={starterOpen}
                    aria-label="Writing starters"
                    className="starter-help__trigger"
                    onClick={() => { setStarterOpen((open) => !open); }}
                    title="Writing starters"
                    type="button"
                  >?</button>
                  {starterOpen ? (
                    <div className="starter-intentions" id="writing-starters">
                      <p>{starterPrompt ?? 'Start anywhere, or choose a quiet way in.'}</p>
                      <div>{STARTERS.map(([label, prompt]) => (
                        <button key={label} onClick={() => {
                          const firstBlock = blocks[0];
                          setStarterPrompt(prompt);
                          setStarterOpen(false);
                          if (firstBlock !== undefined) {
                            setSelectedBlockId(firstBlock.id);
                            window.setTimeout(() => {
                              globalThis.document.querySelector<HTMLTextAreaElement>(`[data-block-id="${firstBlock.id}"] textarea`)?.focus();
                            }, 0);
                          }
                        }} type="button">{label}</button>
                      ))}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {state.settings.automaticOrganization === 'undecided' && authoredWordCount >= 50 ? (
              <section aria-label="Automatic organization consent" className="organization-consent">
                <p><strong>Let Specular quietly name and tag this writing?</strong> This sends the current document to hosted inference after you pause. It never adds prose to your document.</p>
                <div>
                  <button onClick={() => { setState((current) => ({ ...current, settings: { ...current.settings, automaticOrganization: 'enabled' } })); }} type="button">Enable</button>
                  <button onClick={() => { setState((current) => ({ ...current, settings: { ...current.settings, automaticOrganization: 'disabled' } })); }} type="button">Not now</button>
                </div>
              </section>
            ) : null}
            <DocumentTitleEditor onChange={(title) => { updateDocument({ title, titleSource: 'author' }); }} value={currentDocument.title} />
            {currentDocument.titleSource === 'generated' ? <p className="generated-title-note" role="status">Suggested title · edit to make it yours{organizationBusy ? ' · organizing' : ''}</p> : null}
            <div className="block-stack">
              {blocks.map((block) => (
                <BlockEditor
                  block={block}
                  canDictate={storageError === null && !calibrationDictationActive}
                  deletePending={pendingDeleteBlockId === block.id}
                  dictationActive={state.dictationDraft !== null}
                  dictationDraft={state.dictationDraft?.blockId === block.id ? state.dictationDraft : null}
                  dictationError={state.dictationDraft?.blockId === block.id ? dictationError : null}
                  focused={selectedBlock?.id === block.id}
                  key={block.id}
                  onBlur={() => { window.setTimeout(() => { commitVersion(block.id); }, 0); }}
                  onChange={(content) => { updateBlock(block.id, (current) => ({ ...current, content, status: 'active', updatedAt: Date.now() })); }}
                  onAttachSource={() => { updateBlock(block.id, (current) => ({ ...current, references: [{ id: newId('reference'), title: '', author: '', url: '', excerpt: '', accessedAt: Date.now() }], updatedAt: Date.now() })); }}
                  onDelete={() => { requestDeleteBlock(block.id); }}
                  onDeleteCancel={() => { setPendingDeleteBlockId(null); }}
                  onDeleteConfirm={() => { deleteBlock(block.id); }}
                  onDictationCancel={cancelDictation}
                  onDictationChange={(content) => { setDictationDraft((draft) => draft === null ? null : {
                    ...draft,
                    content,
                    ...(draft.status === 'review' ? {} : { verbatim: content }),
                    updatedAt: Date.now(),
                  }); }}
                  onDictationFinish={() => { void finishDictation(); }}
                  onDictationKeep={keepDictation}
                  onDictationPause={() => { void pauseDictation(); }}
                  onDictationResume={() => { void resumeDictation(); }}
                  onDictationStart={(offset) => { void startDictation(block.id, offset); }}
                  onDictationUseVerbatim={() => { setDictationDraft((draft) => draft === null ? null : { ...draft, content: draft.verbatim, cleanupMode: 'verbatim', updatedAt: Date.now() }); }}
                  onFocus={() => { setSelectedBlockId(block.id); setSelection(''); }}
                  onRemoveSource={() => { updateBlock(block.id, (current) => ({ ...current, references: [], updatedAt: Date.now() })); }}
                  onReferenceChange={(field, value) => { updateBlock(block.id, (current) => {
                    const existing = current.references[0] ?? {
                      id: newId('reference'),
                      title: '',
                      author: '',
                      url: '',
                      excerpt: '',
                      accessedAt: Date.now(),
                    };
                    return { ...current, references: [{ ...existing, [field]: value }], updatedAt: Date.now() };
                  }); }}
                  onRestoreVersion={(index) => { updateBlock(block.id, (current) => {
                    const version = current.versions[index];
                    if (version === undefined) return current;
                    const versions = current.content === version.content
                      ? current.versions
                      : [...current.versions, { content: current.content, createdAt: Date.now() }].slice(-500);
                    return { ...current, content: version.content, versions, updatedAt: Date.now() };
                  }); }}
                  onSelection={setSelection}
                  placeholder={block.id === blocks[0]?.id && block.content.trim().length === 0 ? starterPrompt : null}
                />
              ))}
            </div>
            <button aria-label="New block" className="add-block" onClick={() => { addBlock(); }} title="New block" type="button"><Plus size={17} /></button>
          </article>

          <ReflectionMargin
            annotation={currentAnnotation}
            busy={reflectionBusy}
            calibration={calibration}
            calibrationDictationError={calibrationDictationError}
            calibrationDictationStatus={calibrationDictationStatus}
            contextScope={state.settings.contextScope}
            error={reflectionError}
            focusBlock={selectedBlock}
            onCalibrate={(text) => { if (currentAnnotation !== null) void runReflection(currentAnnotation.move, { annotation: currentAnnotation, text }); }}
            onCalibrationChange={(text) => { calibrationRef.current = text; setCalibration(text); }}
            onCalibrationDictationFinish={() => { void finishCalibrationDictation(); }}
            onCalibrationDictationStart={(offset) => { void startCalibrationDictation(offset); }}
            onContextScope={(contextScope) => { setState((current) => ({ ...current, settings: { ...current.settings, contextScope } })); }}
            onDismiss={() => { cancelCalibrationDictation(); if (currentAnnotation !== null) setState((current) => ({ ...current, annotations: current.annotations.map((annotation) => annotation.id === currentAnnotation.id ? { ...annotation, status: 'dismissed' } : annotation) })); }}
            onFollow={(direction) => {
              if (currentAnnotation !== null) {
                setState((current) => ({ ...current, annotations: current.annotations.map((annotation) => annotation.id === currentAnnotation.id ? { ...annotation, status: 'followed', updatedAt: Date.now() } : annotation) }));
                addBlock(currentAnnotation.blockId, 'branches_from', direction.prompt);
              }
            }}
            onMove={(move) => { void runReflection(move); }}
            onSave={() => { if (currentAnnotation !== null) setState((current) => ({ ...current, annotations: current.annotations.map((annotation) => annotation.id === currentAnnotation.id ? { ...annotation, status: 'saved' } : annotation) })); }}
            selection={selection}
          />
        </section>
      )}

      {currentSnapshot === null ? null : (
        <SnapshotEditor
          error={shareError}
          onClose={() => { setSnapshotId(null); }}
          onPrint={() => { window.print(); }}
          onPublish={() => { void publishSnapshot(); }}
          onRevoke={() => { void revokeSnapshot(); }}
          onToggleBlock={(blockId) => { setState((current) => ({ ...current, snapshots: current.snapshots.map((snapshot) => snapshot.id === currentSnapshot.id ? { ...snapshot, blockIds: snapshot.blockIds.includes(blockId) ? snapshot.blockIds.filter((id) => id !== blockId) : [...snapshot.blockIds, blockId] } : snapshot) })); }}
          onTitleChange={(title) => { setState((current) => ({ ...current, snapshots: current.snapshots.map((snapshot) => snapshot.id === currentSnapshot.id ? { ...snapshot, title, titleConfirmed: title.trim().length > 0 } : snapshot) })); }}
          onTitleConfirm={() => { setState((current) => ({ ...current, snapshots: current.snapshots.map((snapshot) => snapshot.id === currentSnapshot.id && snapshot.title.trim().length > 0 ? { ...snapshot, titleConfirmed: true } : snapshot) })); }}
          publishing={publishing}
          snapshot={currentSnapshot}
          state={state}
        />
      )}
    </main>
  );
}
