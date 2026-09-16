# Golf Strokes Gained

A mobile-friendly React/TypeScript app for entering golf rounds and shot
positions, calculating strokes gained against a provisional benchmark, and
comparing completed rounds with prior performance. Round setup, reusable course
and tee templates, wrapped starting-hole order, historical round snapshots, and
all existing localStorage data remain supported.

When hosted on Azure Static Web Apps, the app adds private cross-device sync:

- Static Web Apps built-in Microsoft authentication through
  `/.auth/login/aad`, `/.auth/me`, and `/.auth/logout`.
- Azure Functions v4 Node/TypeScript API under `api/`.
- Cosmos DB serverless SQL API with one document per authenticated owner and
  partition key `/ownerId`.
- Revision-based optimistic concurrency. Conflicts are shown in the UI and are
  never silently overwritten.

The API derives `ownerId` only from the trusted `x-ms-client-principal` header.
It normalizes the principal's `userDetails` and requires an exact match with the
`ALLOWED_USER_EMAIL` application setting.

## Prerequisites

- Node.js 20 or newer and npm.
- For Azure deployment: Azure CLI with Bicep support, access to subscription
  `df94a33e-9b22-41f5-aa9b-1294be285b37`, and permission to create resources in
  resource group `StrokesGained`.
- For GitHub deployment: repository administration access to
  `jkid0404/StrokesGained`.

## Run locally

The Vite server remains fully usable in local-only mode. If `/.auth/me` is not
available, sign-in is not required and the existing localStorage keys continue
to be used.

```powershell
npm install
npm run dev
```

The API has a separate package:

```powershell
npm install --prefix api
npm run build --prefix api
npm test --prefix api
```

For end-to-end local emulation of Static Web Apps auth, install and configure
the Azure Static Web Apps CLI separately. Never place real Cosmos credentials
in tracked files.

## Data migration and synchronization

Existing rounds, courses, and deleted-course keys remain in localStorage. On
the first authenticated synchronization:

1. If no Cosmos owner document exists and local data is non-empty, local data is
   uploaded.
2. If an owner document already exists, cloud data wins and is cached locally.
   This includes an intentionally empty cloud document.
3. Later local changes are debounced and autosaved.
4. Offline or failed saves leave local data intact. Revision conflicts show an
   explicit **Reload cloud data** action.

The cloud document contains `rounds`, `courses`, `deletedCourseKeys`,
`revision`, `updatedAt`, and the server-derived `ownerId`.

## Azure deployment

`infra/main.bicep` creates a serverless Cosmos DB account/database/container and
an Azure Static Web App in `westus2`. Globally unique names are generated from a
lowercase prefix. No credentials are emitted as deployment outputs.

After `az login`, run:

```powershell
.\infra\deploy.ps1 -AllowedUserEmail 'you@example.com'
```

`AllowedUserEmail` is mandatory and is neither committed nor hardcoded. The
script selects the required subscription, creates `StrokesGained` if needed,
and deploys Bicep. Bicep configures these Static Web Apps application settings
without returning the Cosmos credential to the caller:

- `COSMOS_CONNECTION_STRING`
- `COSMOS_DATABASE_NAME`
- `COSMOS_CONTAINER_NAME`
- `ALLOWED_USER_EMAIL`

The script then prints the command for retrieving the Static Web Apps deployment
token. The client SPA stays anonymously loadable so React can present a sign-in
screen. The API validates the trusted Static Web Apps principal header and
enforces the single-user email allowlist itself. This avoids a duplicate route
role gate that can reject valid personal Microsoft identities before the
function receives them.

Provisioned Azure resources:

- Resource group: `StrokesGained`
- Static Web App: `golfsgjkid-whrbxmw3qdbc6`
- URL: `https://blue-coast-04c2a1b1e.3.azurestaticapps.net`
- Cosmos DB account: `golfsgjkidwhrbxmw3qdbc6`

The initial allowlisted identity is `jasowang@umich.edu`. Change
`ALLOWED_USER_EMAIL` in the Static Web App settings if the Microsoft account
used at sign-in has a different email.

## GitHub deployment

The workflow `.github/workflows/azure-static-web-apps.yml` expects the repository
secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. It contains no embedded Azure or
Cosmos credentials. Build locations are:

- app location: `/`
- frontend output: `dist`
- API location: `api`
- frontend build: `npm run build`
- API build: `npm run build`

## Validation

```powershell
npm test
npm run lint
npm run build
npm test --prefix api
npm run build --prefix api
```

## Benchmark limitations

The prototype uses a provisional synthetic curve anchored to the Broadie excerpts
selected during planning:

- Documented off-green anchors at 20, 100, and 400 yards, where available.
- Documented putting anchors at 8 and 33 feet.
- Synthetic short-game, putting, and long-shot anchors for normal app coverage.
- Off-green coverage from 1-700 yards.
- Putting coverage from 1-120 feet.
- Linear interpolation is allowed only between adjacent anchors.
- Inputs outside those ranges are rejected rather than extrapolated.

Synthetic points are engineering estimates, not PGA Tour values. This is not the
complete Broadie table and is not the current official PGA Tour baseline. Replace
it with a licensed, versioned benchmark before production use.
