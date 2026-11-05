function applySwitch(response: Response, attr: string, shown: boolean): Response {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const rewritten = new HTMLRewriter()
    .on(`[${attr}]`, {
      element(element) {
        if (shown) element.removeAttribute(attr);
        else element.remove();
      },
    })
    .transform(response);
  const out = new Response(rewritten.body, rewritten);
  out.headers.delete("etag");
  return out;
}

export const applyAppLink = (response: Response, env: object): Response => applySwitch(response, "data-app-link", (env as { APP_LINK_SHOWN?: unknown }).APP_LINK_SHOWN === "on");

export const applyFilmSlot = (response: Response, env: object): Response => applySwitch(response, "data-film-slot", (env as { FILM_SHOWN?: unknown }).FILM_SHOWN === "on");
