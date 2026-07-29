# Hostinger Business Node.js deployment

This is the production path for Hostinger Business **Node.js Web App** hosting. It does not use the repository Nginx container, Docker image, mounted TLS files, or file-mounted Application Default Credentials. The Docker + Nginx path in `infra/` remains an alternate deployment target.

The current campus account exposes this through cPanel **Setup Node.js App**.
The approved application URL is only `lms.sttsaintpaul.ac.id/`, with application
root `/home/u8756881/public_html/lms.sttsaintpaul.ac.id`. Do not edit, stop,
restart, or reuse the separate `artsysto.space` application.

Hostinger currently supports server-side Nuxt applications and Node.js 22. The platform builds and runs the app behind its managed proxy/TLS layer. See Hostinger's [Node.js Web App guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) and [redeployment guide](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/).

## Locked build contract

Use these hPanel settings:

| Setting | Value |
|---|---|
| Runtime | Node.js `22.x` |
| Framework | Nuxt.js; choose `Other` only if detection fails |
| Project root | Repository root containing `package.json` |
| Install | Hostinger-managed dependency install |
| Build command | `npm run build` |
| Start command | `npm start` |
| Nitro entry file, if requested | `.output/server/index.mjs` |
| Output directory, if requested | `.output` |

`npm start` is deliberately exact: `node .output/server/index.mjs`. Hostinger injects `PORT`; do not set `PORT` or `NITRO_PORT`. Set `NITRO_HOST=0.0.0.0`.

On cPanel, set the application startup file to `.output/server/index.mjs` when
the selector accepts nested paths. If the selector only accepts a root file,
use a reviewed ESM launcher; do not improvise a CommonJS wrapper during a live
deployment.

## Prepare environment variables

1. Copy `config/hostinger.env.example` to an ignored local file such as `.env.hostinger.production`.
2. Fill the staging or production values on a trusted operator workstation. Use different Firebase projects, secrets, and Sentry environments.
3. Encode the least-privilege Firebase runtime service-account JSON as one base64 value. Do not upload the JSON file to Hostinger and do not use `GOOGLE_APPLICATION_CREDENTIALS`.
4. Validate without printing secrets:

```powershell
pwsh -NoProfile -File scripts/validate-env.ps1 -Path .env.hostinger.production
```

5. Import the validated file through hPanel Environment Variables. Confirm that every value is present and not truncated, then delete the local populated file through the institution's secure disposal process.

On Windows, this copies the base64 credential to the clipboard without writing it to the console:

```powershell
$credentialBytes = [System.IO.File]::ReadAllBytes('C:\secure\firebase-runtime.json')
[Convert]::ToBase64String($credentialBytes) | Set-Clipboard
Remove-Variable credentialBytes
```

Clear the clipboard after saving the value in hPanel. Never put the base64 string in Git, a ticket, chat, deployment log, build argument, or client-side `NUXT_PUBLIC_*` variable.

The validator enforces the Hostinger-specific contract:

- `DEPLOYMENT_TARGET=hostinger`, production mode, immutable release ID, approved `full-campus` profile, and demo/mock disabled;
- `FIREBASE_USE_APPLICATION_DEFAULT=false` with exactly one `FIREBASE_SERVICE_ACCOUNT_BASE64`;
- explicit capability switches for uploads, email delivery, and Sentry;
- no Docker image, TLS file, ADC file, or Google credential path requirement;
- Firebase project/bucket consistency, independent random secrets, Firestore rate limiting, Sentry release matching, and no emulator.

Pada target Hostinger, Firebase Admin menggunakan transport Firestore REST
(`preferRest`) agar read, write, dan transaction tidak bergantung pada koneksi
gRPC/HTTP2 yang dapat tertahan oleh runtime managed hosting. Endpoint sesi
memiliki timeout upstream terbatas; browser memberi ruang untuk cold start
Hostinger tetapi tetap menampilkan kegagalan yang jelas bila batas itu lewat.

