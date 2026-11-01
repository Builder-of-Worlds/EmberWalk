const ATTR = "data-launch-date";

export function launchDateShown(env: object): boolean {
  return (env as { LAUNCH_DATE_SHOWN?: unknown }).LAUNCH_DATE_SHOWN === "on";
}

export function applyLaunchDate(response: Response, shown: boolean): Response {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const rewritten = new HTMLRewriter()
    .on(`[${ATTR}]`, {
      element(element) {
        const dateless = element.getAttribute(ATTR) === "off";
        if (dateless === shown) element.remove();
        else element.removeAttribute(ATTR);
      },
    })
    .transform(response);
  const out = new Response(rewritten.body, rewritten);
  out.headers.delete("etag");
  return out;
}
