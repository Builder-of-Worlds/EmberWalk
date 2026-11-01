# EmberWalk data facts

What the phone app, the landing site and the Workers collect, where each thing is kept, which outside company receives it, for how long, and how Delete Everything erases it. Every line cites the code at commit e160cf2, checked Fri. Oct. 30th, 2026. Paths are from the repository root; `0005:20` means `migrations/0005_findings_and_ledger.sql` line 20 (the migration file named by its number).

This is research about the code, not legal advice. It is the source the Privacy Policy, the Terms, the About screen and the Security page are drafted from, and every policy sentence about data must trace to a line here. A line marked **Unproven** could not be shown from the code; it says what is missing. When the code changes, this sheet changes in the same commit.

## Re-check at 15507a5, the base of branch 371 (Sat Oct. 31st, 2026, 2:06 PM PDT, builder 371): partial

`git diff e160cf2 15507a5` over the cited paths changed code the sentences below rest on. The line numbers cited in this sheet are those of e160cf2 and have not all been moved (`workers/api/src/delete-everything.ts` gained imports, so its lines shifted). The public pages cover each change in words that were checked against the new code, not against these line numbers:

- Delete Everything now also stops report shares, deletes the report files under the walk, and unlinks the plan from the phone's code (`workers/api/src/delete-everything.ts`: `stopShare`, `reportPrefix`, `unlinkVisitor`). Section 5 does not say so.
- Payments exist in code: `packages/shared/src/limits.ts` has `paymentsOn` (default `false`), `workers/api/src/stripe.ts`, `billing-route.ts`, `plans.ts` and `entitlements.ts` hold the Stripe customer, plan and extra-walk records. Sections 1 to 5 do not list them.
- A walk report (PDF and share link) exists in code, behind `REPORT` (`"off"` in `workers/api/wrangler.jsonc`): `report*.ts`, `browser-run.ts`. Sections 1 to 5 do not list it. No public page describes the report.
- `workers/static/src/handler.ts` now sends `strict-transport-security` and `permissions-policy` (Section 6 and 7 say the static site had none).

## 0. Seller facts given by the owner (not in code)

Recorded Fri. Oct. 30th, 2026, from the owner's own words; the code at e160cf2 holds none of them except the email address.

