# Specular Thinking Environment

Specular helps an author use nonlinear writing to discover and refine what they think while keeping authorship visibly under their control.

## Language

**Author account**:
The signed-in ChatGPT identity that owns one private Specular workspace on this Site.
_Avoid_: Browser profile, local owner, tenant in product copy

**Private workspace**:
The server-authoritative collection of an author account's documents, blocks, connections, preferences, drafts, and history. Another author account cannot read or change it.
_Avoid_: Local workspace, shared workspace

**Workspace cache**:
An account-scoped local copy that keeps the private workspace responsive and preserves writing during disconnection. It never determines who owns the workspace.
_Avoid_: Local workspace, browser owner

**Unsynced change**:
Author-owned writing held durably in the workspace cache but not yet acknowledged by the server-authoritative private workspace.
_Avoid_: Temporary text, failed save

**Locked workspace**:
A private workspace temporarily withheld because the current request lacks the same verified author account required to read or synchronize it. Its unsynced changes remain recoverable but invisible to other accounts.
_Avoid_: Logged-out workspace, deleted workspace

**Conflict copy**:
An intact additional version created when independent changes cannot be synchronized without choosing between the author's words. It preserves both lines of thought for deliberate resolution.
_Avoid_: Automatic merge, overwritten version

**Workspace archive**:
A downloadable, versioned copy of an author account's durable author-owned material, settings, recoverable drafts, and snapshot records for safekeeping. It excludes session audio and ephemeral interlocutor responses, and the beta does not import it.
_Avoid_: Transfer file, portable workspace

**Hosted snapshot**:
A deliberately published projection of canonical writing available to a signed-in ChatGPT visitor who possesses its opaque link.
_Avoid_: Public workspace, shared document

**Revoked snapshot**:
A hosted snapshot whose link the author has deliberately invalidated without changing the underlying private document.
_Avoid_: Deleted document, expired workspace

**Canonical writing**:
The author-owned words that form the thinking document and may appear in its history, connections, snapshots, or exports. Once accepted, typed and dictated writing have no enduring distinction.
_Avoid_: Generated copy, assistant output

**Dictation session**:
An author-initiated period of speaking directed at one target block. Deliberate pauses remain part of the same session until the author ends or cancels it.
_Avoid_: Voice chat, voice conversation

**Target block**:
The focused writing block the author explicitly chooses to receive a dictation draft.
_Avoid_: Inferred destination, active document

**Dictation draft**:
A provisional, editable transcript of the author's speech associated with a target block but not yet part of canonical writing.
_Avoid_: Voice message, canonical transcript

**Interrupted draft**:
A dictation draft whose capture ended unexpectedly and whose visible boundary tells the author that no later speech was captured.
_Avoid_: Failed recording, recovered block

**Transcript checkpoint**:
A durable portion of a dictation draft produced from a bounded span of speech. It can survive an interruption without becoming canonical writing.
_Avoid_: Saved block, final transcript

**Faithful cleanup**:
A reversible refinement of a dictation draft that removes speech noise and applies legible mechanics without adding, reordering, resolving, or completing the author's ideas.
_Avoid_: Rewrite, polish, editorial improvement

**Verbatim draft**:
The provisional transcript before faithful cleanup, available during review so the author can compare against or reject the cleaned version.
_Avoid_: Raw recording, canonical original

**Insertion anchor**:
The cursor position in the target block where dictation begins or resumes and where the draft belongs.
_Avoid_: Destination guess, automatic placement

**Keep**:
The author's deliberate act of promoting a dictation draft into canonical writing as one atomic document change.
_Avoid_: Submit, send, publish

**Session audio**:
Audio that exists only during active capture until its transcript checkpoint is durable. It is never part of the workspace or its history and is not retained after an interruption for later recovery.
_Avoid_: Recording, voice note

**Voice diagnostics**:
Content-free operational signals about dictation reliability, such as coarse duration, latency, retries, checkpoints, and failure category.
_Avoid_: Transcript telemetry, audio analytics, content logs

**Operational diagnostics**:
Content-free security and usage signals required to enforce rate limits and understand failures. They exclude authored writing, transcripts, interlocutor content, email, and display names.
_Avoid_: Content analytics, user profile
