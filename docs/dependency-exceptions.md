# Dependency security exceptions

Last reviewed: 2026-08-01

## Production dependency chain

`npm audit fix` tanpa `--force` memperbarui transitive `brace-expansion`,
`@modelcontextprotocol/sdk`, dan `@hono/node-server` pada lockfile. Advisory high
`GHSA-mh99-v99m-4gvg` tidak lagi ada. Allowlist high/critical sekarang kosong;
temuan high/critical baru langsung menggagalkan CI.

Production dependency graph masih melaporkan enam moderate transitive findings di
`firebase-admin` / `@google-cloud/storage`, including `retry-request`,
`teeny-request`, `gaxios`, and `uuid`.

The registry-proposed remediation is a breaking downgrade to `firebase-admin@10.3.0`, so it is not applied. `npm audit fix --force` is prohibited. Runtime exposure is reduced because application code does not call UUID v3/v5/v6 with caller-provided output buffers, uploads use server-generated object paths, downloads require current authorization and short-lived signed URLs, and Nginx never exposes a storage directory.

Review cadence: weekly during the pilot and before every production release.
Remove the exception when compatible upstream releases clear the chain.
`scripts/dependency-audit.mjs` executes npm's audit and rejects every
high/critical advisory not explicitly recorded by ID and expiry.

## Development-only emulator chain

Installing `firebase-tools@15.24.0` membuat total audit penuh menjadi sembilan
moderate, termasuk jalur local/CI-only `firebase-tools`,
`@google-cloud/pubsub`, dan `@opentelemetry/core`. Paket tersebut tidak masuk
production image dan hanya dipakai untuk Firebase emulator/deploy tooling.
