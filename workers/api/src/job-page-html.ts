// Draft words: they wait for the owner's approval.
export const jobPageWords = {
  title: "Quote Request",
  lead: "A homeowner sent you this through EmberWalk.",
  photos: "Photos",
  photo: (n: number) => `Photo ${n}`,
  reply: "To answer, reply to the text message that brought you here. It goes to the homeowner. The homeowner gives you the street address.",
  sample: "This is a sample request. No homeowner is waiting on it.",
  linkLine: "The work and the photos:",
  gone: "This request is no longer here. If you expected one, ask the homeowner to send it again.",
};

const esc = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const STYLE = [
  'body{margin:0;background:#fff;color:#2d2a22;font:400 17px/1.5 "Atkinson Hyperlegible",system-ui,sans-serif}',
  "main{max-width:640px;margin:0 auto;padding:20px}",
  "h1,h2,figcaption,.lead{text-align:center}",
  "h1{font-size:28px;margin:0 0 8px}h2{font-size:20px;margin:24px 0 8px}",
  ".body{white-space:pre-wrap;overflow-wrap:anywhere}",
  "figure{margin:0 0 16px}img{display:block;width:100%;height:auto;border-radius:8px}",
].join("");

export type Page = { body: string; sample: boolean; photoKeys: string[] };

export const pageHtml = (page: Page, base: string): string => {
  const photos = page.photoKeys.map((_, i) => `<figure><img src="${esc(`${base}/photo/${i}`)}" alt="${esc(jobPageWords.photo(i + 1))}"><figcaption>${esc(jobPageWords.photo(i + 1))}</figcaption></figure>`).join("");
  const sample = page.sample ? `<p class="lead" data-sample><strong>${esc(jobPageWords.sample)}</strong></p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(jobPageWords.title)}</title><style>${STYLE}</style></head><body><main><h1>${esc(jobPageWords.title)}</h1>${sample}<p class="lead">${esc(jobPageWords.lead)}</p><p class="body">${esc(page.body)}</p>${photos === "" ? "" : `<h2>${esc(jobPageWords.photos)}</h2>${photos}`}<p>${esc(jobPageWords.reply)}</p></main></body></html>`;
};
