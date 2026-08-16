# Specular public sharing

## Outcome

Let an author choose whether a deliberately published snapshot requires sign-in or is readable by anyone holding its opaque link. Keep the signed-in level as the privacy-preserving default, retain owner-only management, and let the public reader understand that the writing was created in Specular without turning account identity into attribution.

## Boundaries

- This is snapshot publication, not public workspaces, collaboration, profiles, comments, feeds, or search indexing.
- Existing links remain signed-in-only after migration.
- Public links are unlisted capability links and remain revocable by the author.
- Visibility cannot be widened silently after publication; revoke and republish to change it.
- Only canonical writing and deliberately included references enter the published payload.
- The author account's name and email remain excluded.

## Acceptance

- PDF and Markdown export filenames derive from the author-confirmed snapshot title.
- The snapshot editor clearly offers Signed-in readers and Anyone with the link.
- Signed-in readers is the default and existing snapshot records migrate to it.
- An anonymous reader receives a public snapshot but cannot read a signed-in snapshot or any share-management endpoint.
- Published pages include restrained Specular attribution and a path to begin writing.
- Revocation and account deletion stop both signed-in and public reads.
- Unit, D1 integration, browser interaction, accessibility, and responsive checks cover the new boundary.
