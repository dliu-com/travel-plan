# travel-plan

Private trip plans at **https://plan.dliu.com**, written like a blog: one trip is one post, made of events grouped by day.

- **Private by default.** Visitors to plan.dliu.com don't see any trips. People in the dliu.com Microsoft 365 org sign in (Entra ID) and can read and edit every trip.
- **Share links.** Any trip can get a link `https://plan.dliu.com/s/<token>`. Friends open it read-only without signing in. *Stop sharing* turns the link off immediately. *New link* replaces it, and the old link stops working.
- **Shared view hides** the trip id, the token and who last edited it.

```
browser ──▶ CloudFront ──▶ S3 (web/: index.html, app.js, style.css)
                │  viewer-request: /trips/* and /s/* → /index.html
                ├─ api/*, auth/* ──OAC──▶ Lambda function URL (lambda/api) ──▶ DynamoDB "Trips" (+ GSI byShareToken)
                │                                                        └──▶ SSM /travel-plan/* (Entra settings)
                └─ logs ──▶ TrafficMonitor bucket raw/plan/
```

| Path | Who | What |
| --- | --- | --- |
| `/` | signed in | trip index plus "New trip"; signed-out visitors only see a sign-in card |
| `/trips/<id>` | signed in | the post with editing, events and the share panel |
| `/s/<token>` | anyone with the link | read-only post |
| `/api/trips…` | signed in | trips/events CRUD, `POST/DELETE /api/trips/<id>/share` |
| `/api/shared/<token>` | anyone | the shared trip |
| `/auth/login`, `/auth/callback`, `/auth/logout` | | Entra OIDC (PKCE) with a signed 30-day session cookie |

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
