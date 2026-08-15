# Specular ChatGPT-authenticated multi-tenancy

**Status:** implemented-locally — live Sites qualification pending

## Problem Statement

Specular currently gives each browser profile one device-local workspace. That keeps one device's writing separate in ordinary use, but it is not account-level isolation: changing ChatGPT accounts in the same browser can reveal the same data, the workspace does not follow an author across devices, and hosted snapshots have no verified owner. Before the beta expands beyond the creator, every signed-in author needs a private workspace that is authorized on every server request, remains resilient during disconnection, and never exposes one author's writing to another account.

## Solution

Require ChatGPT sign-in for the workspace while leaving registration open to any ChatGPT account that receives the Site URL. Derive the author account only from the stable Site-scoped user identifier supplied to the server by ChatGPT Sites. Store one server-authoritative private workspace per author account and maintain a separate account-scoped workspace cache for responsive and offline writing.

Synchronize cached changes through revision-checked server writes. Merge independent structural changes when safe, but never merge prose or silently choose a last writer. When the same document changed independently, preserve the server version and create a linked conflict copy containing the local version. Lock the workspace immediately when authentication is absent or changes, and make explicit sign-out synchronize before clearing the cache.

Keep hosted snapshots as deliberate, immutable projections available only to a signed-in ChatGPT visitor holding the opaque link. Associate every snapshot with its author account so it can be listed, revoked, and removed by account deletion without exposing ChatGPT identity as attribution.

Start the authenticated beta with clean data. Existing unowned browser test data and unowned hosted test snapshots are removed rather than silently claimed. Provide a download-only workspace archive, tenant-scoped deletion, concise privacy information, content-free usage safeguards, and no local-only or archive-import mode in the beta.

## User Stories