- Seller: "EmberWalk is a product of The Arbiter Bibendi LLC." State of formation: TBD (owner).
- Support email: hello@emberwalk.app (already the sign up mail sender and the privacy page's contact, `workers/static/public/privacy.html:60`).
- Payments: Stripe, built in a separate checkout part; no payment code exists at e160cf2. Prices, ruled by the owner: two plans, both yearly, and every walk needs a plan (no free walk, no free or judge code). Individuals: $12.99 a year for 4 walks of their home a year. Landlords and property managers: $39.99 a year for 15 walks a year at any buildings. On either plan, extra walks are $2.99 each. Walks are counted, not buildings: no record of which buildings a landlord walks is kept for counting. The page words are a draft for the owner's read and take these numbers from the checkout's plan settings once that part lands. Unused extra walks carry into the next plan year, on both plans (owner's ruling). TBD (owner): what each plan includes beyond the walks.
- Going public: the website (landing, pricing, legal and company pages) the weekend of Oct. 31st and Nov. 1st, 2026, for Stripe's review; the app on the night of Nov. 3rd to 4th. No page promises an availability date until live payments are approved.

## 1. Settings that decide what leaves the building

- **Real content goes to Meta only on a paid run.** Every Meta call checks `assertMaySend` (`packages/meta/src/client.ts:77` to `:80`, called at `:98`, `packages/meta/src/files.ts:14`, `workers/pipeline/src/transcribe.ts:22`), which refuses real content unless billing is `paid`. The committed config sets `META_BILLING` to `free_credits` (`workers/pipeline/wrangler.jsonc:34`, `workers/getfixed/wrangler.jsonc:21`), so at this commit only synthetic sample walks reach Meta. **Unproven:** the value a deploy will use.
- **Voice notes are on.** `VOICE_NOTES` is `on` (`workers/pipeline/wrangler.jsonc:35`), and the app records sound by default (`apps/web/src/screens/Record.tsx:101`, `apps/web/src/recorder.ts:20`).
- **The second check on Baseten is off for real walks.** `SECOND_CHECK_REAL_WALKS` is `off` (`workers/pipeline/wrangler.jsonc:36`, read at `workers/pipeline/src/second-check-step.ts:31`).
- **Delete Everything is off by default.** `deleteEverythingOn: false` (`packages/shared/src/limits.ts:42`); while off the route answers 404 (`workers/api/src/delete-everything.ts:143`). `workers/api/wrangler.jsonc:27` sets no `EMBERWALK_LIMITS`, so it stays off until a deploy sets it. The app shows the button only when that flag and the local `emberwalk.draftWords` switch are both on (`apps/web/src/screens/About.tsx:11`).
- **Get It Fixed is on** in its Worker (`GET_IT_FIXED`, `workers/getfixed/wrangler.jsonc:19`).

## 2. Landing site, emberwalk.app (`workers/static`)

- **Email address and role.** The sign up form takes an email (trimmed, lowercased) and one of homeowner, landlord or other, plus a Turnstile token (`workers/static/src/validate.ts:24` to `:29`, `workers/static/src/types.ts:27`). Stored in D1 `signups` with the time (`0001:3` to `:6`, insert at `workers/static/src/handler.ts:69`).
  - Kept until the person uses the unsubscribe link, which deletes the row (`workers/static/src/handler.ts:98`). Nothing else expires it.
  - Not linked to the app's visitor key, so Delete Everything does not touch it.
- **Welcome email** through Resend (`workers/static/src/resend.ts:4`): to the address given, from `hello@emberwalk.app`, plain text with a postal footer and one click unsubscribe headers; sent only for a new address with the mail key and unsubscribe secret set (`workers/static/src/handler.ts:77`). The postal footer is a deploy setting, not in code (`workers/static/src/email-copy.ts:21` to `:22`, refuses to send without one).
- **Turnstile.** The browser loads Cloudflare's script from `challenges.cloudflare.com` (`workers/static/public/site.js:637`), so Cloudflare sees the visitor's IP address and browser directly. The server check sends only the secret and the token, no IP (`workers/static/src/turnstile.ts:9`).
- **Cookies and analytics.** No code sets a cookie and no analytics script is loaded (searched `workers/static/src` and `workers/static/public` for `set-cookie`, `document.cookie`, `cloudflareinsights`, `beacon`: no hit). Turnstile may set its own cookie. **Unproven:** whether Cloudflare Web Analytics is switched on for the zone in the dashboard.
- **Headers.** Every response carries a Content Security Policy (`default-src 'none'`, scripts from this site and Turnstile only), `x-content-type-options: nosniff`, `x-frame-options: DENY` and `referrer-policy: no-referrer` (`workers/static/src/handler.ts:11` to `:27`, applied at `:124`). No `strict-transport-security` and no `permissions-policy` header is set.

## 3. Phone app, go.emberwalk.app (`apps/web`, served by `workers/api`)

### 3.1 On the phone

- **Visitor key.** 32 random bytes as hex (`apps/web/src/prefs.ts:27`), kept in localStorage `emberwalk.visitorId` (`apps/web/src/prefs.ts:20`). It names the person's walks to the server in the `x-emberwalk-visitor` header (`apps/web/src/api.ts:92`) and in the body of a new walk (`apps/web/src/sender.ts:32`). There is no account, name or password.
- **Recordings (takes).** IndexedDB `emberwalk`, stores `takes` and `chunks` (`apps/web/src/take-store.ts:91` to `:96`): the video and sound, the camera's name and size (`apps/web/src/recorder.ts:28`), the rule area key, and the compass, tilt and light marks. Removed when the walk's check ends (`apps/web/src/screens/Send.tsx:107`); no other expiry.
- **Results and stills.** IndexedDB `emberwalk-results`, the three newest walks only (`apps/web/src/results-store.ts:6`, `:66`); Cache Storage `emberwalk-stills`, at most 40 stills (`apps/web/src/kept-stills.ts:3`, `:5`).
- **Marks and settings.** localStorage keys `emberwalk.introSeen`, `.jurisdiction`, `.visitorId`, `.view`, `.agreedToSend` (`apps/web/src/prefs.ts:18` to `:22`); finding marks under `emberwalk.findings.<id>` (`apps/web/src/finding-marks.ts:28`); unsent marks under `emberwalk.pendingMarks` (`apps/web/src/mark-sync.ts:15`); sent walk ids under `emberwalk.sentWalks` (`apps/web/src/sent-walks.ts:1`).
- **App files.** The service worker caches only the app's own files, never `/api/` (`apps/web/src/offline.ts:12`, `:24`).
- **No cookies, no analytics, no outside requests.** Every API call goes to the app's own origin (`apps/web/src/deps.ts:115`); no cookie, map tile, font or analytics request was found in `apps/web/src`.

### 3.2 What the phone sends and where it is kept

- **Video and sound of the walk.** Sent in parts by presigned PUT straight to R2 (`apps/web/src/uploader.ts:107`), kept as `originals/<walk>/walk.mp4` (`workers/api/src/upload-api.ts:142`). Cut into clips `clips/<walk>/<kind>.mp4` by the media Container, which fetches only the presigned links it is given (`containers/media/src/transfer.ts:11`, `:46`).
  - Deleted when the walk finishes, as the pipeline's last step, with the clips, the sound and the transcript file (`workers/pipeline/src/workflow.ts:98`, `workers/pipeline/src/storage.ts:13` to `:14`).
  - An hourly sweep (`workers/pipeline/wrangler.jsonc:29`) deletes any original older than 24 hours, never less than 2 (`workers/pipeline/src/sweep.ts:8` to `:9`, `:53`).
- **Location.** The phone reads its position once at low accuracy (`apps/web/src/location.ts:23` to `:26`) and keeps only a rule area key such as `ca` (`apps/web/src/location.ts:74` to `:78`). The key is sent as `jurisdiction` (`apps/web/src/sender.ts:29`) and stored on the walk (`0002:9`). Coordinates are never sent by the app. The API's crew lookup accepts `lat` and `lng` (`workers/api/src/directory-route.ts:18` to `:27`) and stores nothing, but no app code calls it.
- **Camera name and size** on the walk row (`0002:11` to `:13`).
- **Compass, tilt and light samples** (`apps/web/src/motion.ts:58`, `apps/web/src/light.ts:35`), sent with each tag (`apps/web/src/sender.ts:51` to `:52`), stored in `tags` (`0003:11`, `0018:1`). Light is the average brightness of a tiny camera frame, not a sensor (`apps/web/src/light.ts:5`).
- **The walk row**: visitor key, time, language, rule area, share code (`0002:3` to `:10`), and any failure message (`0003:2`).
- **Voice notes.** The sound track is cut to `originals/<walk>/sound.wav` (`workers/pipeline/src/transcribe.ts:25`), sent to Meta (section 4), and deleted straight after (`workers/pipeline/src/transcribe.ts:47`). The transcript is kept as `originals/<walk>/turns.json` (`:49`) until the video is deleted. Words matched to a finding are kept as `findings.voice_note` (`0005:20`, written at `packages/db/src/voice-notes.ts:10`) until Delete Everything.
- **Findings and pictures made from the walk**, all kept until Delete Everything (no other expiry in code):
  - blurred proof stills `stills/<walk>/...` (`workers/pipeline/src/blur.ts:46`); the blur boxes `privacy/<walk>/...` (`workers/pipeline/src/privacy.ts:65`), found by asking SAM for person, face, license plate, house number, street sign and mailbox (`workers/pipeline/src/privacy.ts:8`);
  - detections and masks under `clips/<walk>/<clip>/` (`workers/pipeline/src/segment.ts:96`, `workers/pipeline/src/tracks.ts:54`); note these sit under `clips/` but are not removed with the video;
  - the coverage record `coverage/<walk>.json` (`workers/pipeline/src/coverage-step.ts:142`); See It Fixed pictures `previews/<walk>/...` (`workers/pipeline/src/preview-step.ts:45`); second check answers `reports/<walk>/second-check.json` (`workers/pipeline/src/second-check-step.ts:59`);
  - the coverage and pointing stills are deleted as soon as their step ends (`workers/pipeline/src/coverage-step.ts:94`, `workers/pipeline/src/point.ts:113`).
- **Recheck photo.** Taken without sound (`apps/web/src/screens/Recheck.tsx:119`), uploaded by presigned PUT to `rechecks/<walk>/<finding>/<id>` (`workers/api/src/recheck-route.ts:101`), not blurred, kept until Delete Everything.
- **Finding marks**: status, a note and a done date (`apps/web/src/fixed-api.ts:131`), stored in `finding_marks` (`0016:105` to `:106`).
- **Fault reports**: walk id, refusal code and app build only (`apps/web/src/screens/Send.tsx:99`), stored in `fault_reports` (`0011:2`); rows idle for 30 days are deleted when the next report arrives (`packages/db/src/faults.ts:15`, `:18`; `packages/shared/src/limits.ts:55`).
- **Get It Fixed.**
  - The ZIP typed by the person (`apps/web/src/fixed-api.ts:121`), kept on the job (`0006:6`).
  - A crew email the person types (`apps/web/src/fixed-api.ts:124`), kept in the crew record (`0006:17`).
  - Drafted messages, subject and body (`0006:28` to `:29`), approvals with the visitor key and the photo keys (`0016:3` to `:5`), the send record (`0016:56` to `:57`), follow up notes (`0008:6`), reply text the person logs (`apps/web/src/fixed-api.ts:127`).
  - Crews come from the state's public license lists (business name, address, phone, `0014:12` to `:15`), not from the person.
  - A crew with only a phone gets an `sms:` link opened in the phone's own Messages app; EmberWalk sends nothing for it (`apps/web/src/phone.ts:8`).
- **Crew replies by email** arrive through Cloudflare Email Routing (`workers/getfixed/src/index.ts:13`), only from a crew already mailed on that job (`workers/getfixed/src/inbound.ts:24` to `:31`). Sender, subject and text are kept in `crew_replies` (`0016:73` to `:75`, saved at `workers/getfixed/src/inbound.ts:39`); attachments are dropped (`workers/getfixed/src/mime.ts:75`).
  - A reply asking to be removed adds the address to `mail_optouts` (`0016:133`) and the license to `crew_removals` (`0014:28`) (`workers/getfixed/src/inbound.ts:34` to `:36`). These are kept with no end, so the crew is never mailed again.
- **Cost record** per model call with the walk id and time (`0005:29`, `:33`), kept with no end.
- **Cached model answers** in R2 `cache/<fingerprint>.json` with an index row (`0005:48`), marked under the walk that used them (`workers/pipeline/src/deps.ts:46`). No expiry in code.
- **No IP address or browser string is stored** by any Worker (no read of `cf-connecting-ip`, `user-agent` or `request.cf` in `workers/*/src`).

## 4. Outside companies

| Company | What it receives | Condition | Retention in code |
| --- | --- | --- | --- |
| Meta, SAM 3.1 (`api.meta.ai`, `workers/pipeline/wrangler.jsonc:33`) | Each whole clip, not blurred, as a file upload (`packages/meta/src/files.ts:18` to `:23`, `workers/pipeline/src/segment.ts:24` to `:30`); the blur boxes are found with this same file | Paid run only (section 1) | File set to expire after 3600 seconds (`packages/meta/src/files.ts:21`) and deleted when the walk ends (`packages/meta/src/files.ts:31`, `workers/pipeline/src/workflow.ts:88` to `:91`); requests set `store: false` (`packages/meta/src/sam.ts:140`) |
| Meta, Muse Spark | Stills not blurred, as image bytes, for pointing and for the loop check (`workers/pipeline/src/point.ts:104`, `workers/pipeline/src/coverage-step.ts:70`, `:83`); blurred stills by presigned R2 links valid 3600 seconds, the transcript, the findings and the rule table for the explain step (`workers/pipeline/src/explain-step.ts:38`, `:49`, `:50`; `workers/pipeline/src/storage.ts:22`); the blurred before still and the unblurred recheck photo (`workers/pipeline/src/recheck-step.ts:86` to `:94`); transcript text for clean up (`workers/pipeline/src/voice-notes.ts:83`); for Get It Fixed the trade, ZIP and findings (`packages/agent/src/loop.ts:71` to `:78`) and each crew reply with the request it answers (`packages/agent/src/replies.ts:19`) | Paid run only | `store: false` (`packages/meta/src/spark.ts:64`); nothing else in code |
| Meta, Muse Voice Transcribe | The walk's sound track as WAV (`workers/pipeline/src/transcribe.ts:23` to `:33`) | `VOICE_NOTES` on, paid run only | Not in code |
| Meta, Muse Image | Up to 3 blurred proof stills with a fix prompt (`workers/pipeline/src/preview-step.ts:6`, `:43`) | Paid run only | Not in code |
| Baseten (`inference.baseten.co`, `packages/meta/src/baseten.ts:9`) | Each finding's data and its blurred proof still (`workers/pipeline/src/second-check-step.ts:49` to `:51`) | Off for real walks (section 1); needs its key | Not in code |
| Resend (`api.resend.com`) | Welcome email to a sign up address (section 2); crew request emails: the crew's address, the approved text, an opt out link, the footer and the blurred stills as attachments, reply to the job's own address (`workers/getfixed/src/mail.ts:95` to `:107`) | A crew email only after the person approves it (`workers/getfixed/src/actions.ts:203`) | Not in code. No open or click tracking field is sent; **Unproven:** the account's tracking defaults |
| Cloudflare | Hosts everything: Workers, D1, R2, Workflows, the media Container, Email Routing, Turnstile (bindings in each `workers/*/wrangler.jsonc`) | Always | See section 6 |

- **Cartesia: not in code.** No source file names it; the only mention is a planning note outside the product.
- **Esri: not in code.** No map, aerial or tile request exists. One sentence held back from the app says "the map point of your house is sent to Esri" (`apps/web/src/copy.ts:321`, in the `unbacked` set); it must not be published while no code sends anything to Esri.
- **CAL FIRE and the license board** are links shown to the person; nothing fetches them (`packages/directory/src/fire-links.ts:4` to `:9`, `packages/agent/src/inspection.ts:14` to `:19`).
- **Browser Run and Workers AI** are not bound in any Worker.

## 5. Delete Everything

- **Request.** `POST /api/everything` (`workers/api/src/index.ts:74` to `:75`) with the visitor key in the header and the same key in the body, else 400 or 403 (`workers/api/src/delete-everything.ts:145` to `:157`). The key is the only proof of ownership.
- **Refused while a walk is in flight**: 409 while any walk is queued, processing, or uploading with an open upload (`workers/api/src/delete-everything.ts:129` to `:139`, `:162`).
- **Spread over several requests**: one request stops starting new walks after 500 counted storage and database calls and answers `{walks, left}`; the phone asks again until `left` is 0 (`workers/api/src/delete-everything.ts:7`, `:167`, `:171`; `apps/web/src/screens/About.tsx:20`).
- **Erased, for every walk of that key**:
  - cached answers marked for the walk, their index rows and marks (`workers/api/src/delete-everything.ts:87` to `:95`);
  - upload records, aborting an open upload (`:76` to `:85`);
  - every R2 object under any top level prefix followed by the walk id, so originals, clips, stills, privacy, coverage, previews, reports and rechecks (`:117`, `:164`);
  - D1: Get It Fixed use counts, fault reports, message approvals and the walk row (`:105` to `:109`); deleting the walk removes its tags, clips, detections, findings, marks, jobs, crews, messages, replies, send records, follow ups and gaps through the schema's `ON DELETE CASCADE` links (migrations 0003 to 0017). Proven on a local D1 by `workers/api/test/delete-everything.test.ts:236` and `:256` (no row of any table holds the key after), and `:229` fails when a new table is not classed.
- **Kept after Delete Everything**:
  - cost records, with the walk link cleared (`workers/api/src/delete-everything.ts:107`);
  - cached answers stored with no walk (`workers/pipeline/src/deps.ts:46`);
  - crew opt outs and license removals (no code deletes them);
  - the landing site sign up row (not linked to the key; the unsubscribe link removes it);
  - the Workflow run history Cloudflare keeps for each walk and follow up timer (no code touches it; **Unproven** what that history holds and for how long);
  - emails already delivered through Resend, and anything Meta or Baseten kept on their side (section 4).
- **On the phone afterwards** (`apps/web/src/forget-sent.ts`): a new visitor key (`:25`), sent walks and part takes removed (`:28`, `:33`), results, stills, marks and pending marks cleared (`:40` to `:44`). Recordings never sent are kept on purpose (`:36`), as are the settings keys, `emberwalk.pendingAborts` and the app files.

## 6. Cloudflare logs and platform

- No Worker config turns on `observability`, Logpush or a tail Worker (each `workers/*/wrangler.jsonc`).
- Log lines carry walk, message and upload ids but no email address or visitor key (for example `workers/api/src/walk-read.ts:250`, `workers/api/src/delete-everything.ts:173`). **Unproven:** whether an error message text could carry a person's words (`workers/api/src/get-it-fixed-routes.ts:164`, `workers/getfixed/src/actions.ts:162`).
- **Unproven, not in code:** Cloudflare's own request logs (IP address, browser), D1 point in time restore copies, and any R2 lifecycle rule set in the dashboard. No `wrangler.jsonc` sets an R2 lifecycle rule.

## 7. Where the published words and the code differ today

- The live privacy page covers only the sign up list (`workers/static/public/privacy.html:44`) and says nothing of the app's video, sound, location key, voice notes, stills, Get It Fixed emails or the outside companies in section 4.
- Pictures not blurred reach Meta before the blur step runs (`workers/pipeline/src/workflow.ts:113` to `:121` run before the blur at `:177`); today only on synthetic walks, because of the paid run setting.
- The app records sound by default and voice notes are on, so the walk's sound goes to Meta on a paid run.
- The Esri sentence (section 4) has no code behind it.
- Delete Everything does not reach the sign up list, crew opt outs or the cost record (section 5).

## 8. Unproven, in one list

1. The deploy values of `META_BILLING`, `EMBERWALK_LIMITS` and `VOICE_NOTES`.
2. Cloudflare Web Analytics on the zone; Cloudflare request logs, D1 restore copies, R2 dashboard lifecycle rules, Workflow history contents and life.
3. Resend account tracking defaults and how long Resend keeps sent mail.
4. How long Meta and Baseten keep requests beyond `store: false` and the file expiry.
5. That D1 in production enforces the `ON DELETE CASCADE` links as the local test does.
6. Whether error text in two log lines can carry a person's words (section 6).
7. Which Email Routing rule sends job mail to the Get It Fixed Worker (no binding in config).
