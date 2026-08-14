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
  Network,
  Plus,
  Printer,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { downloadMarkdown } from '../thinking/export';
import {
  createInitialWorkspace,
  effectiveStatus,
  newId,
  type ContextScope,
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
import { createWorkspaceStore, type WorkspaceStore } from '../thinking/persistence';
import {
  HttpReflector,
  type ReflectionContextBlock,
  type Reflector,
} from '../thinking/reflect-client';
import {
  HttpSharePublisher,
  loadPublishedSnapshot,
  type PublishedSnapshot,
  type SharePublisher,
} from '../thinking/share-client';

export interface AppProps {
  initialState?: WorkspaceState;
  reflector?: Reflector;
  sharePublisher?: SharePublisher;
  storeFactory?: () => Promise<WorkspaceStore>;
  dependencies?: unknown;
  downloadFile?: unknown;
  runtime?: unknown;
  voiceControllerFactory?: unknown;
  voiceEnabled?: boolean;
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
        {snapshot.blocks.map((block) => block.kind === 'reference'
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

function BlockEditor({
  block,
  dormancyDays,
  focused,
  onBlur,
  onChange,
  onFocus,
  onKindChange,
  onReferenceChange,
  onRestoreVersion,
  onSelection,
}: {
  block: ThoughtBlock;
  dormancyDays: number;
  focused: boolean;
  onBlur: () => void;
  onChange: (content: string) => void;
  onFocus: () => void;
  onKindChange: (kind: ThoughtKind) => void;
  onReferenceChange: (field: keyof Pick<SourceReference, 'author' | 'excerpt' | 'title' | 'url'>, value: string) => void;
  onRestoreVersion: (index: number) => void;
  onSelection: (text: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = '0px';
    textarea.style.height = `${String(Math.max(112, textarea.scrollHeight))}px`;
  };
  useEffect(resize, [block.content]);
  const status = effectiveStatus(block.updatedAt, block.status, dormancyDays);
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
          <select
            aria-label="Block kind"
            onChange={(event) => { onKindChange(event.target.value as ThoughtKind); }}
            value={block.kind}
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span>{status}</span>
          {block.parentId === null ? null : <span className="thought-card__linked"><Link2 size={12} /> linked</span>}
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
          placeholder={block.parentId === null
            ? 'Start anywhere. Write what is actually there.'
            : 'Continue in your own words…'}
          ref={textareaRef}
          value={block.content}
        />
        {block.kind !== 'reference' ? null : (
          <div className="reference-fields">
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
  contextScope,
  error,
  focusBlock,
  onCalibrate,
  onContextScope,
  onDismiss,
  onFollow,
  onMove,
  onSave,
  selection,
}: {
  annotation: MarginAnnotation | null;
  busy: boolean;
  contextScope: ContextScope;
  error: string | null;
  focusBlock: ThoughtBlock | null;
  onCalibrate: (text: string) => void;
  onContextScope: (scope: ContextScope) => void;
  onDismiss: () => void;
  onFollow: (direction: ReflectionDirection) => void;
  onMove: (move: Exclude<ReflectionMove, 'calibrate'>) => void;
  onSave: () => void;
  selection: string;
}) {
  const [calibration, setCalibration] = useState('');
  const canReflect = focusBlock !== null && focusBlock.content.trim().length > 0;
  return (
    <aside aria-label="Reflection margin" className="reflection-margin">
      <div className="reflection-margin__heading">
        <span>Margin</span>
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
            {busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
            Reflect
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
          <p className="reflection-card__label">Possible directions</p>
          <div className="direction-list">
            {annotation.directions.map((direction) => (
              <button key={`${direction.label}:${direction.prompt}`} onClick={() => { onFollow(direction); }} type="button">
                <span>{direction.label}</span>
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
          <details className="calibration">
            <summary>Not quite?</summary>
            {annotation.calibration.map((turn, index) => (
              <p className={`calibration__${turn.role}`} key={`${String(turn.createdAt)}:${String(index)}`}>{turn.content}</p>
            ))}
            <form onSubmit={(event) => {
              event.preventDefault();
              if (calibration.trim().length === 0 || busy) return;
              onCalibrate(calibration.trim());
              setCalibration('');
            }}>
              <textarea
                aria-label="Correct Specular's understanding"
                onChange={(event) => { setCalibration(event.target.value); }}
                placeholder="Say what it missed. Then return to the document to make it clear."
                value={calibration}
              />
              <button disabled={busy || calibration.trim().length === 0} type="submit">Respond</button>
            </form>
          </details>
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
}: {
  blocks: ThoughtBlock[];
  documentId: string;
  dormancyDays: number;
  onOpenBlock: (block: ThoughtBlock) => void;
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
            <button
              className={`graph-node graph-node--${block.kind}`}
              key={block.id}
              onClick={() => { onOpenBlock(block); }}
              style={{ '--node-order': index } as React.CSSProperties}
              type="button"
            >
              <span>{KIND_LABELS[block.kind]} · {effectiveStatus(block.updatedAt, block.status, dormancyDays)}</span>
              <strong>{block.content.slice(0, 180)}{block.content.length > 180 ? '…' : ''}</strong>
              <small>{block.content.trim().split(/\s+/u).length} words</small>
            </button>
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
  onToggleBlock,
  publishing,
  snapshot,
  state,
}: {
  error: string | null;
  onClose: () => void;
  onPrint: () => void;
  onPublish: () => void;
  onToggleBlock: (blockId: string) => void;
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
            {payload.blocks.map((block) => block.kind === 'reference'
              ? <blockquote key={block.id}>{block.content}</blockquote>
              : <p key={block.id}>{block.content}</p>)}
          </article>
        </div>
        <footer>
          <button onClick={() => { downloadMarkdown(payload); }} type="button"><Download size={15} />Markdown</button>
          <button onClick={onPrint} type="button"><Printer size={15} />Print / PDF</button>
          <button className="primary-action" disabled={publishing || payload.blocks.length === 0} onClick={onPublish} type="button">
            {publishing ? <LoaderCircle className="spin" size={15} /> : <Share2 size={15} />}
            Publish page
          </button>
          {snapshot.publishedUrl === null ? null : (
            <button onClick={() => { void copyLink(); }} type="button">
              {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          {error === null ? null : <p className="inline-error snapshot-error" role="alert">{error}</p>}
        </footer>
      </section>
    </div>
  );
}

export function App({
  initialState,
  reflector = new HttpReflector(),
  sharePublisher = new HttpSharePublisher(),
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
  const [starterPrompt, setStarterPrompt] = useState<string | null>(null);
  const [reflectionBusy, setReflectionBusy] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const storeRef = useRef<WorkspaceStore | null>(null);

  useEffect(() => {
    if (initialState !== undefined) return;
    let active = true;
    void storeFactory().then(async (store) => {
      if (!active) { store.close(); return; }
      storeRef.current = store;
      const loaded = await store.load();
      setState(loaded);
      setInitialized(true);
    }).catch(() => { if (active) setInitialized(true); });
    return () => { active = false; storeRef.current?.close(); storeRef.current = null; };
  }, [initialState, storeFactory]);

  useEffect(() => {
    if (!initialized || initialState !== undefined) return;
    const timeout = window.setTimeout(() => { void storeRef.current?.save(state); }, 180);
    return () => { window.clearTimeout(timeout); };
  }, [initialState, initialized, state]);

  const currentDocument = activeDocument(state);
  const blocks = documentBlocks(state, currentDocument);
  const selectedBlock = state.blocks.find((block) => block.id === selectedBlockId) ?? blocks[0] ?? null;
  const currentAnnotation = [...state.annotations].reverse().find((annotation) => (
    annotation.blockId === selectedBlock?.id
    && (annotation.status === 'open' || annotation.status === 'saved')
  )) ?? null;
  const currentSnapshot = state.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
  const isBlank = blocks.every((block) => block.content.trim().length === 0);

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

  const createDocument = () => {
    const now = Date.now();
    const documentId = newId('document');
    const blockId = newId('block');
    setState((current) => ({
      ...current,
      activeDocumentId: documentId,
      documents: [...current.documents, { id: documentId, title: '', status: 'active', blockIds: [blockId], createdAt: now, updatedAt: now }],
      blocks: [...current.blocks, { id: blockId, documentId, parentId: null, originPrompt: null, content: '', kind: 'thought', status: 'active', createdAt: now, updatedAt: now, versions: [], references: [] }],
    }));
    setSelectedBlockId(blockId);
    setLibraryOpen(false);
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

  if (!initialized) {
    return <main className="workspace-loading"><span>Specular</span><LoaderCircle aria-label="Opening private workspace" className="spin" /></main>;
  }

  return (
    <main className="specular-shell">
      <header className="workspace-header">
        <button className="brand" onClick={() => { setView('document'); }} type="button">Specular</button>
        <div className="header-actions">
          <button disabled={blocks.every((block) => block.content.trim().length === 0)} onClick={createSnapshot} type="button"><FileText size={15} />Create snapshot</button>
          <button aria-expanded={libraryOpen} onClick={() => { setLibraryOpen((open) => !open); }} type="button"><Library size={15} />Library</button>
        </div>
      </header>
      <nav aria-label="Workspace views" className="workspace-nav">
        <button aria-current={view === 'document' ? 'page' : undefined} onClick={() => { setView('document'); }} type="button"><BookOpen size={15} />Document</button>
        <button aria-current={view === 'connections' ? 'page' : undefined} onClick={() => { setView('connections'); }} type="button"><Network size={15} />Connections</button>
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
                setView('document');
              }} type="button">
                <span>{item.title.trim().length > 0 ? item.title : 'Untitled thought'}</span>
                <small>{effectiveStatus(item.updatedAt, item.status, state.settings.dormancyDays)} · {item.blockIds.length} block{item.blockIds.length === 1 ? '' : 's'}</small>
              </button>
            ))}
          </div>
          <footer><span>Becomes dormant after</span><select aria-label="Dormancy period" onChange={(event) => { setState((current) => ({ ...current, settings: { ...current.settings, dormancyDays: Number(event.target.value) } })); }} value={state.settings.dormancyDays}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></footer>
        </aside>
      ) : null}

      {view === 'connections' ? (
        <ConnectionsView
          blocks={state.blocks}
          documentId={currentDocument.id}
          dormancyDays={state.settings.dormancyDays}
          onOpenBlock={(block) => { setSelectedBlockId(block.id); setView('document'); window.setTimeout(() => { globalThis.document.querySelector<HTMLTextAreaElement>(`[data-block-id="${block.id}"] textarea`)?.focus(); }, 0); }}
        />
      ) : (
        <section className="workspace-grid">
          <article aria-label="Thinking document" className="thinking-document">
            <div className="document-status">
              <span>{effectiveStatus(currentDocument.updatedAt, currentDocument.status, state.settings.dormancyDays)}</span>
              <select aria-label="Document status" onChange={(event) => { updateDocument({ status: event.target.value as ThoughtDocument['status'] }); }} value={currentDocument.status}>
                <option value="active">Active</option><option value="resting">Resting</option><option value="closed">Closed</option>
              </select>
            </div>
            <input
              aria-label="Document title"
              className="document-title"
              onChange={(event) => { updateDocument({ title: event.target.value }); }}
              placeholder="Untitled thought"
              value={currentDocument.title}
            />
            {isBlank ? (
              <div className="starter-intentions">
                <p>{starterPrompt ?? 'Start anywhere, or choose a quiet way in.'}</p>
                <div>{STARTERS.map(([label, prompt]) => (
                  <button key={label} onClick={() => { setStarterPrompt(prompt); }} type="button">{label}</button>
                ))}</div>
              </div>
            ) : null}
            <div className="block-stack">
              {blocks.map((block) => (
                <BlockEditor
                  block={block}
                  dormancyDays={state.settings.dormancyDays}
                  focused={selectedBlock?.id === block.id}
                  key={block.id}
                  onBlur={() => { window.setTimeout(() => { commitVersion(block.id); }, 0); }}
                  onChange={(content) => { updateBlock(block.id, (current) => ({ ...current, content, status: 'active', updatedAt: Date.now() })); }}
                  onFocus={() => { setSelectedBlockId(block.id); setSelection(''); }}
                  onKindChange={(kind) => { updateBlock(block.id, (current) => ({ ...current, kind, updatedAt: Date.now() })); }}
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
                />
              ))}
            </div>
            <button className="add-block" onClick={() => { addBlock(); }} type="button"><Plus size={15} />New block</button>
          </article>

          <ReflectionMargin
            annotation={currentAnnotation}
            busy={reflectionBusy}
            contextScope={state.settings.contextScope}
            error={reflectionError}
            focusBlock={selectedBlock}
            onCalibrate={(text) => { if (currentAnnotation !== null) void runReflection(currentAnnotation.move, { annotation: currentAnnotation, text }); }}
            onContextScope={(contextScope) => { setState((current) => ({ ...current, settings: { ...current.settings, contextScope } })); }}
            onDismiss={() => { if (currentAnnotation !== null) setState((current) => ({ ...current, annotations: current.annotations.map((annotation) => annotation.id === currentAnnotation.id ? { ...annotation, status: 'dismissed' } : annotation) })); }}
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
          onToggleBlock={(blockId) => { setState((current) => ({ ...current, snapshots: current.snapshots.map((snapshot) => snapshot.id === currentSnapshot.id ? { ...snapshot, blockIds: snapshot.blockIds.includes(blockId) ? snapshot.blockIds.filter((id) => id !== blockId) : [...snapshot.blockIds, blockId] } : snapshot) })); }}
          publishing={publishing}
          snapshot={currentSnapshot}
          state={state}
        />
      )}
    </main>
  );
}
