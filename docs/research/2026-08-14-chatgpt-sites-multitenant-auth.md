# ChatGPT Sites authentication for Specular multi-tenancy

Date: 2026-08-14

## Research question

Can Specular use ChatGPT login as the identity boundary for a multi-tenant Site, and what is actually documented about the user identifier, request headers, external visitors, account switching, session expiration, access revocation, and server authorization?

## Short answer

Yes. The first-party Sites runtime contract provides a stable, Site-scoped ChatGPT user ID to server requests. Specular can use that ID as its tenant key, provided every protected server read and write derives the tenant from the request identity and never accepts a tenant ID from the client.

This is not a complete session-management contract. OpenAI's published documentation and installed Sites materials do **not** specify account-switch propagation, session lifetime, cookie expiry, revocation latency, the ID format, or whether the same ID survives Site deletion/recreation. Those behaviors need fail-closed implementation and live qualification before beta access is expanded.

## Source classification

This note uses only first-party OpenAI sources.

1. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites), especially “Add Sign in with ChatGPT,” “Control access and secrets,” and “Review before you share.” This is the public product/developer contract.
2. OpenAI-bundled Sites plugin `0.1.37`, installed locally at:
   - `skills/sites-building/references/authentication.md`
   - `skills/sites-building/templates/vinext-starter/README.md`
   - `skills/sites-building/templates/vinext-starter/app/chatgpt-auth.ts`

   These versioned first-party materials document the stable ID header and provide the reference server helper. The public Sites page currently documents the email and optional full-name headers but does not list the ID header.
3. The installed first-party Sites connector contract for `sites_update_site_access`, which documents custom access, workspace viewers and groups, and email-bound external visitors.

## Documented facts

### 1. Server identity and stable identifier

- Signed-in visitors receive `oai-authenticated-user-id` and `oai-authenticated-user-email` on server requests. The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact, not durable identity. [OpenAI-bundled Sites authentication reference, source 2]
- A non-empty profile name may also be sent as `oai-authenticated-user-full-name`, with `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`. It is optional and the implementation must fall back to email. [OpenAI-bundled Sites authentication reference, source 2]
- The public Sites guide confirms that Sites forwards authenticated identity to the **server** through request headers and explicitly requires server-side authorization. It publicly names the email and optional full-name headers. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#add-sign-in-with-chatgpt)
- The bundled `getChatGPTUser()` helper returns a user only when both user ID and email are present. The `requireChatGPTUser(returnTo)` helper redirects anonymous browser page requests into the dispatcher-owned sign-in flow. [OpenAI-bundled `app/chatgpt-auth.ts`, source 2]

**Conclusion:** `oai-authenticated-user-id` is the correct Specular tenant key. Email, full name, browser profile, and any client-provided ID are not suitable tenant keys.

### 2. Sign-in and sign-out ownership

- Sites owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, OAuth cookies, and identity-header injection. An app must not implement those reserved routes. [OpenAI-bundled starter README and helper, source 2]
- Public Sites may remain available to anonymous visitors while offering optional Sign in with ChatGPT. Workspace-restricted or private Sites require sign-in according to their sharing policy. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#add-sign-in-with-chatgpt)
- Return destinations should be same-origin relative paths. The bundled helper rejects protocol-relative, cross-origin, malformed, and reserved-auth-route destinations. [OpenAI-bundled `app/chatgpt-auth.ts`, source 2]

### 3. Client visibility

- The documented identity delivery mechanism is server request headers. No first-party source reviewed here documents a browser API that exposes the stable user ID directly to client JavaScript.
- The public guide demonstrates server-side identity use and says authorization decisions belong in server-side code. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#add-sign-in-with-chatgpt)

**Conclusion:** Specular should obtain identity in server code. If client UI needs account display state, a same-origin server endpoint can return the minimum display-safe projection; it must not make authorization decisions in the browser.

### 4. External visitors and audience controls

- A new Site is limited to its owner and workspace admins until access changes. Supported access modes can include selected users or groups, anyone in the workspace, and anyone on the internet. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#control-access-and-secrets)
- For limited sharing, invited visitors must sign in with the account that received access. A public Site can be visited without ChatGPT workspace access. Site audience and an in-app authentication feature are separate controls. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#control-access-and-secrets)
- The Sites access connector supports an email allowlist that can include workspace users and external visitors. Adding an external visitor may send an invitation email. It distinguishes email-bound external grants from same-workspace account users. [Installed Sites connector contract, source 3]
- SIWC identifies a ChatGPT user; it does not itself prove workspace membership. Workspace restrictions belong in Sites access policy or an explicit server-side membership/allowlist check. [OpenAI-bundled Sites authentication reference, source 2]

**Conclusion:** A private beta can use custom Sites access to decide who may enter, then use the Site-scoped authenticated user ID to isolate each tester's records. Those are two separate controls.

### 5. Access revocation

- The owner can restrict a Site back to selected people or only themselves, and should confirm that the previous audience can no longer open it. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#take-down-or-delete-a-site)
- The installed Sites connector exposes a monotonic access-policy revision and supports removing workspace viewers, groups, and email-bound visitors. [Installed Sites connector contract, source 3]

**Conclusion:** Sites access policy is the documented mechanism for revoking entry. The exact propagation time and treatment of already-open sessions are not documented.