1. As a visitor, I want Specular to require ChatGPT sign-in before opening a workspace, so that anonymous visitors cannot create or read private writing.
2. As a ChatGPT user who received the Site URL, I want to sign in without waiting for an invitation allowlist, so that the beta remains easy to join.
3. As an author, I want my private workspace to be keyed to my verified ChatGPT identity, so that it is separate from every other author account.
4. As an author, I want a fresh private workspace on first sign-in, so that unowned test data is not silently attributed to me.
5. As an author, I want my workspace to follow me across browsers and devices, so that my thinking is not trapped in one browser profile.
6. As an author, I want the writing surface to remain responsive while changes synchronize, so that hosted persistence does not make writing feel remote or sluggish.
7. As an author, I want to continue writing during a temporary network loss, so that a disconnection does not interrupt a line of thought.
8. As an author, I want unsynced changes stored durably in my workspace cache, so that closing or reloading the app does not discard them.
9. As an author, I want a quiet visible indication when changes are not yet synchronized, so that I understand their durability without visual noise.
10. As an author, I want reconnection to synchronize pending changes automatically, so that ordinary recovery requires no manual task management.
11. As an author, I want independently changed documents to synchronize without conflict when neither change overwrites the other, so that multi-device use remains natural.
12. As an author, I want both versions preserved when the same document changed independently, so that Specular never chooses which of my words matter.
13. As an author, I want the preserved version presented as a linked conflict copy, so that I can resolve it deliberately outside the active document.
14. As an author, I want a conflict copy clearly identified until I resolve or dismiss it, so that it does not masquerade as an ordinary branch.
15. As an author, I want Specular never to automatically merge prose, so that canonical writing remains mine.
16. As an author using a shared browser, I want the current author account shown quietly in the interface, so that I can confirm whose workspace is open.
17. As an author, I want an explicit Sign out action, so that I can leave a shared browser deliberately.
18. As an author, I want Sign out to synchronize first and warn about any remaining unsynced changes, so that leaving does not silently discard writing.
19. As an author, I want a completed Sign out to clear my workspace cache from that browser, so that the next account cannot load it.
20. As an author whose session expires, I want my workspace locked immediately, so that cached writing is not exposed after authentication is lost.
21. As an author whose session expires with unsynced writing, I want that writing preserved as recovery material for the same account, so that security does not require data loss.
22. As a different account signing into the same browser, I want the previous account's workspace hidden before my interface renders, so that account switching cannot leak private writing.
23. As the returning original account, I want eligible stranded changes recovered after reauthentication, so that an expired session does not destroy my work.
24. As an author, I want my documents, blocks, history, connections, sources, preferences, drafts, and snapshots scoped to my author account, so that every private projection obeys the same ownership rule.
25. As an author, I want reflection and organization to operate only on context from my private workspace, so that another account's writing can never enter my model context.
26. As an author, I want dictation checkpoints and drafts scoped to my author account, so that provisional speech is as private as typed writing.
27. As an author, I want ordinary writing to remain available when model usage is temporarily limited, so that inference availability never blocks authorship.
28. As an author, I want a clear message when reflection, organization, cleanup, or transcription is limited, so that I understand the failure without losing writing.
29. As the operator, I want per-account and global usage safeguards, so that an unlisted URL does not create unbounded inference costs.
30. As an author, I want default diagnostics to contain no authored writing, transcripts, interlocutor content, email, or display name, so that operational visibility does not become content surveillance.
31. As an author, I want optional product telemetry disabled until I enable it, so that diagnostics remain transparent and governed.
32. As an author, I want Settings to explain hosted storage, local caching, and inference triggers, so that I can inspect the privacy boundary.
33. As an author, I want to create a hosted snapshot from selected canonical writing, so that sharing remains deliberate.
34. As an author, I want hosted snapshots to require ChatGPT sign-in, so that anonymous visitors cannot read them during beta.
35. As a signed-in recipient with an opaque snapshot link, I want to read the published artifact without entering the author's workspace, so that sharing does not grant workspace access.
36. As an author, I want my ChatGPT name and email omitted from hosted snapshot attribution, so that authentication metadata does not become authorship metadata.
37. As an author, I want to list my hosted snapshots, so that I can understand which artifacts remain available.
38. As an author, I want to revoke one hosted snapshot link, so that I can stop sharing without changing the private document.
39. As a recipient of a revoked snapshot link, I want an unavailable response with no private metadata, so that revocation is complete and unambiguous.
40. As an author, I want to download a versioned workspace archive, so that I can retain an independent copy of my durable data.
41. As an author, I want an archive to include durable author-owned writing, structure, history, sources, preferences, recoverable drafts, and snapshot records, so that the archive is meaningful.
42. As an author, I want archives to exclude session audio and ephemeral interlocutor responses, so that recovery does not promote noncanonical material.
43. As an author, I want archive creation to synchronize first when possible, so that the download reflects the latest acknowledged workspace.
44. As an offline author, I want a recovery download for unsynced cached writing, so that server unavailability does not prevent safekeeping.
45. As an author, I want archive import clearly unavailable during beta, so that a download is not mistaken for a supported transfer workflow.
46. As an author, I want to delete all my data with explicit confirmation, so that I retain control over the hosted workspace.
47. As an author, I want account deletion to remove my private authored data and revoke my hosted snapshots, so that shared artifacts do not outlive my decision.
48. As an author, I want deletion to clear only my account's workspace cache, so that another author's local data remains untouched.
49. As an author, I want stale offline devices prevented from resurrecting deleted data, so that deletion remains authoritative after reconnection.
50. As a different author account, I want another account's export, deletion, snapshot, or synchronization operations to have no effect on me, so that tenant isolation is complete.
51. As a visitor without valid identity headers, I want protected server requests rejected before data is read, so that the application fails closed.
52. As the operator, I want client-supplied identity values ignored, so that a browser cannot select another tenant.
53. As the operator, I want mutation requests protected against cross-site request forgery, so that ChatGPT sign-in cannot be abused by another origin.
54. As the operator, I want the same existing Site project reused, so that Site-scoped author identities are not invalidated by recreation.
55. As a beta tester, I want the core writing, reflection, dictation, connections, history, snapshot, export, and offline behaviors to remain intact, so that tenancy does not replace the product I am testing.

## Implementation Decisions

