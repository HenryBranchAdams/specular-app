# 07 — Qualify secondary hosted surfaces and record the widget boundary

Status: ready-for-agent
Blocked by: 06

## Outcome

Apply the system to Library settings, published links, account safety, Snapshot, and hosted snapshots. Record the separately built MCP widget as a legacy compatibility surface outside the hosted-product rework; do not refactor, adapt, or remove it in this issue.

## Acceptance

- Loading and empty states are distinct in Library, published links, Connections, and hosted snapshots.
- Account and publication operations have action-specific busy, success, and failure states.
- Hosted snapshots receive rendered visual and axe coverage.
- Active hosted-product manifests and quality gates do not count the legacy widget as an unqualified missing surface.
- A concise boundary note points to the README compatibility statement and records that retention, adaptation, or removal requires separate future work.
- No widget source, transport, artifact, or compatibility test changes are included.
