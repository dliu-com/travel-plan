# travel-plan — DL Travel Plan

Private travel plans at **https://plan.dliu.com**, written like a blog: one travel plan is one post with its dates, destination, who's going, a description, attachments and events grouped by day. Click any of those details on the page to edit it in place. (In the code and API a travel plan is a "trip".)

- **Private by default.** Visitors to plan.dliu.com don't see any trips. People in the dliu.com Microsoft 365 org sign in (Entra ID) and can read and edit every trip.
- **Trip addresses** are `https://plan.dliu.com/plan/YYYYMMNN`: the year and month the trip was created, then a two-digit counter for that month (`20261000`, `20261001`, …).
- **Share links** are `https://plan.dliu.com/plan/<id>?token=<token>`. Anyone holding one can view **and edit** that one trip (details, events, files) without signing in. They can't see other trips, delete the trip or manage sharing. Every plan has its link from creation (plans made before that get one the first time a member opens the list or the plan): the Sharing row has *Share* (opens the device's share sheet, or copies the link), *Copy link* and *Download PDF*, and says until when the link works. A link works for **3 months** from when it was made (`shareExpiresAt`); after that it stops working, the API stops returning it, and signed-in members get a *Create link* button instead. Members can also *Reset link* at any time, which makes a new link for 3 months and stops the old one at once (`POST /api/trips/<id>/share`, members on this site only; the managed API has no such route). Links made before links expired get their 3 months the next time a member opens the plan or the list. Edits made through a link are recorded as "someone with the link". Tokens are 144 random bits from `crypto.randomBytes`, so they can't be guessed, even with this code. In case one leaks, each trip gives link holders a daily allowance (UTC day): 5,000 requests, 1,000 changes, 50 uploads totalling 500 MB, 10 GB of downloads and 50 PDFs (`lambda/api/limits.js`, counted in a small DynamoDB "Limits" table whose rows expire). Beyond it they get 429; signed-in members are never limited. Old `/s/<token>` and `/trips/<id>` addresses redirect.
- **Attachments.** Up to 200 files per trip, 50 MB each and 1 GB in total, attached to the trip itself (drag and drop onto the Files section, or 📎); events have no attachments of their own. Files go straight from the browser to a private S3 bucket using short-lived presigned URLs. Images, PDFs, text, audio and video open in the browser. Everything else, including HTML and SVG, always downloads as `application/octet-stream`.
- **Agenda or calendar.** The agenda (default) lists events by day. The calendar is an Outlook-style week: day columns over a 24-hour timeline, overlapping events side by side, untimed events in an "All day / time TBD" row. Click an empty slot to add an event at that half hour; click an event for its details. Events can have an optional end time (same day); without one they show as a 30-minute block. The browser remembers the chosen view. Times are the plan's local clock times, never converted to the viewer's time zone. Lane layout is in `web/calendar.js`.
- **Download PDF.** In the Sharing row (share-link guests get it too). A separate Lambda (`lambda/pdf`) lays the plan out with [pdfkit](https://pdfkit.org) and an embedded Noto Sans SC font (Chinese and English): A4, a header with the site name and plan title, a footer with the plan's address, export time and page numbers, every day in full with coloured status bars, and clickable links. The file is named after the plan title and dates. The button shows a spinner while the PDF is made. No browser engine and no network access are involved; the function only reads the table.

```
browser ──▶ CloudFront ──▶ S3 (web/: index.html, app.js, calendar.js, style.css)
   │            │  viewer-request: /plan/*, /trips/*, /s/*, /docs, /docs/cost, /docs/security → /index.html;
   │            │                  /docs/api → /docs-api.html; /about, /security, /docs/health → 301 /docs, /docs/security, /docs#health
   │            ├─ health (60 s cached, no cookies/headers/query) ──OAC──▶ Lambda function URL (lambda/api)
   │            ├─ api/trips/*/pdf ──OAC──▶ Lambda function URL (lambda/pdf, read-only) ──▶ DynamoDB "Trips" (+ "Limits" for guest PDFs)
   │            ├─ api/*, auth/* ──OAC──▶ Lambda function URL (lambda/api) ──▶ DynamoDB "Trips" (+ GSI byShareToken), "Limits"
   │            │                                                        ├──▶ SSM /travel-plan/* (client ID, secret), /dliu/entra-tenant-id
   │            │                                                        └──▶ S3 files bucket (presigns URLs)
   │            └─ access logs (v2, set up by TrafficMonitor) ──▶ TrafficMonitor bucket
   └── presigned PUT/GET ──▶ S3 files bucket (private; pending/ expires after 1 day, trips/<id>/<file>)
```

| Path | Who | What |
| --- | --- | --- |
| `/` | signed in | trip index plus "New trip"; signed-out visitors only see a sign-in card |
| `/plan/<id>` | signed in | the post with editing, events, files and the share panel |
| `/docs`, `/docs/cost`, `/docs/security`, `/docs/api`, `/docs#health` | anyone | docs tabs: technical architecture, cost (including the most a flood can cost), security (threat model, findings, live penetration tests, code review), the API reference and Testing (`#health` on `/docs`: how status.dliu.com tests the site as a guest, with a diagram, one plain line per function and technical details folded). `/about`, `/security` and `/docs/health` 301 to `/docs`, `/docs/security` and `/docs#health`, keeping the query |
| `/docs/api.md`, `/docs/health.md` | anyone | the same API reference and health-check contract as plain Markdown (`text/markdown; charset=utf-8`) for agents and for implementing the tests |
| `GET /health` | anyone | health report for https://status.dliu.com (`application/health+json`, 200 pass/warn, 503 fail): one DynamoDB `GetItem`, one S3 `HeadObject` and the sign-in settings, in parallel with 2 s timeouts. CloudFront forwards no cookies, Authorization header or query string, and caches it 60 s. Code in `lambda/api/health.js` |
| `/plan/<id>?token=<token>` | anyone with the link | the same post, editable, without the share panel or trip deletion |
| `/api/trips` (GET, POST) | signed in | list and create trips |
| `/api/trips/<id>` and `/events…` | signed in or that trip's token (`x-plan-token` header or `?token=`) | read and edit the trip and its events |
| `/api/trips/<id>/files…` | signed in or that trip's token | `POST` starts an upload (returns a presigned PUT), `PUT /files/<fid>` confirms or renames it, `GET` redirects to a presigned download, `DELETE` removes it |
| `DELETE /api/trips/<id>` | signed in | delete the trip |
| `/api/shared/<token>` | anyone | `{id}` for old `/s/<token>` links |
| `/auth/login`, `/auth/callback`, `/auth/logout` | | Entra OIDC (PKCE) with a signed 30-day session cookie |

Note: CloudFront access logs record full URLs, so share tokens in `?token=` appear in the TrafficMonitor logs. The app itself sends the token in a header.

Hardening: strict CSP (`script-src 'self'`; styles only from the site and `https://files.dliu.com/dliu.com/ui/`; images also from `https://files.dliu.com/dliu.com/` for the footer DL logo; no inline code), HSTS, `X-Frame-Options: DENY`, `Permissions-Policy` that turns off camera, microphone, location, payment and USB, attachment names stripped of control and bidi characters, and the API and PDF Lambdas capped at 20 and 5 concurrent runs so a flood can't run up costs. The managed API's stage is throttled to 10 requests a second (bursts of 20) for token-bearing callers; requests without a valid token get 401 from the JWT authorizer before the throttle and never reach Lambda. Lambda logs are JSON, warnings and errors only (no per-call platform lines), kept 3 months (90 days, like every log group in the stack, including CDK's helper Lambdas), and never contain share tokens or usernames. Details are on `/docs/security`.

Security review: `scripts/pentest.sh` is a read-only, credential-free live test of every route (authn/authz, forged sessions and JWTs, share-token IDOR, injection, CRLF, CSRF/CORS, open redirects, OIDC, direct origin access, cache tricks, hidden files, TLS and headers, a 200-request tokenless burst on the managed API). Run it with `./scripts/pentest.sh`; it prints a Markdown table and exits non-zero if any check fails. The latest results, threat model (STRIDE and denial of wallet) and code review are on `/docs/security` and `/docs/cost`.

Look: the site uses the shared dliu.com look (spec: <https://files.dliu.com/dliu.com/README.md>). Both page shells (`web/index.html`, `web/docs-api.html`) load `ui/v1/dl.css`, then `ui/v1/dl-docs.css`, then `/style.css`. They use the shared `dl-header` with the app's own logo (`web/logo.svg`, a white map pin on the DL blue, also the favicon) and name as one `dl-brand` link, the `dl-nav` menu (Docs, Sign in / out, the `dl-language` switch, on every page including `/docs/api`) and the `dl-footer` (`dliu.com · Docs`), which starts with the shared DL logo linking to dliu.com. Buttons, sign-in, tabs, tables and status pills are the shared `dl-*` classes. The docs (`/docs`, `/docs/cost`, `/docs/security`, `/docs/api`, `/docs#health`) use `dl-docs` and the same five `dl-tabs` (Technical architecture · Cost · Security · API · Testing, in English and Chinese) and the shared diagram kit. `web/style.css` keeps only what belongs to the app (trip list, plan post, events and their status colours, forms, files, calendar, print), all on the shared `--dl-*` colours. The site is light-theme only and there is no shared JavaScript. `test/shared-ui.test.js` guards this.

Data: one DynamoDB item per trip. Events live in a map keyed by event id, so two people editing different events never overwrite each other. Writes must come from the site's own origin and be `application/json`.

## Deploy

```bash
make install
make test
make deploy        # stack "TravelPlan" in eu-west-1; needs the exports MainDomain / MainHostedZoneId
make outputs
```

Traffic logging needs the TrafficMonitor stack export `TrafficVisitorFunctionArn`; this stack only adds the visitor-ID function and turns on cookies in the access logs. The log delivery itself is created by TrafficMonitor, from the `plan` entry in `traffic-monitor/config/sites.json`. Deploy without it using `npx cdk deploy -c trafficLogging=false`.

## Caching and CloudFront

CloudFront serves the site from every edge location (`PriceClass_All`) over HTTP/2 and HTTP/3.

| What | Cache-Control | At the edge |
| --- | --- | --- |
| Scripts, styles, icon, `/docs/api.md`, `/docs/health.md` (site bucket; the `.md` files as `text/markdown; charset=utf-8`) | `public, max-age=300, s-maxage=86400, stale-while-revalidate=86400` | up to 1 day |
| HTML shells: `/`, `/plan/…`, `/s/…`, `/docs` (including `#health`), `/docs/cost`, `/docs/security`, `/docs/api` | `no-cache` | revalidated on every load |
| `/health` | `public, max-age=60` | 60 s (HealthCache policy, keyed on nothing) |
| `/api/*`, `/auth/*`, PDF export | `no-store`, CachingDisabled | never |
| Attachments | private bucket, reached by short-lived presigned S3 links | not behind CloudFront |

**How changes are cleared:** the site bucket is only written by `make deploy`. The three `BucketDeployment`s (static files, HTML shells, Markdown docs) invalidate `/*` after uploading, so a deploy is live everywhere within a minute or two. Browsers may keep a script or stylesheet for up to 5 minutes (then revalidate in the background), so a page might use the previous version once right after a deploy.

**No automatic (S3 event) clearing — decided deliberately.** Automatic invalidation is only worth it for edge-cached objects that can change outside a deploy, and here none can:

- Site bucket: no function, job or person writes to it outside a deploy, and every deploy already invalidates `/*`. If you ever edit a file there by hand, run `aws cloudfront create-invalidation --distribution-id <id> --paths '/<path>'` (or just redeploy).
- Files bucket (attachments): private and not served by CloudFront, so there is nothing to clear.
- Trip data lives in DynamoDB and is only read through the uncached API.

This keeps the shared allowance of 1,000 free invalidation paths a month (used by all dliu.com sites) for sites that need it: this one uses three `/*` paths per deploy (one per upload) and nothing otherwise. Revisit the decision if CloudFront ever serves a bucket or prefix that the app or a job writes to.

## Microsoft 365 / Entra sign-in

At https://entra.microsoft.com:

1. **App registrations → travel-plan**: single tenant, redirect URI platform **Web** = `https://plan.dliu.com/auth/callback`.
2. **Certificates & secrets → New client secret**: copy the **Value**.
3. **Enterprise applications → travel-plan**: set *Assignment required = Yes* and assign the people who may sign in. Global Administrators skip this check. Accounts must also be `@dliu.com`.
4. Store the settings in SSM Parameter Store under `/travel-plan/`. The script prompts for the client ID and the secret (SecureString). The tenant ID is shared by every dliu.com app and read from `/dliu/entra-tenant-id` (owned by the [dliu-com/audit](https://github.com/dliu-com/audit) stack), so deploy that first:

   ```bash
   make set-secrets
   ```

Settings are cached for 5 minutes by the Lambda. Until they exist, sign-in shows "not configured".

## Managed API (Microsoft access tokens)

Trusted tools and AI agents can use a separate API Gateway HTTP API with Microsoft-issued access tokens from https://auth.dliu.com (the shared dliu API and its SPA client). Agents need only the token and https://plan.dliu.com/docs/api; the full route table, schemas and errors are there (`web/docs/api.md`, with the execute-api URL filled in at deploy).

- **Routes and scopes** (`lambda/api/routes.json`): 14 routes. Reads need `trip.read`, creates and edits need `trip.write`, and every DELETE (plans, events, attachments) needs `trip.delete`. `/api/shared/*` and `/auth/*` are not published. Reading a plan returns its share link as `shareUrl` (never the bare `shareToken`; `null` once it has expired) with `shareExpiresAt`, and the docs tell agents to open it in a browser only to look at the plan, and to treat it as a credential.
- **Who**: API Gateway checks the signature, tenant v2 issuer, audience, expiry and route scope. `lambda/api/api-access.js` then requires the trusted gateway, tenant, audience, the approved client (`azp`), `oid`/`sub`, the shared User-only role **dliu API user** (token value `api.access` ; the same role for every dliu.com managed API, and the old `trip.access` is refused) and the exact scope. Mutable claims such as `preferred_username` or email are never used for authorization. Only explicitly assigned users can use the API; other members keep website and share-link access but get no API rights from signing in. An assigned user can read and change every travel plan, like a signed-in member.
- **Files**: `GET …/files/<fid>` returns `{url, expiresIn, file}` instead of a redirect, so the bearer token is never sent to S3. Uploads PUT straight to the presigned URL, also without the token.
- **Website**: sign-in, the `@dliu.com` rule, cookies and share links are unchanged. The website's `/api/*` doesn't accept bearer tokens.
- **Client**: `TRIP_API_URL=<MicrosoftApiUrl> node scripts/api-client.js GET /api/trips` (also `upload`, `download`, `pdf`). It reads the token as the Auth API docs describe and never follows redirects or prints presigned URLs.

To enable it, the shared scopes and role are configured centrally. Then:

1. The shared settings come from the dliu-com/audit stack's SSM parameters (eu-west-1), resolved at deploy time: `/dliu/entra-tenant-id` (issuer and `tid`) and `/dliu/api-app-id` (the shared dliu API app: audience and `azp`). This app keeps no copies.
2. Set `"microsoftApi": true` in `cdk.json`, so later default deploys keep the API. (`-c microsoftApi=true` only lasts for one deploy.)
3. `make deploy`, then `make outputs` shows `MicrosoftApiUrl`.

## Local preview

```bash
make dev           # http://localhost:8787
```

This runs the real API handler against an in-memory store with sample trips. *Sign in* logs you in as a fake dev user without Microsoft.
