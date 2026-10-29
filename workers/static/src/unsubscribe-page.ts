export type UnsubscribeOutcome = "removed" | "invalid" | "failed";

const WORDS: Record<UnsubscribeOutcome, { heading: string; text: string }> = {
  removed: {
    heading: "You're unsubscribed",
    text: "We've removed your email address from the EmberWalk list. You won't hear from us again.",
  },
  invalid: {
    heading: "That link doesn't work",
    text: "This unsubscribe link isn't valid. To be taken off the list, write to hello@emberwalk.app and we'll do it for you.",
  },
  failed: {
    heading: "Something went wrong",
    text: "We couldn't finish that. Please try again, or write to hello@emberwalk.app.",
  },
};

const STATUS: Record<UnsubscribeOutcome, number> = { removed: 200, invalid: 400, failed: 500 };

export function unsubscribePage(outcome: UnsubscribeOutcome): Response {
  const { heading, text } = WORDS[outcome];
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>EmberWalk | ${heading}</title>
  <link rel="icon" href="data:,">
  <link rel="preload" href="/fonts/atkinson-hyperlegible-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/atkinson-hyperlegible-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/site.css">
  <script src="/boot.js"></script>
  <script type="module" src="/site.js"></script>
</head>
<body>
  <header class="topbar">
    <a class="wordmark" href="/">EmberWalk</a>
  </header>
  <main>
    <section class="block">
      <div class="column card">
        <h1 class="rise">${heading}</h1>
        <p class="lead rise">${text}</p>
      </div>
    </section>
  </main>
</body>
</html>
`;
  return new Response(html, {
    status: STATUS[outcome],
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
