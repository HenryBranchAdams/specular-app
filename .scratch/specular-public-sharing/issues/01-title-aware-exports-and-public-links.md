# 01 — Add title-aware exports and author-controlled public links

Status: ready-for-agent
Blocked by: none

## Outcome

Implement the bounded public-sharing contract in the parent spec while preserving signed-in publication as the default and keeping every management operation owner-authenticated.

## Acceptance

- [x] Export names match the confirmed snapshot title after filesystem-safe character handling.
- [x] The author chooses Signed-in readers or Anyone with the link before publishing.
- [x] Existing and unspecified links remain signed-in-only.
- [x] Anonymous public reads succeed; anonymous signed-in reads and all anonymous management requests fail closed.
- [x] Public pages preserve authored formatting and include restrained Specular attribution.
- [x] Visibility is retained in listing and archive records.
- [x] Migration, unit, D1 integration, rendered desktop/mobile, and accessibility checks pass.
