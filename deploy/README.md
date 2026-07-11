# Specular Deployment and Rollback

Specular deploys as one immutable, database-free container. The container serves the built PWA and the stateless model/MCP/Realtime service from port 8788. User threads and capsules remain in each browser's IndexedDB; the service has no content database or persistent volume.

## Environments and secrets

`development.env`, `preview.env`, and `production.env` contain distinct non-secret configuration. Replace the example origins before deployment. Supply `OPENAI_API_KEY` only through the platform secret store at runtime; never bake it into an image, Compose file, CI cache, or environment artifact. Keep Realtime disabled until its release gate and authorized live smoke test pass.

Terminate TLS at the managed load balancer or ingress and forward HTTPS traffic to container port 8788. Redirect HTTP to HTTPS, preserve the request `Origin`, and restrict ingress health probes to `/healthz`. `/readyz` deliberately returns 503 when the model provider is unavailable, while `/healthz` and the locally functional PWA remain available.

## Build, preview, and promotion

Build once and identify the immutable digest:

```bash
docker build --target production -t registry.example/specular:${GIT_SHA} .
docker push registry.example/specular:${GIT_SHA}
docker inspect --format='{{index .RepoDigests 0}}' registry.example/specular:${GIT_SHA}
```

Deploy that exact digest to preview, run `node scripts/verify-production.mjs` against the artifact in CI, then perform the documented physical-device compatibility pass. Promote the same digest—do not rebuild—by updating production to `registry.example/specular@sha256:…`. Record the digest, configuration revision, browser evidence, and prior production digest in the release audit.

Local profile checks:

```bash
docker compose --profile preview up --build
SPECULAR_IMAGE=registry.example/specular@sha256:… docker compose --profile production up
```

After deployment, require `/healthz` HTTP 200, `/readyz` HTTP 200 when the key/provider is expected to be live, PWA/manifest/service-worker HTTP 200, one non-billable boundary check, and one authorized smoke operation. Health and readiness themselves never make billable model calls. Verify logs contain request metadata but no seeded user-content sentinel.

## Rollback

Keep the prior healthy digest during promotion. If health, readiness, browser, privacy, or operation checks fail, point the platform back to the recorded prior digest, wait for `/healthz`, and verify the PWA and local capsules remain accessible. Configuration changes roll back with the matching versioned platform release. No database migration or content restore is required because the service is stateless and the IndexedDB schema remains in the client artifact.

When the provider is unavailable, do not take down the PWA: users must retain local access to existing threads, capsules, export, and deletion. New model operations show the typed retry state until readiness recovers.
