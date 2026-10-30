# workers/static

The site at `emberwalk.app`: the landing page, the signup endpoint and the privacy page. The judge mode backup joins it later. Built and tested locally only; nothing here is deployed.

## Layout

| Path | Holds |
| --- | --- |
| `public/` | The pages, style, script and the self hosted font with its `OFL.txt` |
| `public/brand/` | The mark, tab icons, touch and app icons, lockups and the share card, all written by `scripts/brand.mjs` |
| `public/landing/` | The landing page's synthetic stills and, in `frames/`, the opening film as numbered WebP frames |
| `public/vendor/` | GSAP 3.15.0 and its ScrollTrigger plugin, copied from the pinned package with their license notices; the landing page's after the walk loop runs on them |
| `scripts/brand.mjs` | Writes the brand SVGs from one set of geometry and renders the PNGs from them in headless Chromium (`EMBERWALK_CHROMIUM=<binary> node workers/static/scripts/brand.mjs`) |
| `src/` | The Worker: `/api/config`, `/api/signup`, security headers, static assets |
| `test/` | Worker tests against local D1 (`npm test -w workers/static`) |
| `test/browser/` | Browser tests at 390 by 844 and 1440 by 900 (`npm run test:e2e -w workers/static`) |

`migrations/0001_signups.sql` at the repository root creates the list.

## Running the browser tests

Browsers run headless. Point `EMBERWALK_CHROMIUM` at a Chromium or headless shell binary when Playwright has no browser of its own installed. Screenshots land in `test-results/` (gitignored).

## Secrets and keys

Nothing secret is committed. `TURNSTILE_SECRET`, `RESEND_API_KEY`, `UNSUBSCRIBE_SECRET` and `POSTAL_FOOTER` are Worker secrets, set with `wrangler secret put` at deploy time (locally in `.dev.vars`, which is gitignored). The site key in `wrangler.jsonc` is Cloudflare's published test key and must be replaced when the real widget exists. Without `TURNSTILE_SECRET` the signup endpoint refuses every request. Without `RESEND_API_KEY` signups are stored and no email is sent. `POSTAL_FOOTER` is the sender name and postal address every email ends with; without it signups are stored and no email is sent.

## Email, unsubscribe and tracking

- Every email ends with the postal address and carries a one click unsubscribe link (`/unsubscribe?t=...`) and the `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058). The link holds the address and an HMAC signature made with the Worker secret `UNSUBSCRIBE_SECRET`; opening it (GET) or a mail app posting to it removes that row at once. Changing the secret makes every link already sent stop working.
- Without `UNSUBSCRIBE_SECRET` a signup is stored and no email is sent, and the unsubscribe page answers 500.
- Resend open and click tracking are domain settings in the Resend dashboard and must stay off for `emberwalk.app`; the send call never sends a tracking field, and a test fails if it ever does.
- A child reported to us is removed with the removal statement below.

## Remove a person

Anyone who asks by email to be removed is deleted with this statement, run against the production database by the site owner (replace the address, lower case is applied for you):

```sql removal
DELETE FROM signups WHERE email = lower('person@example.com');
```

Run it with `npx wrangler d1 execute emberwalk-db --remote --command "<the statement>"`.

## Show or correct what is held about a person

The privacy page promises that anyone who writes to hello@emberwalk.app can see what we hold about them or have it corrected. Each statement is run against the production database by the site owner, in the same way as the removal.

Show the row:

```sql access
SELECT email, role, created_at FROM signups WHERE email = lower('person@example.com');
```

Correct the role (homeowner, landlord or other):

```sql correction
UPDATE signups SET role = 'other' WHERE email = lower('person@example.com');
```

Correct the address:

```sql address
UPDATE signups SET email = lower('corrected@example.com') WHERE email = lower('person@example.com');
```
