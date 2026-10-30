# First deploy checklist

Written Thu Oct. 29th, 2026. Every step here is yours: the build sessions never set a secret, run a remote migration, change the Cloudflare account or deploy. Run every command in your own Terminal, on `main`, with a clean tree. Each block starts by going to the main checkout, so you can paste it whole.

`scripts/deploy.sh` checks most of this list itself and refuses, naming the step, before it deploys anything.

## 1. Docker and a local boot

The pipeline Worker builds the media Container image on your Mac, so Docker must be installed and running.

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
docker --version
docker info
```

If `docker --version` fails, Docker is not installed. If `docker info` fails, start Docker Desktop and run it again.

With Docker running, boot all three Workers on your Mac. This calls nothing remote and needs no token:

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
sh scripts/worker-boot.sh
```

It must end with a line starting `WORKER BOOT green`. It checks that each Worker answers `/health`, that the API serves the phone app and that the landing Worker serves the judge copy at `/judge/`; no call reaches the media Container.

## 2. Choose the Container instance type

Open `workers/pipeline/wrangler.jsonc`, find the comment that says the instance type is not chosen yet, and add one line beside `"max_instances": 3`, for example `"instance_type": "basic",`. The deploy refuses until it holds one of `lite`, `basic`, `standard-1`, `standard-2`, `standard-3`, `standard-4`.

