import { describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { deps, fakeMailer, fakeVerify, testEnv } from "./helpers";

const ADDRESS = "100 Example Road, Sample City, NV 00000";

function get(path: string, address?: string) {
  const env = testEnv(address === undefined ? {} : { POSTAL_ADDRESS: address });
  return handle(new Request(`https://emberwalk.app${path}`), env, deps(fakeVerify(), fakeMailer()));
}

describe("postal address on the Contact page", () => {
  it("prints the address the Worker is given under the legal name, and nothing else carries a marker", async () => {
    const response = await get("/contact", ADDRESS);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`Mail: The Arbiter Bibendi LLC, ${ADDRESS}`);
    expect(html).not.toContain("data-postal-address");
    expect(html).not.toContain("{{");
  });

  it("prints a changed address as given", async () => {
    const html = await (await get("/contact", "7 Other Lane, Elsewhere, NV 11111")).text();
    expect(html).toContain("Mail: The Arbiter Bibendi LLC, 7 Other Lane, Elsewhere, NV 11111");
    expect(html).not.toContain(ADDRESS);
  });

  it("joins the lines of a multi-line address with commas", async () => {
    const html = await (await get("/contact", "100 Example Road\nSuite 1\nSample City, NV 00000")).text();
    expect(html).toContain("Mail: The Arbiter Bibendi LLC, 100 Example Road, Suite 1, Sample City, NV 00000");
  });

  it("prints the characters $&, $' and $` in an address as typed, not as replacement patterns", async () => {
    const html = await (await get("/contact", "Box $& $' $` $$ 5")).text();
    expect(html).toContain("Mail: The Arbiter Bibendi LLC, Box $&amp; $&#39; $` $$ 5");
    expect(html).not.toContain("data-postal-address");
  });

  it("escapes markup in the address", async () => {
    const html = await (await get("/contact", `1 <b>Road</b> & "Co"`)).text();
    expect(html).toContain("1 &lt;b&gt;Road&lt;/b&gt; &amp; &quot;Co&quot;");
    expect(html).not.toContain("<b>Road</b>");
  });

  it.each([["missing", undefined], ["empty", ""], ["blank", "  \n "]])("refuses to serve the Contact page when the address is %s, and shows no placeholder", async (_name, address) => {
    const response = await get("/contact", address);
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain("data-postal-address");
    expect(text).not.toContain("Mail:");
    expect(text).not.toContain("{{");
  });

  it("serves every other page without an address", async () => {
    for (const path of ["/", "/pricing", "/terms", "/privacy", "/refunds", "/about", "/security", "/accessibility", "/no-such-page"]) {
      const response = await get(path);
      const text = await response.text();
      expect(response.status, path).not.toBe(503);
      expect(text, path).not.toContain("data-postal-address");
    }
  });
});