- Introduce one server identity module whose interface returns the verified author account for the current request. The production adapter reads the stable Site-scoped authenticated user ID and requires the corresponding email to be present; email and full name are returned only as display metadata and are never durable keys.
- Never accept an author-account identifier, tenant identifier, email, cache namespace, or ownership value from request JSON, URL parameters, browser storage, model output, or client-selected headers.
- Keep the Site reachable without a custom invitation allowlist, but require ChatGPT sign-in in the application before any workspace or hosted snapshot is returned.
- Provide a same-origin session bootstrap interface that returns only authentication state, display-safe account metadata, and an opaque random cache namespace. The stable Sites user ID remains server-only.
- Store one validated server-authoritative private workspace per author account in D1 with an opaque cache namespace, monotonic revision, deletion generation, validated workspace payload, and timestamps.
- Create a new authenticated workspace schema rather than mutating unowned test data into tenant data. The release migration removes existing unowned hosted test snapshots, and the first authenticated client removes the legacy unowned browser database without claiming it.
- Replace the active fixed local workspace store with a synchronization module whose small interface owns bootstrap, cached load, pending-save durability, synchronization, archive recovery, sign-out cleanup, and account deletion cleanup.
- Namespace every cached workspace and pending change by the server-issued cache namespace. Rotate that namespace when all account data is deleted so stale devices cannot reapply pre-deletion changes.
- Store pending changes durably before presenting them as saved locally. A visible sync state distinguishes synchronized, unsynced, synchronizing, locked, and conflict conditions without creating task-management UI.
- Use monotonic server revisions and compare-and-set writes. Every accepted mutation supplies the last acknowledged revision and a unique mutation identifier so retries are idempotent.
- Reconcile at document and metadata structure, not prose. Changes to independent documents may combine. If the server and cache both changed the same document from their shared base, keep the server document and add the cached document as a linked conflict copy. Never synthesize, merge, or rewrite document text during synchronization.
- Lock before rendering when bootstrap identity is missing or changes. A locked workspace exposes no cached content. Recovery data remains addressable only after the same server-issued cache namespace returns.
- Explicit Sign out attempts synchronization first. If unsynced writing remains, the UI requires the author to continue syncing or download recovery material before completing the in-app sign-out. Successful sign-out clears the current account's cache before navigating to the Sites-owned sign-out route.
- Treat direct sign-out, expiry, and account switching as abrupt loss paths: clear rendered state immediately, close the active cache, and never attach pending changes to a newly authenticated account.
- Make every workspace, archive, deletion, usage, reflection, organization, dictation, and snapshot mutation authorize from the current server identity and constrain its D1 query by that identity.
- Continue sending only bounded, relevant workspace context to inference routes. Preserve existing authorship rules, selection-aware reflection, automatic eligible title/tag organization, dictation review, faithful cleanup, and provider storage-disabled requests.
- Add content-free per-account and global counters for model-backed actions. Limit failures affect only inference features; local and server writing persistence remain available.
- Require an explicit same-origin mutation intent header and exact origin validation for state-changing application routes. Do not rely on undocumented Sites cookie or request-forgery behavior.
- Add author ownership to hosted snapshot storage. Snapshot creation derives ownership on the server. Signed-in reads use the opaque slug without revealing owner identity; list, revoke, and account deletion additionally require owner authorization.
- Represent revocation durably and return an unavailable response that cannot distinguish missing, revoked, or unauthorized private artifacts through metadata.
- Keep hosted snapshot payloads limited to the deliberate published projection. Do not include author-account identifiers, email, display name, private document identifiers beyond the existing published block projection, margin responses, drafts, or diagnostics.
- Produce workspace archives from the current author account only. Synchronize first when online; provide a distinct local recovery archive when synchronization is unavailable. Do not implement archive import in the beta.
- Delete all authored workspace content, drafts, preferences, histories, connections, sources, and owned snapshots for the current author while retaining only the minimum content-free deletion generation required to prevent stale-cache resurrection.
- Keep optional product telemetry disabled by default. Security logs and usage diagnostics use allowlisted event shapes and never accept arbitrary fields or authored strings.
- Add a quiet account indicator, explicit Sign out control, sync-state communication, conflict-copy treatment, snapshot management, and privacy explanation using the existing visual language and accessibility conventions.
- Keep the authenticated beta hosted-only. Do not expose a local-only workspace mode or mixed ownership toggle.
- Reuse the existing Sites project. A new Site project is outside the identity contract because the stable user ID is documented as Site-scoped.