What each costs (estimated from Cloudflare's published Containers limits and pricing, https://developers.cloudflare.com/containers/platform-details/limits/ and https://developers.cloudflare.com/containers/pricing/, not fetched on Oct. 29th; check both pages before choosing). Workers Paid includes 25 GiB hours of memory, 375 vCPU minutes and 200 GB hours of disk a month; a Container is billed only while it is awake.

- `lite`: 256 MiB memory, 1/16 vCPU, 2 GB disk. The container downloads the whole walk video to its disk, so a large phone recording may not fit. Not run tested.
- `basic`: 1 GiB memory, 1/4 vCPU, 4 GB disk. The smallest type whose disk holds a large walk video with room for the clip. About 1,500 awake minutes a month fit in the included amounts (estimated). Not run tested: Docker was not running on Oct. 29th, so the container has not yet been booted at any size.
- `standard-1`: 4 GiB memory, 1/2 vCPU, 8 GB disk. About 375 awake minutes a month included, then about $0.0012 per awake minute (estimated).
- `standard-2` and up: more of each, at a higher rate.

Commit the change on `main` before step 8.

## 3. Turnstile production keys

1. In the Cloudflare dashboard, open Turnstile and the widget for `emberwalk.app`.
2. Check that its site key is the value of `TURNSTILE_SITE_KEY` in `workers/static/wrangler.jsonc`. If not, put the widget's site key there and commit it.
3. Copy the widget's secret key for step 4.

## 4. Worker secrets

Each command asks you to type the value. If wrangler says the Worker does not exist yet and offers to create it, answer yes.

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
(cd workers/pipeline && npx wrangler secret put META_API_KEY)
(cd workers/pipeline && npx wrangler secret put R2_ACCESS_KEY_ID)
(cd workers/pipeline && npx wrangler secret put R2_SECRET_ACCESS_KEY)
(cd workers/api && npx wrangler secret put R2_ACCESS_KEY_ID)
(cd workers/api && npx wrangler secret put R2_SECRET_ACCESS_KEY)
(cd workers/static && npx wrangler secret put TURNSTILE_SECRET)
(cd workers/static && npx wrangler secret put RESEND_API_KEY)
(cd workers/static && npx wrangler secret put POSTAL_FOOTER)
```

`POSTAL_FOOTER` is the sender name and postal address printed at the foot of every email; the mail code reads it from the first deploy.

The Get It Fixed Worker has four secrets of its own:

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
(cd workers/getfixed && npx wrangler secret put META_API_KEY)
(cd workers/getfixed && npx wrangler secret put RESEND_API_KEY)
(cd workers/getfixed && npx wrangler secret put MAIL_FOOTER)
(cd workers/getfixed && npx wrangler secret put OPTOUT_SECRET)
```

`MAIL_FOOTER` is the postal footer printed at the foot of every email to a crew. `OPTOUT_SECRET` is a new long random string that signs the take me off the list links; `openssl rand -hex 32` makes one.

Get It Fixed sends email from `jobs+TOKEN@emberwalk.app`, where TOKEN is different for every message, and two setup steps in the dashboards make that work:

1. Resend: open Domains and check that `emberwalk.app` is verified for sending (the SPF and DKIM records are in place). Turn click tracking and open tracking off for it. It is not confirmed whether the domain is already verified.
2. Cloudflare Email Routing for `emberwalk.app`: route `jobs+...@emberwalk.app` to the Worker `emberwalk-getfixed`, so crew replies reach it. The part after the plus sign changes every time, so a catch all rule may be needed. That is not confirmed; check it with a test email once the Worker is deployed.

Optional: `BASETEN_API_KEY` turns on the second check of each finding, on sample walks only while `SECOND_CHECK_REAL_WALKS` is `off` in `workers/pipeline/wrangler.jsonc`. Without it the pipeline skips that check and the deploy goes on; set it only if you have a Baseten key:

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
(cd workers/pipeline && npx wrangler secret put BASETEN_API_KEY)
```

## 5. Generate the unsubscribe secret

This makes a random value and stores it without showing it:

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
(cd workers/static && openssl rand -hex 32 | npx wrangler secret put UNSUBSCRIBE_SECRET)
```

## 6. R2 CORS for the phone app

The phone app uploads video parts straight to the `emberwalk-media` bucket and needs each part's ETag back.

1. In the Cloudflare dashboard, open R2, then `emberwalk-media`, then Settings, then CORS policy.
2. Add this policy and save:

```json
[
  {
    "AllowedOrigins": ["https://go.emberwalk.app"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 7. Keep the app private with Cloudflare Access

The app at `go.emberwalk.app` stays private until it is finished. Set this up before the first deploy, so the app is never public.

1. In the Cloudflare dashboard, open Zero Trust, then Access, then Applications, then Add an application, then Self hosted.
2. Application domain: `go.emberwalk.app`.
3. Add a policy that allows only your own email address, and save.

`emberwalk.app` (the landing page) stays public.

## 8. Deploy gate

With `CLOUDFLARE_API_TOKEN` set in your Terminal and Docker running:

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
sh tools/gate.sh --deploy > "$TMPDIR/deploy-gate.log" 2>&1; echo "GATE_EXIT=$?" >> "$TMPDIR/deploy-gate.log"; tail -3 "$TMPDIR/deploy-gate.log"
```

It must end `GATE_EXIT=0`. A green run writes `.deploy-checked` (ignored by git), which the deploy reads. The log goes to the system temp folder so the tree stays clean.

## 9. Remote migrations 0001 to 0012

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
(cd workers/api && npx wrangler d1 migrations apply emberwalk-db --remote)
```

It lists the migrations it will apply (0001 to 0012; numbers 0007 and 0010 were never used) and asks before it runs. Instead, `sh scripts/deploy.sh --remote-migrations` in step 10 runs this same command first.

## 10. Deploy

```sh
cd ~/"WORK/EmberWalk Master/emberwalk/EmberWalk"
sh scripts/deploy.sh
```

It refuses unless the branch is `main`, the tree is clean, the deploy gate passed at this commit, every config is on the EmberWalk account, the instance type is chosen and it runs in your own Terminal. It then prints the deploy order and asks you to type `deploy`; nothing remote runs, the migrations included, until you do. After that it checks the token belongs to the EmberWalk account and every secret in steps 4 and 5 is set (it says whether the optional `BASETEN_API_KEY` is set and goes on either way), deploys the pipeline, builds the phone app and the judge copy, deploys the API on `go.emberwalk.app` (the judge copy comes with the app at `go.emberwalk.app/judge/`), and deploys the landing page on `emberwalk.app`, printing each step. `sh scripts/deploy.sh pipeline api` stops before the landing page.

The landing page deploys without the judge copy: `emberwalk.app/judge/` stays empty until you decide where the judge copy lives. At `emberwalk.app/judge/` the judge copy's calls to `/api/` would reach the landing Worker, which does not answer them, so it would not work there as things stand.

## Known limits at the first deploy

- The limit of 3 walks per visitor per UTC day counts live walks only and trusts the visitor id the phone sends, so someone who clears the app's storage gets a new id and 3 more walks. The phone also says whether a new walk is a sample walk, and sample walks are not counted, so a phone that claims every walk is a sample is not held to the limit. The server's spend cap of $20 a day (`dailySpendUsd: 20`) is the hard backstop.