### 6. Server authorization expectations

- OpenAI explicitly says to keep authorization decisions in server-side code. For API routes and server actions, the bundled guidance says to read the current request identity and reject missing identity rather than trust client UI. [ChatGPT Sites developer guide](https://learn.chatgpt.com/docs/sites#add-sign-in-with-chatgpt); OpenAI-bundled Sites authentication reference, source 2]
- SIWC is authentication, not application authorization or proof of workspace membership. [OpenAI-bundled Sites authentication reference, source 2]
- Protected server-rendered pages must be dynamic because their output depends on per-request identity headers. [OpenAI-bundled Sites authentication reference, source 2]

**Conclusion:** Every Specular API route must resolve the authenticated user anew, then tenant-scope its D1 query. A query that is not constrained by the authenticated tenant is an authorization defect even if the page itself required sign-in.

## Not documented by the reviewed sources

The following must not be represented as guaranteed platform behavior:

- the format, length, entropy, or internal meaning of `oai-authenticated-user-id`;
- whether the Site-scoped ID survives Site cloning, deletion and recreation, or migration to another Site project;
- any relationship between the runtime user ID and the account-user or external-grant IDs returned by Sites access-management tooling;
- whether or how the stable user ID is exposed directly to client JavaScript;
- ChatGPT/SIWC session duration, idle timeout, absolute timeout, refresh behavior, or cookie attributes;
- how quickly an account switch changes identity headers on an already-open tab;
- how quickly access revocation terminates an already-open or cached session;
- whether an anonymous visitor who signs in can be linked to earlier anonymous state;
- local-development emulation for SIWC identity;
- a public guarantee describing how the dispatcher handles a visitor-supplied header with the same name as a platform identity header;
- CSRF behavior or guarantees for application-owned mutation endpoints.

The public Sites guide's omission of `oai-authenticated-user-id` is also worth tracking. The OpenAI-bundled Sites `0.1.37` materials document it explicitly, but a future plugin/runtime update should be rechecked before release.

## Architecture inferences for Specular

These are recommendations derived from the documented contract, not additional OpenAI guarantees.

1. **Use one server identity adapter.** Copy or adapt the bundled `getChatGPTUser()` behavior behind a small Specular module. Treat missing ID or email as unauthenticated.
2. **Use the Site-scoped user ID as `tenant_id`.** Never key records by email. Never accept `tenant_id`, owner ID, or user ID from request JSON, URL parameters, browser storage, or model output.
3. **Authorize every operation at the query.** Every document, block, edge, preference, dictation draft, export, and private snapshot query must include the authenticated tenant predicate. Inserts derive the tenant from the server identity adapter.
4. **Fail closed per request.** A missing or changed identity must produce an unauthenticated response before any user data is read. Do not rely on a client-side sign-in indicator or a value cached at page load.
5. **Keep Site access and data authorization separate.** Use custom Site access for the beta allowlist. Still tenant-scope all application data; Site access alone does not separate testers from one another.
6. **Do not silently claim existing device-local data.** Current IndexedDB content has no verified account owner. Migration should require an explicit, reviewable import into the signed-in account, with an unchanged local recovery copy until success is confirmed.
7. **Partition or remove authenticated browser caches.** Any retained local cache must include the server-confirmed Site-scoped user ID in its namespace and must be closed or switched before rendering data after an account change. Server state remains authoritative.
8. **Treat public snapshots as capabilities, not tenant reads.** If snapshots remain shareable without sign-in, use an opaque public slug and store an explicit published projection. Never expose the authenticated workspace record through a public route.
9. **Add explicit CSRF protection for state-changing endpoints.** Identity headers authenticate the visitor but do not, in the reviewed sources, document application-request forgery protection.
10. **Minimize client identity data.** Return only display name/email when the UI needs them. The stable user ID can remain server-only unless there is a concrete namespacing need.

## Required live qualification before beta

The documentation establishes a viable architecture, but these tests are needed because several runtime behaviors are unspecified:

1. With two invited ChatGPT accounts, create different workspaces and prove neither account can read, update, delete, export, reflect on, or snapshot the other's data.
2. Sign out and sign into the second account in the same browser profile. Confirm the first account's content disappears before the second account's UI renders.
3. Revoke one tester in Sites access controls while their Site is open. Confirm new requests fail and document whether a reload or re-authentication is required.
4. Exercise session expiry or forced sign-out during a pending write. Confirm the write fails closed without being attributed to another account and the local draft remains recoverable.
5. Attempt direct calls to every protected endpoint with no identity and with client-supplied identity-like headers. Confirm the deployed dispatcher/application combination cannot be used to select another tenant.
6. Verify an invited external visitor receives a stable runtime ID on repeated requests and that it remains distinct from other testers.
7. Confirm public snapshot routes reveal only the deliberate published projection and no private account or workspace metadata.

## Decision supported by this research

ChatGPT login is sufficient as Specular's authentication input for a private multi-tenant beta. The implementation should use server-side, request-derived `oai-authenticated-user-id` plus D1 tenant scoping. It should not promise cross-Site identity portability, documented account-switch semantics, or a known session/revocation SLA. Those remain live-qualification findings, not assumptions.