For an initial Firebase Spark pilot, set `FILE_UPLOADS_ENABLED=false`,
`EMAIL_DELIVERY_ENABLED=false`, and `SENTRY_ENABLED=false`. Keep the related
bucket, ClamAV, email gateway, and Sentry values blank. The full-campus
application remains available with Firebase Auth and Firestore; capabilities
that require Storage, email delivery, payment gateway, or the institution's
PDDIKTI adapter must report themselves as unconfigured and must not fabricate
successful data. Account recovery uses Firebase Authentication's native reset
email at no extra service cost. Do not use placeholder bucket names or
credentials. The production validator accepts blank payment, tracer, and
PDDIKTI integration values for this pilot, but validates the complete bundle as
soon as any payment or PDDIKTI integration value is supplied.

Spark does not include Firestore TTL deletion. Prepare and deploy the
Spark-safe index contract, which preserves every composite index and indexing
exemption but omits the six TTL policy flags:

```powershell
npm run firebase:prepare:spark
firebase deploy --config .firebase-spark/firebase.json --project <firebase-project-id> --only firestore:rules,firestore:indexes
```

Application expiry checks remain synchronous, so expired challenges, sessions,
rate-limit buckets, and idempotency records cannot be used even though Spark
does not delete them automatically. Upgrade to the standard
`firebase/firebase.json` contract only after billing is explicitly approved.

## Bootstrap the first administrator

The first production identity is created out of band because no administrator
exists yet. Run this only from authenticated Cloud Shell with project-owner
approval:

```bash
npm run bootstrap:lms-admin -- \
  --project=sttsp-lms-staging \
  --confirm-project=sttsp-lms-staging \
  --email=<approved-admin-email> \
  --display-name="<administrator-name>"
```

The command does not create or print a password. It writes the canonical
account/profile, minimal custom claims, and an audit entry, then enables the
identity. The administrator activates access through **Lupa kata sandi** on
the LMS login page, which uses Firebase Authentication's native email.

## External dependencies to resolve before deployment

Hostinger does not provide these application services:

- a least-privilege Firebase runtime service account and Firebase web configuration;
- an HTTPS transactional email gateway plus independent delivery and worker secrets;
- a reachable ClamAV-compatible scanning service for private uploads;
- client/server Sentry DSNs and an approved release/environment;
- an approved scheduler for the secret-protected email outbox worker.

Do not enable a paid provider or transmit credentials until explicitly approved. If outbound TCP access to the selected ClamAV service cannot be verified from the managed Web App, private uploads are a production blocker.

## Staging deployment and smoke checks

Production deployment requires explicit approval. First deploy a staging domain and project:

1. In hPanel, add a new **Node.js Web App**, connect the approved repository/branch, select Node.js 22, and apply the locked build settings.
2. Import the staging environment variables.
3. Review the build log. It must show a successful Nuxt build and must not contain environment values.
4. Confirm `GET /api/health` returns `200` and `GET /api/ready` returns `200`.
5. Confirm an anonymous private API returns `401`, each role receives only its scoped modules, and login/session flows use Secure, HttpOnly, SameSite cookies.
6. Run the HTTPS smoke suite from an operator workstation:

```powershell
pwsh -NoProfile -File scripts/smoke-production.ps1 -BaseUrl https://staging.example.ac.id
```

7. Confirm responses contain CSP, HSTS, frame/content-type/referrer/permissions policies, private cache controls, and an application-generated `X-Request-ID`.
8. Complete the documented role, upload/scan, email-worker, Sentry, backup, and isolated restore checks before production approval.

The application never trusts a client-provided request ID on Hostinger. It generates one per request, reuses it for audit/Sentry correlation, and returns it as `X-Request-ID`. `TRUSTED_PROXY_HOPS=1` is the reviewed default for the managed edge; change it only after Hostinger documents a different proxy chain and staging authorization/rate-limit tests pass.

## Domain, operation, and rollback

- Connect the custom domain and managed SSL in hPanel. Do not attempt to install the repository Nginx configuration on managed Web App hosting.
- If the domain is already attached to another Hostinger website, treat removal/reassignment as destructive: back it up and obtain explicit approval first.
- Environment changes require a controlled redeploy/restart and a repeat of health/readiness and security-header smoke checks.
- Use hPanel deployment/runtime logs and `X-Request-ID` for diagnosis; never log request bodies, tokens, credentials, student data, grades, or file contents.
- For rollback, redeploy the last approved immutable commit and matching environment/release values, then repeat smoke tests. Do not delete the Hostinger website as a rollback mechanism.
- Firebase/Storage backup and restore remain independent of Hostinger application deployments.
