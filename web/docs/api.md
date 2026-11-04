# Travel plan API

This reference is for trusted tools, scripts and AI agents managing travel plans on https://plan.dliu.com. This plain Markdown file (https://plan.dliu.com/docs/api.md) is the full reference; people get a plain-language overview in the API tab at https://plan.dliu.com/docs#api.

The managed API accepts Microsoft-issued user access tokens. It can list and read travel plans, create and edit plans, events and attachments, export PDFs, and delete plans, events and attachments when the token has the corresponding permission.

**Authentication is required:** configure your requester using the [Auth API documentation](https://auth.dliu.com/docs/api). That is the canonical guide for credentials, token acquisition, the default local token file, expiry and the bearer header; this reference covers only the travel plan API.

## Quick rules

1. The managed API origin (deployment output `MicrosoftApiUrl`) is `__TRIP_API_URL__`. Send every request to that origin. All fourteen managed routes are listed below.
2. Configure authentication according to the [Auth API documentation](https://auth.dliu.com/docs/api) before using any managed route. Website sign-in and share links are not managed API authentication, and the website's own `https://plan.dliu.com/api/*` does not accept bearer tokens.
3. Request bodies are JSON objects with `Content-Type: application/json`, at most 64 KiB. Do not send file bytes to this API: attachments go straight to storage with a presigned URL.
4. Managed requests do not need `Origin`, website cookies, `x-plan-token` or `x-amz-content-sha256`.
5. Request only user-authorized operations. Do not run write or delete examples just to check a token. `PUT` replaces every field of a plan or event: read the current object first and send it back with only the intended changes. There is no ETag or conditional update; serialize changes to the same plan.
6. Treat presigned storage URLs (`url`, `uploadUrl`) as credentials: never print, share, log or save them. Use them without the bearer token. The API never redirects; do not follow redirects with credentials.
7. Every plan has a share link, returned as `shareUrl` when you read a plan. To see a plan the way people see it, open that link in a browser (see [Viewing a plan](#viewing-a-plan)). The link works for 3 months (`shareExpiresAt`) and is a credential: give it only to the user, and never post or log it anywhere else.
8. Errors come from either the gateway (`{"message":"..."}`) or the travel plan functions (`{"error":"..."}`).

## Endpoint summary

| Method and path | Required scope | Operation |
| --- | --- | --- |
| [GET /api/me](#get-api-me) | `trip.read` | Read the authenticated user identity |
| [GET /api/trips](#get-api-trips) | `trip.read` | List all travel plans (summaries) |
| [POST /api/trips](#post-api-trips) | `trip.write` | Create a travel plan |
| [GET /api/trips/{tripId}](#get-api-trips-tripid) | `trip.read` | Read one travel plan with its events and files |
| [PUT /api/trips/{tripId}](#put-api-trips-tripid) | `trip.write` | Replace a plan's details |
| [DELETE /api/trips/{tripId}](#delete-api-trips-tripid) | `trip.delete` | Delete a plan, its events and its files |
| [POST /api/trips/{tripId}/events](#post-api-trips-tripid-events) | `trip.write` | Add an event |
| [PUT /api/trips/{tripId}/events/{eventId}](#put-api-trips-tripid-events-eventid) | `trip.write` | Replace an event |
| [DELETE /api/trips/{tripId}/events/{eventId}](#delete-api-trips-tripid-events-eventid) | `trip.delete` | Delete an event |
| [POST /api/trips/{tripId}/files](#post-api-trips-tripid-files) | `trip.write` | Start an attachment upload |
| [PUT /api/trips/{tripId}/files/{fileId}](#put-api-trips-tripid-files-fileid) | `trip.write` | Keep an uploaded attachment, or rename one |
| [GET /api/trips/{tripId}/files/{fileId}](#get-api-trips-tripid-files-fileid) | `trip.read` | Get a short-lived download URL for an attachment |
| [DELETE /api/trips/{tripId}/files/{fileId}](#delete-api-trips-tripid-files-fileid) | `trip.delete` | Delete an attachment |
| [GET /api/trips/{tripId}/pdf](#get-api-trips-tripid-pdf) | `trip.read` | Export the plan as a PDF |

`trip.write` does not include `trip.delete`: every DELETE needs `trip.delete`. Every plan has a share link, and reading a plan returns it as `shareUrl` (needs `trip.read`). A link works for 3 months; after that `shareUrl` is `null` until a signed-in member creates a new one on the website. Links can't be created or reset through this API. `/api/shared/*` is not published here, and the bare `shareToken` is never returned. There is no PATCH, sign-in or token-management route.

## Authentication and access

Follow the required [Auth API documentation](https://auth.dliu.com/docs/api) before calling the travel plan API. Credential lookup, the token file, expiry/renewal and authorization-header construction belong there, not in this site-specific guide.

The gateway validates the Microsoft signature, tenant-specific v2 issuer, audience, token times and the route's scope. The travel plan functions then also require the configured gateway, tenant, audience, the approved client (`azp`), user object and subject IDs (`oid`, `sub`), the assigned user role `api.access` (shown in Entra as "dliu API user"), and the route's exact scope. Website cookies and share links never provide a fallback on this entry point.

**API versus website:** API access comes only from the verified tenant, the immutable user IDs (`oid`, `sub`), the approved client, an explicit assignment of the user-only shared `api.access` role (shown in Entra as "dliu API user", the same role for every dliu.com managed API) and the route's scope. Mutable claims such as `preferred_username` or email are never used for authorization, so a token with no username, or one that is not an email address, works when the user is assigned. Only users the site owner explicitly assigns this role can use the API. Other organisation members keep their website and share-link access, but signing in to the website gives them no managed API rights. The old site-specific `trip.access` role is not accepted, and the role never replaces a route scope; there is no blanket tenant or guest access. The website's own sign-in is separate and unchanged: it still requires a `@dliu.com` account and does not accept bearer tokens. The user is identified by `oid`.

**Access model:** there is no per-plan owner. An authorized caller is equivalent to a signed-in website member: it can read and change every travel plan, within its scopes. Edits record the caller's display name (the token's `name`, for display only) as `updatedBy`. Managed callers are not subject to the share-link daily allowances, but the per-plan limits below still apply.

**Authenticated gateway success has not yet been verified against a live user token.** The travel plan API has no token cache, token persistence or bearer-header logging.

## Request examples

These examples assume an authenticated requester configured per the [Auth API documentation](https://auth.dliu.com/docs/api). From the travel plan checkout (Node.js 22+), `scripts/api-client.js` reads the token as that guide describes, sends it only to the managed origin, refuses redirects, and never prints presigned URLs:

```bash
export TRIP_API_URL='__TRIP_API_URL__'
node scripts/api-client.js GET /api/me
node scripts/api-client.js GET /api/trips
node scripts/api-client.js GET /api/trips/20261001
# Only when explicitly asked to change this plan:
node scripts/api-client.js POST /api/trips/20261001/events '{"date":"2026-10-12","time":"09:30","title":"Train to Kyoto","status":"confirmed"}'
# Attachments and PDFs (new local files are created, never overwritten):
node scripts/api-client.js upload 20261001 ./booking.pdf "Hotel booking"
node scripts/api-client.js download 20261001 AbCdEfGhIjKlMnOp ./booking-copy.pdf
node scripts/api-client.js pdf 20261001 ./kyoto.pdf en Europe/London
```

Any other requester works the same way: `Authorization: Bearer <access token>` to the managed origin, and JSON bodies with `Content-Type: application/json`.

## Objects

### Trip summary

Returned by `GET /api/trips`, newest first (plans without dates first):

```json
{
  "id": "20261001",
  "title": "Kyoto",
  "destination": "Japan",
  "startDate": "2026-11-12",
  "endDate": "2026-11-16",
  "travellers": ["Dewei", "Alex"],
  "excerpt": "First 280 characters of the description…",
  "updatedAt": "2026-10-01T12:00:00.000Z"
}
```

### Trip

Returned by the trip, event and file routes:

```json
{
  "id": "20261001",
  "title": "Kyoto",
  "destination": "Japan",
  "startDate": "2026-11-12",
  "endDate": "2026-11-16",
  "intro": "Description shown at the top of the plan.",
  "travellers": ["Dewei", "Alex"],
  "events": [
    {
      "id": "Xk3pQ9vLm2Rw",
      "date": "2026-11-12",
      "time": "09:30",
      "endTime": "11:45",
      "title": "Train to Kyoto",
      "status": "confirmed",
      "place": "Tokyo Station",
      "notes": "Car 7, seats 12A–B",
      "link": "https://example.com/booking"
    }
  ],
  "files": [
    { "id": "AbCdEfGhIjKlMnOp", "name": "Hotel booking.pdf", "size": 182044, "type": "application/pdf", "createdAt": "2026-10-01T12:00:00.000Z" }
  ],
  "updatedAt": "2026-10-01T12:00:00.000Z",
  "updatedBy": "Dewei Liu",
  "shareUrl": "https://plan.dliu.com/plan/20261001?token=…",
  "shareExpiresAt": "2027-01-01T12:00:00.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `id` | Eight digits, assigned by the server: UTC year and month of creation plus a two-digit number (at most 100 plans a month) |
| `events` | Sorted by date (undated last), then all-day events, then time. `endTime` appears only when set |
| `status` | One of `confirmed`, `planned`, `proposed`, `option`, or empty |
| `files` | Attachments belong to the plan, not to events |
| `shareUrl` | The plan's share link: anyone holding it can view and edit this one plan in a browser without signing in. Treat it as a credential. `null` once the link has expired |
| `shareExpiresAt` | When the share link stops working: 3 months after it was made or reset. Empty for links made before links expired, until a member opens the plan |

### Trip input

Body of `POST /api/trips` and `PUT /api/trips/{tripId}`. Text is trimmed; control characters are removed.

| Field | Rules |
| --- | --- |
| `title` | Required, at most 120 characters |
| `destination` | At most 120 characters |
| `startDate`, `endDate` | `YYYY-MM-DD` or empty; the end can't be before the start |
| `intro` | Description, at most 10,000 characters |
| `travellers` | Array of names, or one string separated by commas, 、, semicolons or new lines. At most 30 names of 60 characters; duplicates are dropped |

### Event input

Body of `POST .../events` and `PUT .../events/{eventId}`.

| Field | Rules |
| --- | --- |
| `title` | Required, at most 200 characters |
| `date` | `YYYY-MM-DD` or empty (undated) |
| `time`, `endTime` | `HH:MM` or empty; `endTime` needs `time` and must be later the same day |
| `status` | `confirmed`, `planned`, `proposed`, `option` or empty |
| `place` | At most 200 characters |
| `notes` | At most 4,000 characters |
| `link` | Full `http://` or `https://` URL, at most 2,000 characters, or empty |

## Trips

### GET /api/me

Required scope: `trip.read`. Response (200): `{"signedIn":true,"user":"<user-object-id>","name":"Example user"}`.

### GET /api/trips

Required scope: `trip.read`. Response (200): `{"trips":[<trip summary>, ...]}`.

### POST /api/trips

Required scope: `trip.write`. Body: trip input. Response (201): the new trip.

### GET /api/trips/{tripId}

Required scope: `trip.read`. Response (200): the trip, including its `shareUrl` for [viewing it](#viewing-a-plan).

### PUT /api/trips/{tripId}

Required scope: `trip.write`. Body: trip input; every field is replaced, so omitted fields are cleared. Events and files are unchanged. Response (200): the trip.

### DELETE /api/trips/{tripId}

Required scope: `trip.delete`. Deletes the plan, its events and all its attachments. This can't be undone through the API. Response (200): `{"deleted":"20261001"}`.

## Events

At most 300 events per plan.

### POST /api/trips/{tripId}/events

Required scope: `trip.write`. Body: event input. Response (201): `{"eventId":"Xk3pQ9vLm2Rw","trip":<trip>}`.

### PUT /api/trips/{tripId}/events/{eventId}

Required scope: `trip.write`. Body: event input; every field is replaced. Response (200): `{"trip":<trip>}`.

### DELETE /api/trips/{tripId}/events/{eventId}

Required scope: `trip.delete`. Response (200): `{"trip":<trip>}`.

## Attachments

Each file is 1 byte to 50 MB; a plan holds at most 200 files and 1 GB in total. Uploads take three steps:

1. `POST /api/trips/{tripId}/files` with `{"name":"Hotel booking.pdf","size":182044,"type":"application/pdf"}` returns `fileId`, `uploadUrl` and `uploadHeaders`.
2. `PUT` the exact bytes to `uploadUrl` with exactly `uploadHeaders` and no `Authorization` header. The URL is valid for 15 minutes and only for that size and type.
3. `PUT /api/trips/{tripId}/files/{fileId}` with `{"name":"Hotel booking.pdf"}` keeps the file. Unkept uploads are removed after a day.

```bash
# UPLOAD_URL and CONTENT_TYPE are the values returned by step 1; no bearer header is sent to storage.
curl --fail --silent --show-error -X PUT -H "content-type: $CONTENT_TYPE" --data-binary @booking.pdf "$UPLOAD_URL"
```

### POST /api/trips/{tripId}/files

Required scope: `trip.write`. Body: `name` (required, at most 200 characters, one line), `size` (bytes), `type` (MIME type; anything else becomes `application/octet-stream`). Response (201): `{"fileId":"AbCdEfGhIjKlMnOp","uploadUrl":"<presigned URL>","uploadHeaders":{"content-type":"application/pdf"}}`.

### PUT /api/trips/{tripId}/files/{fileId}

Required scope: `trip.write`. Body: `{"name":"..."}`. Keeps a finished upload (201) or renames a kept file (200). Response: `{"trip":<trip>}`.

### GET /api/trips/{tripId}/files/{fileId}

Required scope: `trip.read`. Query: `download=1` makes storage send it as a download rather than inline. Response (200):

```json
{"url":"<presigned URL>","expiresIn":300,"file":{"id":"AbCdEfGhIjKlMnOp","name":"Hotel booking.pdf","size":182044,"type":"application/pdf"}}
```

This is not a redirect, so no client can forward the bearer token to storage. Fetch `url` separately, without `Authorization`, within `expiresIn` seconds. Storage refuses requests that carry a second authorization.

### DELETE /api/trips/{tripId}/files/{fileId}

Required scope: `trip.delete`. Deletes the attachment. Response (200): `{"trip":<trip>}`.

## PDF export

### GET /api/trips/{tripId}/pdf

Required scope: `trip.read`. Query: `lang` (`en` or `zh`, default `en`) and `tz` (an IANA time zone such as `Europe/London`, for the export time). Response (200): `application/pdf` bytes with a `content-disposition` file name. Save the body to a file; do not print it. Plans whose PDF would exceed 4 MB return 413.

## Viewing a plan

To check how a plan looks, for example after changing it, open its `shareUrl` in a browser or browser tool and take a screenshot. No sign-in is needed. The page shows the plan's details, every day with its events and status colours, the attachments, and a calendar view.

- Use the link only to look. The page is editable for anyone holding the link, so do not click or type in it; make changes through this API instead.
- Use a normal browser. Link-preview bots (WhatsApp, Slack, Telegram and similar user agents) get an empty page with only the title.
- Each look counts toward the plan's daily share-link allowance (5,000 requests a day per plan); API calls do not.
- The link works until `shareExpiresAt` (3 months after it was made); members can also reset it on the website, which stops the old one at once. If `shareUrl` is `null`, the link has expired: ask the user to open the plan on the website and choose *Create link*. Show the link only to the user who asked; never put it in public places, logs, commits or third-party services.
- For a file instead of a page, use [GET /api/trips/{tripId}/pdf](#get-api-trips-tripid-pdf).

## Errors

| Status | Meaning/action |
| --- | --- |
| 400 | Invalid input: malformed or non-object JSON, missing title, bad date/time/link/status, or a file outside 1 byte–50 MB. Read `error` and correct the input. |
| 401 | Missing, malformed, invalid or expired Microsoft access token, or an untrusted identity context. Check requester setup using the [Auth API documentation](https://auth.dliu.com/docs/api). |
| 403 | The route's scope, the approved client or the assigned `api.access` role is missing. `trip.write` does not grant `trip.delete`. |
| 404 | No managed route for that method and path, or no such plan, event, file or pending upload. |
| 413 | Body over 64 KiB, or the plan is full (300 events, 200 files, 1 GB), or the PDF would be over 4 MB. |
| 415 | A request body without `Content-Type: application/json`. |
| 500 | Server failure. Writes may have partly succeeded: read the plan before retrying. |
| 503 | The gateway could not run the function (for example, too many requests at once). Retry later. |

Gateway denials look like `{"message":"Unauthorized"}`, `{"message":"Forbidden"}` or `{"message":"Not Found"}`; function errors look like `{"error":"Travel plan not found"}`. Direct storage errors use S3's own XML format. Report errors without logging credential headers or presigned URLs.

## Website-only routes

The website at https://plan.dliu.com keeps its own sign-in (`/auth/*`, session cookie) and share links (`/plan/<id>?token=...`, `x-plan-token`). Resolving old `/s/<token>` links (`GET /api/shared/{token}`) is website-only and has no managed equivalent.
