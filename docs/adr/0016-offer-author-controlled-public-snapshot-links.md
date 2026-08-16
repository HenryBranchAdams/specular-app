# Offer author-controlled public snapshot links

This decision supersedes ADR 0010's blanket sign-in requirement for hosted snapshot reads.

Publishing remains a deliberate author action and defaults to **Signed-in readers**. Before publishing, the author may instead choose **Anyone with the link**. A public snapshot is an unlisted capability artifact: a reader holding its opaque link may read the published projection without a Specular or ChatGPT account. The choice does not make the private workspace collaborative, searchable, or public.

Creation, listing, revocation, archive access, account deletion, and all private workspace operations continue to require the verified author account. Existing hosted snapshots migrate to the signed-in default. Changing a published link's audience requires revoking it and publishing a new link, which keeps access changes legible and prevents a quiet widening of an existing artifact.

Public pages may identify Specular as the writing environment and offer a path to start writing, but they do not infer or display the author's ChatGPT name or email. ADR 0015 remains in force.
