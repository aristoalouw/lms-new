# Dependency security exceptions

Last reviewed: 2026-07-22

## Production dependency chain

`npm audit --omit=dev` reports six moderate findings and no high or critical findings. They are all transitive through `firebase-admin` / `@google-cloud/storage`: `firebase-admin`, `@google-cloud/storage`, `retry-request`, `teeny-request`, `gaxios`, and `uuid`.

The registry-proposed remediation is a breaking downgrade to `firebase-admin@10.3.0`, so it is not applied. `npm audit fix --force` is prohibited. Runtime exposure is reduced because application code does not call UUID v3/v5/v6 with caller-provided output buffers, uploads use server-generated object paths, downloads require current authorization and short-lived signed URLs, and Nginx never exposes a storage directory.

Review cadence: weekly during the pilot and before every production release. Remove this exception when an upstream compatible release clears the chain. CI fails on any high or critical advisory.

## Development-only emulator chain

Installing `firebase-tools@15.24.0` adds five moderate findings in the local/CI-only dependency graph (`firebase-tools`, `@google-cloud/pubsub`, `@opentelemetry/core`, `@modelcontextprotocol/sdk`, and `@hono/node-server`). These packages are excluded from the production image by the Docker build and are only used to execute Firebase emulators. The same high/critical CI gate applies.
