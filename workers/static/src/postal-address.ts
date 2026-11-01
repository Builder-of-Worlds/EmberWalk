const MARK = "<span data-postal-address></span>";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function printable(address: string): string {
  const lines = address.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  return lines.join(", ").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export async function applyPostalAddress(response: Response, address: string | undefined): Promise<Response> {
  if (response.body === null || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const page = await response.text();
  if (!page.includes(MARK)) return new Response(page, response);
  const shown = printable(address ?? "");
  if (shown === "") return new Response("This page is not available right now.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const out = new Response(page.replaceAll(MARK, () => shown), response);
  out.headers.delete("etag");
  out.headers.delete("content-length");
  return out;
}
