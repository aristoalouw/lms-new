# Dependency security exceptions

Last reviewed: 2026-07-27

## Production dependency chain

`npm audit` currently reports one root high-severity advisory,
`GHSA-mh99-v99m-4gvg`, in transitive `brace-expansion` versions. npm expands
that single advisory through the Nuxt/Nitro archive path, Webpack tooling,
Firebase CLI, and Vue test utilities, so the package count is larger than the
number of root advisories. No compatible Nuxt 3/Webpack or Firebase CLI update
removes every affected path; npm proposes breaking downgrades or a Nuxt 4
migration.

The application never accepts a user-controlled glob expression. Builds and
emulator commands operate only on trusted repository paths, uploads use random
server-owned object paths, and production starts prebuilt Nitro output rather
than invoking archive/glob tooling. The advisory is allowlisted by exact GHSA
ID in `config/dependency-audit-allowlist.json` until 2026-08-17. A new
high/critical advisory, a severity change, or expiry still fails CI.

The production dependency graph also reports moderate transitive findings in
`firebase-admin` / `@google-cloud/storage`, including `retry-request`,
`teeny-request`, `gaxios`, and `uuid`.

The registry-proposed remediation is a breaking downgrade to `firebase-admin@10.3.0`, so it is not applied. `npm audit fix --force` is prohibited. Runtime exposure is reduced because application code does not call UUID v3/v5/v6 with caller-provided output buffers, uploads use server-generated object paths, downloads require current authorization and short-lived signed URLs, and Nginx never exposes a storage directory.

Review cadence: weekly during the pilot and before every production release.
Remove the exception when compatible upstream releases clear the chain.
`scripts/dependency-audit.mjs` executes npm's audit and rejects every
high/critical advisory not explicitly recorded by ID and expiry.

## Development-only emulator chain

Installing `firebase-tools@15.24.0` adds moderate findings in the local/CI-only
dependency graph (`firebase-tools`, `@google-cloud/pubsub`,
`@opentelemetry/core`, `@modelcontextprotocol/sdk`, and
`@hono/node-server`). These packages are excluded from the production image
and are used only to execute Firebase emulators. The same advisory-ID gate
applies.