## Testing Decisions

- Tests verify behavior through public interfaces and survive internal refactors. Identity isolation, authorization, synchronization, and authorship outcomes are asserted; private helper calls and storage implementation details are not test targets.
- The Worker HTTP interface is the server seam. Tests use two distinct verified identities against the same in-memory D1 adapter and prove fail-closed unauthenticated requests, per-query tenant scoping, idempotent writes, revision conflicts, usage limits, request-forgery rejection, archive/deletion isolation, and snapshot create/read/list/revoke behavior.
- The workspace synchronization interface is the persistence seam. Tests use two cache namespaces in one IndexedDB factory and prove offline durability, reconnect synchronization, account switching, session locking, sign-out cleanup, stale-generation rejection, archive recovery, and conflict-copy preservation without prose merging.
- The browser product interface is the user seam. Existing full-workflow, accessibility, responsive, PWA, and performance tests are extended to cover the sign-in gate, fresh account bootstrap, account indicator, offline sync state, same-browser account switching, session expiry, conflict presentation, Settings privacy copy, snapshot revocation, archive download, and account deletion.
- Live Sites qualification is a release seam rather than an automated substitute. Two real ChatGPT accounts must prove workspace isolation, same-browser switching, external visitor identity stability, expiry/revocation behavior, identity-header spoof resistance, and signed-in snapshot access before beta sharing.
- Existing prior art includes Worker route tests with an in-memory D1 adapter, IndexedDB repository and recovery tests, injectable workspace-store application tests, full browser workflow tests, offline PWA restart tests, automated accessibility checks, and mobile Chromium/WebKit coverage.
- Automated browser engines are not represented as physical-device evidence. Live identity qualification is not represented as complete until it runs against the deployed Site and actual ChatGPT accounts.
- Every tracer-bullet implementation slice follows red then green at one of the approved seams. Type checking and the focused test file run during each slice; the full validation and browser suites run at the end.

## Out of Scope

- A local-only workspace mode.
- Anonymous workspaces or anonymous hosted snapshots.
- A beta invitation allowlist or workspace-membership authorization beyond mandatory ChatGPT sign-in.
- Workspace sharing, collaboration, editors, teams, organizations, or shared tenants.
- Archive import, account-to-account transfer, or account merging.
- Automatic prose merging or last-writer-wins conflict resolution.
- Migrating or claiming the existing unowned local test workspace.
- Preserving existing unowned hosted test snapshots.
- Displaying ChatGPT identity as snapshot attribution.
- Application-managed passwords, OAuth, session cookies, or replacements for Sites-owned authentication routes.
- A guaranteed session duration, revocation latency, or cross-Site identity portability claim.
- Premium plans, billing, visible quotas, or precise credit metering.
- Content analytics, transcript logging, model-response logging, or default-on product telemetry.
- Public deployment, tester access changes, or production publication as part of implementation.

## Further Notes

- Primary authentication research is recorded in the repository's dated Sites multi-tenancy research note. The stable ID contract comes from OpenAI-bundled Sites materials; session duration, account-switch propagation, revocation latency, direct client identity access, and dispatcher handling of spoofed identity-like headers remain live-qualification questions.
- Site audience and application authorization are separate. The beta intentionally omits an allowlist, but every application data operation remains author-account scoped.
- The current IndexedDB stores already use owner-prefixed compound keys, but the owner type is restricted to one literal and the active application persists one fixed workspace preference blob. These are migration opportunities, not evidence of existing multi-tenancy.
- The current hosted snapshot table has no owner column and reads solely by slug. It must not be reused as though its rows were tenant-owned.
- The working tree contained an existing untracked Specular-refinement tracker before this effort. That prior material remains outside this feature's issue directory and must not be altered or absorbed.
