# plan.dliu.com health checks

How [status.dliu.com](https://status.dliu.com) tests https://plan.dliu.com as an anonymous guest, following the dliu.com
health contract (dliu-com/status `HEALTH.md`). The people's version, with a diagram, is
https://plan.dliu.com/docs/health. This file has every technical detail and is enough on its own to implement the tests.

plan.dliu.com (DL Travel Plan) is a private trip planner. Guests see only the start page and the docs; travel plans
need a Microsoft sign-in or a plan's share link. The checks below prove the public parts work and that the private parts
stay closed, without signing in, without a share link and without revealing anything about any travel plan.

## Functions

| Key | Name | What it does | Critical |
| --- | --- | --- | --- |
| `pages` | Pages | The app (`/`) and the docs pages, served by CloudFront from S3. | yes |
| `docs` | Docs | The Markdown docs for agents (`/docs/api.md`, this file). | no |
| `signin` | Microsoft sign-in | `/auth/login` sends people to Microsoft; the API knows who is signed in; the Lambda can read its sign-in settings. | yes |
| `private` | Privacy gate | Travel plans refuse anyone who is not signed in and has no share link. | yes |
| `trips` | Travel plan storage | The DynamoDB table that holds travel plans, days and events. | yes |
| `files` | Attachment storage | The private S3 bucket that holds attachments (bookings, photos). | no |
| `pdf` | PDF export | The separate Lambda function that turns a travel plan into a PDF. | no |

## Guest checks

Rules for every check: method GET or HEAD only; send no cookies, no `Authorization` header and no query string; do not
follow redirects; user agent `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`; timeout 10 s.

| Function | Method | URL | Status | Content type | Body marker, JSON key or `Location` prefix | Slow after |
| --- | --- | --- | --- | --- | --- | --- |
| `pages` | GET | https://plan.dliu.com/ | 200 | `text/html` | contains `class="dl-header"` | 2000 ms |
| `pages` | GET | https://plan.dliu.com/docs | 200 | `text/html` | contains `class="dl-footer"` | 2000 ms |
| `docs` | GET | https://plan.dliu.com/docs/api.md | 200 | `text/markdown` | contains `# Travel plan API` | 2000 ms |
| `docs` | GET | https://plan.dliu.com/docs/health.md | 200 | `text/markdown` | contains `# plan.dliu.com health checks` | 2000 ms |
| `signin` | GET | https://plan.dliu.com/auth/login | 302 | — | `Location` starts with `https://login.microsoftonline.com/` | 3000 ms |
| `signin` | GET | https://plan.dliu.com/api/me | 200 | `application/json` | contains `"signedIn":false` | 3000 ms |
| `private` | GET | https://plan.dliu.com/api/trips | 401 | `application/json` | JSON key `error` | 3000 ms |
| `pdf` | GET | https://plan.dliu.com/api/trips/health/pdf | 404 | `application/json` | JSON key `error` | 3000 ms |

Notes:

- `text/html` from S3 has no charset; match the content type by prefix. The Markdown files are
  `text/markdown; charset=utf-8`.
- `/`, `/docs` and the other docs pages are the same single-page app shell; their text is drawn by JavaScript, so match
  only the shared header and footer markers.
- `/api/me` answers 200 with `{"signedIn":false}` for guests, not 401.
- `/api/trips` must stay 401. A 200 there would mean travel plans are open to guests: report `private` as down.
- `/api/trips/health/pdf` reaches the PDF function, which refuses `health` as a travel plan id (ids are 8 digits) before
  it reads anything, so the 404 proves the function answers without rendering a PDF or touching a plan. A 5xx or a
  timeout means PDF export is down.

## Health endpoint

`GET https://plan.dliu.com/health` (HEAD also works).

- No authentication. CloudFront's `health` behavior has no origin request policy, so it forwards no cookies, no
  `Authorization` header and no query string, and the Lambda answers before it looks at any request data.
- Cached at CloudFront for 60 s (`Cache-Control: public, max-age=60`, cache key empty), so it runs at most about once a
  minute per edge.
- Read only. The checks run in parallel, each with its own 2 s timeout; a check slower than 1 s is `warn` with `output`
  `slow`. The whole reply returns within about 2 s.
- `Content-Type: application/health+json`. HTTP 200 when `status` is `pass` or `warn`, 503 when it is `fail`. The
  top-level `status` is the worst of the functions'.
- `output` is only `slow`, `timeout` or `read failed`. No table, bucket or function names, no counts, no content.

```json
{
  "status": "pass",
  "time": "2026-11-03T23:00:00Z",
  "functions": [
    { "key": "trips", "name": "Travel plan storage", "status": "pass" },
    { "key": "files", "name": "Attachment storage", "status": "pass" },
    { "key": "signin", "name": "Microsoft sign-in settings", "status": "pass" }
  ]
}
```

| Function key | What the check reads |
| --- | --- |
| `trips` | One DynamoDB `GetItem` of the fixed key `health-check`, which is never a travel plan (ids are 8 digits). |
| `files` | One S3 `HeadObject` of a fixed key outside every travel plan's folder; "not found" proves the bucket answers (no LIST, no download). |
| `signin` | The sign-in settings the app already loads from SSM Parameter Store (cached 5 minutes). Microsoft is not called. |

`pages`, `docs`, `private` and `pdf` are covered by the guest checks only.

## Not tested

A guest can't test anything that needs a sign-in or a share link:

- signing in at Microsoft and getting a session;
- listing, opening, creating, editing or deleting travel plans, days and events;
- uploading, opening or deleting attachments;
- exporting a real travel plan as a PDF;
- share links (creating, resetting, opening a plan with one) and their daily limits;
- the managed API for agents (`/docs/api`), which needs a Microsoft access token.

## Rules

- Every check is read only and must never change content.
- Never send cookies, credentials, share links or query strings, and never try to sign in.
- Run at most every 15 minutes; `/health` is cached for 60 s anyway.
