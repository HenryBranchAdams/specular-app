# Specular authenticated beta live checklist

This checklist qualifies the deployed Sites boundary after a separately authorized release. Local automation cannot substitute for these checks.

## Preconditions

- Use the existing Specular Sites project and a release containing the authenticated schema migration.
- Have two distinct ChatGPT accounts, A and B, plus a private browser window.
- Use synthetic writing only. Record the Sites release identifier and test time.

## Identity and workspace isolation

1. Open the Site signed out. Confirm no cached document content renders and the ChatGPT sign-in action is shown.
2. Sign in as A, create distinctive synthetic writing, wait for `Saved`, then open the Site in a second browser as A. Confirm the same writing loads.
3. Sign out, sign in as B in the same browser profile, and confirm A's writing never flashes or appears. Create different writing for B.
4. Switch back to A and confirm only A's workspace returns.
5. Attempt requests with client-supplied `oai-authenticated-user-id` and `oai-authenticated-user-email` headers outside the Sites identity boundary. Confirm no workspace can be selected or crossed.

## Expiry, offline work, and deletion generation

1. While A is open, revoke or expire the ChatGPT session. Confirm the workspace locks and cached content is hidden before any other account can render.
2. With A authenticated, go offline, write, reload, and confirm the device recovery remains available. Reconnect and confirm `Saved` after synchronization.
3. Create concurrent edits to different documents from two A sessions. Confirm both synchronize without conflict copies.
4. Edit the same document concurrently. Confirm the hosted version remains and the other prose appears as a named conflict copy.
5. Delete A's account data, then bring an old A tab online. Confirm the stale cache generation cannot recreate the deleted workspace.

## Inference and snapshots

1. Confirm reflection, organization, transcription, and cleanup reject signed-out requests while ordinary signed-in writing and saving still work if inference is unavailable or limited.
2. Publish a synthetic snapshot as A. Confirm signed-out access fails, while signed-in B can open the opaque link without seeing A's ChatGPT identity.
3. Confirm B cannot revoke A's link. Revoke as A and confirm both accounts receive the same unavailable response afterward.
4. Download A's hosted archive and device recovery. Confirm neither contains ChatGPT IDs, email, audio, interlocutor mirrors, or calibration text.
5. Delete A's data and confirm B's workspace and links are unaffected.

## Account switching and UI checks

1. Repeat sign-in, sign-out, account switching, archive, deletion, and snapshot revocation on current mobile Safari and mobile Chrome.
2. Confirm keyboard-only access, visible focus, screen-reader names, responsive layout, and PWA restart behavior.
3. Record any difference in session propagation, revocation latency, or account switching. These Sites behaviors are not documented guarantees.

Do not mark live qualification complete until every performed check has dated evidence. Do not deploy or change the Site audience as part of running this document without separate authorization.
