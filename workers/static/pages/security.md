# Security
Description: Where EmberWalk runs, how the site and your walks are protected, what Delete Everything erases and what it keeps.
Last updated: 2026-10-31

## Where EmberWalk runs

Cloudflare hosts EmberWalk: the site, the app's servers, the database, the file storage and the email routing.

## The website

Every page of emberwalk.app tells your browser to use HTTPS only. It loads scripts only from this site and from Cloudflare Turnstile, which checks that a person is using the sign up form, and it cannot be shown inside another site's frame. The site sets no cookies of its own and loads no analytics.

## Your walks

There is no account, name or password. Your walks are tied to a random code kept on your phone.

- Video of a walk is deleted when the walk finishes. A sweep every hour also deletes any original video still there after 24 hours.
- Sound is cut from the video, sent for transcription and deleted straight after.
- The proof pictures EmberWalk keeps are blurred where it finds people, faces, license plates, house numbers, street signs and mailboxes. Photos you take to recheck a fix are not blurred.
- Pictures go to Meta's models to be checked before the blur is applied. The [Privacy policy](/privacy) says what each company receives.
- Your phone's position is read once and only a rule area such as ca is kept. Your coordinates are never sent.

## Meta and the paid setting

EmberWalk's code refuses to send real walk content to Meta unless billing for Meta's service is set to paid.

## Payments

Payments are made on a page Stripe hosts. EmberWalk never sees or stores your card number.

## Delete Everything

Delete Everything in the app erases the walks stored under your phone's code: the video leftovers, clips, proof pictures, recheck photos, findings, marks, Get It Fixed jobs, messages and crew replies. It is refused while a walk is still being checked.

It does not erase:

- cost records of the model calls, which are kept without the link to your walk
- model answers saved without a walk
- the list of crews that asked not to be emailed again
- the sign up list, which the unsubscribe link in every email removes
- emails already delivered, and anything Meta or Baseten kept on their side

The [Privacy policy](/privacy) has the full list.

## Report a problem

To report a security problem, write to us. The same address is in our [security.txt](https://emberwalk.app/.well-known/security.txt).

{{contact}}
