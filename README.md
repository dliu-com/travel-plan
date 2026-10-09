# travel-plan — DL Travel Plan

Private travel plans at **https://plan.dliu.com**, written like a blog: one travel plan is one post with its dates, destination, who's going, a description, attachments and events grouped by day. Click any of those details on the page to edit it in place. (In the code and API a travel plan is a "trip".)

- **Private by default.** Visitors to plan.dliu.com don't see any trips. People in the dliu.com Microsoft 365 org sign in (Entra ID) and can read and edit every trip.
- **Trip addresses** are `https://plan.dliu.com/plan/YYYYMMNN`: the year and month the trip was created, then a two-digit counter for that month (`20261000`, `20261001`, …).
- **Share links** are `https://plan.dliu.com/plan/<id>?token=<token>`. Anyone holding one can view **and edit** that one trip (details, events, files) without signing in. They can't see other trips, delete the trip or manage sharing. *Stop sharing* turns the link off immediately. *New link* replaces it, and the old link stops working. Edits made through a link are recorded as "someone with the link". Old `/s/<token>` and `/trips/<id>` addresses redirect.
- **Attachments.** Up to 200 files per trip and 50 MB each, attached to the trip itself (drag and drop onto the Files section, or 📎); events have no attachments of their own. Files go straight from the browser to a private S3 bucket using short-lived presigned URLs. Images, PDFs, text, audio and video open in the browser. Everything else, including HTML and SVG, always downloads as `application/octet-stream`.

```
browser ──▶ CloudFront ──▶ S3 (web/: index.html, app.js, style.css)
   │            │  viewer-request: /plan/*, /trips/*, /s/*, /about, /security → /index.html
   │            ├─ api/*, auth/* ──OAC──▶ Lambda function URL (lambda/api) ──▶ DynamoDB "Trips" (+ GSI byShareToken)
   │            │                                                        ├──▶ SSM /travel-plan/* (Entra settings)
   │            │                                                        └──▶ S3 files bucket (presigns URLs)
   │            └─ logs ──▶ TrafficMonitor bucket raw/plan/
   └── presigned PUT/GET ──▶ S3 files bucket (private; pending/ expires after 1 day, trips/<id>/<file>)
```

| Path | Who | What |
| --- | --- | --- |
| `/` | signed in | trip index plus "New trip"; signed-out visitors only see a sign-in card |
| `/plan/<id>` | signed in | the post with editing, events, files and the share panel |
| `/about`, `/security` | anyone | how the site works and what it costs; threat model and penetration-test results |
| `/plan/<id>?token=<token>` | anyone with the link | the same post, editable, without the share panel or trip deletion |
| `/api/trips` (GET, POST) | signed in | list and create trips |
| `/api/trips/<id>` and `/events…` | signed in or that trip's token (`x-plan-token` header or `?token=`) | read and edit the trip and its events |
| `/api/trips/<id>/files…` | signed in or that trip's token | `POST` starts an upload (returns a presigned PUT), `PUT /files/<fid>` confirms or renames it, `GET` redirects to a presigned download, `DELETE` removes it |
| `DELETE /api/trips/<id>`, `POST/DELETE /api/trips/<id>/share` | signed in | delete the trip, turn the share link on or off |
| `/api/shared/<token>` | anyone | `{id}` for old `/s/<token>` links |
| `/auth/login`, `/auth/callback`, `/auth/logout` | | Entra OIDC (PKCE) with a signed 30-day session cookie |

Note: CloudFront access logs record full URLs, so share tokens in `?token=` appear in the TrafficMonitor logs. The app itself sends the token in a header.

Hardening: strict CSP (`script-src 'self'; style-src 'self'`, no inline code), HSTS, `X-Frame-Options: DENY`, `Permissions-Policy` that turns off camera, microphone, location, payment and USB, attachment names stripped of control and bidi characters, and the API Lambda capped at 20 concurrent runs so a flood can't run up costs. Details are on `/security`.

Data: one DynamoDB item per trip. Events live in a map keyed by event id, so two people editing different events never overwrite each other. Writes must come from the site's own origin and be `application/json`.

## Deploy

```bash
make install
make test
make deploy        # stack "TravelPlan" in eu-west-1; needs the exports MainDomain / MainHostedZoneId
make outputs
```

Traffic logging needs the TrafficMonitor stack exports (`TrafficLogBucketName`, `TrafficVisitorFunctionArn`). Deploy without it using `npx cdk deploy -c trafficLogging=false`. For the logs to be queryable, `traffic-monitor/config/sites.json` needs the `plan` site and a redeploy of TrafficMonitor.

## Microsoft 365 / Entra sign-in

At https://entra.microsoft.com:

1. **App registrations → travel-plan**: single tenant, redirect URI platform **Web** = `https://plan.dliu.com/auth/callback`.
2. **Certificates & secrets → New client secret**: copy the **Value**.
3. **Enterprise applications → travel-plan**: set *Assignment required = Yes* and assign the people who may sign in. Global Administrators skip this check. Accounts must also be `@dliu.com`.
4. Store the settings in SSM Parameter Store under `/travel-plan/`. The script prompts for the tenant ID, the client ID and the secret (SecureString):

   ```bash
   make set-secrets
   ```

Settings are cached for 5 minutes by the Lambda. Until they exist, sign-in shows "not configured".

## Local preview

```bash
make dev           # http://localhost:8787
```

This runs the real API handler against an in-memory store with sample trips. *Sign in* logs you in as a fake dev user without Microsoft.
