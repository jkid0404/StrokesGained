# Golf Strokes Gained

A mobile-friendly React/TypeScript app for entering golf rounds and shot
positions, calculating strokes gained against an approximate PGA Tour benchmark, and
comparing completed rounds with prior performance. Round setup, reusable course
and tee templates, wrapped starting-hole order, historical round snapshots, and
all existing localStorage data remain supported. The Trends page uses one
in-chart metric selector for strokes-gained and traditional-stat charts across
the last 5, 10, or 20 matching rounds. Course, tee, date, and round-length
filters apply to all Trends analytics. Shots can optionally record a club and
short note, and the
filtered Trends view summarizes club usage, starting distance, average SG per
shot, total SG, and strokes gained across every category. Club analytics follow
bag order rather than sample size,
with separate distance bands for Putter (`0–6`, `7–15`, `16–30`, and `31+`
feet) and 58 wedge shots. The Manage My Bag page lets users add, rename, and
delete the club presets used by shot entry without rewriting historical shot
records.
Round results and filtered Trends also include traditional statistics such as
fairways, greens in regulation, putting, scrambling, up-and-downs, estimated
greenside sand saves, approach proximity, penalties, scoring distribution, and
scoring averages by par. Saved courses provide course-wide and hole-by-hole
insights, including strokes gained by category and recurring trouble
holes. Completed rounds pass through a final scorecard review, and individual
shots can be edited without discarding the later shot history.

When hosted on Azure Static Web Apps, the app adds private cross-device sync:

- Static Web Apps built-in Microsoft authentication through
  `/.auth/login/aad`, `/.auth/me`, and `/.auth/logout`.
- Azure Functions v4 Node/TypeScript API under `api/`.
- Cosmos DB serverless SQL API with one document per authenticated owner and
  partition key `/ownerId`.
- Static Web Apps invitation roles (`golfer` and `admin`) for Microsoft-account
  access. The configured bootstrap administrator can manage the app before
  accepting the formal role invitation.
- A separate shared Cosmos course catalog. All invited golfers can read shared
  scorecards, while only administrators can change them. Rounds, shots, trends,
  and course insights remain private to each owner.
- A moderated course-publication queue. Golfers can submit personal courses or
  suggest edits to shared scorecards; administrators review the course diff
  before approval changes the shared catalog.
- Revision-based optimistic concurrency. Conflicts are shown in the UI and are
  never silently overwritten.

The API derives `ownerId` only from the trusted `x-ms-client-principal` header.
It accepts only Microsoft identities with the `golfer` or `admin` role. The
`ADMIN_USER_EMAIL` application setting bootstraps the first administrator.

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

Production builds include an installable Progressive Web App manifest and a
versioned service worker. After one successful online load, the application
shell can be reopened offline while rounds continue to save locally. Azure API
and authentication responses are never cached. When a new deployment is ready,
the app prompts before reloading into the new version.

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

Authenticated browser data is namespaced by the Static Web Apps `userId`, so
accounts using the same browser profile never share local rounds, clubs, or
sync metadata. Existing unscoped data is migrated only when its saved owner ID
matches the authenticated account. On the first authenticated synchronization:

1. If no Cosmos owner document exists and local data is non-empty, local data is
   uploaded.
2. If an owner document already exists, cloud data wins and is cached locally.
   This includes an intentionally empty cloud document.
3. Later local changes are debounced and autosaved.
4. Offline or failed saves leave local data intact. Revision conflicts show an
   explicit **Reload cloud data** action.

The private cloud document contains `rounds`, personal `courses`,
`deletedCourseKeys`,
`revision`, `updatedAt`, and the server-derived `ownerId`.

Shared course definitions are stored separately in the `courses` Cosmos
container. The shared catalog is cached per account for offline use and uses its
own revision-based conflict protection. Personal course templates remain
available for ad-hoc rounds; matching shared definitions take precedence.

Course submissions are stored in the `courseProposals` container partitioned by
the server-derived proposer ID. Golfers can list and withdraw their own pending
submissions. Administrators can review all submissions, approve them into the
shared catalog, reject them, or request changes. Approval verifies that the
target shared course has not changed since the proposal was submitted.

## Azure deployment

`infra/main.bicep` creates a serverless Cosmos DB account/database/container and
an Azure Static Web App in `westus2`. Globally unique names are generated from a
lowercase prefix. No credentials are emitted as deployment outputs.

After `az login`, run:

```powershell
.\infra\deploy.ps1 -AdminUserEmail 'you@example.com'
```

`AdminUserEmail` is mandatory and is neither committed nor hardcoded. The
script selects the required subscription, creates `StrokesGained` if needed,
and deploys Bicep. Bicep configures these Static Web Apps application settings
without returning the Cosmos credential to the caller:

- `COSMOS_CONNECTION_STRING`
- `COSMOS_DATABASE_NAME`
- `COSMOS_CONTAINER_NAME`
- `COSMOS_COURSES_CONTAINER_NAME`
- `COSMOS_PROPOSALS_CONTAINER_NAME`
- `ADMIN_USER_EMAIL`

The script then prints the command for retrieving the Static Web Apps deployment
token. The client SPA stays anonymously loadable so React can present a sign-in
screen. API routes require an authenticated Static Web Apps session, and each
function validates the trusted principal plus the application role itself.

Provisioned Azure resources:

- Resource group: `StrokesGained`
- Static Web App: `golfsgjkid-whrbxmw3qdbc6`
- URL: `https://blue-coast-04c2a1b1e.3.azurestaticapps.net`
- Cosmos DB account: `golfsgjkidwhrbxmw3qdbc6`

The bootstrap administrator is `jasowang@umich.edu`. Additional golfers are
added through Static Web Apps Role Management with the `golfer` role; course
editors receive both `golfer` and `admin`.

Example invitation:

```powershell
az staticwebapp users invite `
  --name golfsgjkid-whrbxmw3qdbc6 `
  --resource-group StrokesGained `
  --authentication-provider AAD `
  --user-details golfer@example.com `
  --roles golfer `
  --domain blue-coast-04c2a1b1e.3.azurestaticapps.net `
  --invitation-expiration-in-hours 168
```

Azure generates an invitation URL for the administrator to send to the user.
Removing the `golfer` role revokes app access without deleting private round
data.

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

## Benchmark source and limitations

The active benchmark is version `kaggle-evancallaghan-v1-2023` and uses the CSV
files from Evan Callaghan's Kaggle dataset, [PGA Tour Strokes Gained Baseline
Values](https://www.kaggle.com/datasets/evancallaghan/pga-tour-strokes-gained-baseline-values).

- Tee coverage: 100-600 yards.
- Fairway, rough, and sand coverage: 3-600 yards.
- Putting coverage: 1-90 feet.
- Decimal distances use linear interpolation between adjacent CSV rows.
- Recovery shots are unsupported because the Kaggle data has no recovery
  column.
- Inputs outside the source ranges are rejected rather than extrapolated.

The dataset author says values were aggregated from Mark Broadie's *Every Shot
Counts* (2014), completed using cubic-spline interpolation and short-distance
extrapolation, rounded to two decimals, and are approximate. Kaggle identifies
the license as **Other (specified in description)** without a standard license
identifier. See `src/data/README.md` for retained provenance.
