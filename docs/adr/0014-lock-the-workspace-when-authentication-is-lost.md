# Lock the workspace when authentication is lost

When authentication expires or changes, Specular hides the private workspace immediately and preserves unsynced changes only as account-scoped recovery material until the same author account returns. Continuing to render a cached workspace would feel smoother, but it could expose one author's writing to another account in a shared browser; explicit sign-out synchronizes first and clears the signed-out cache.
