import { describe, expect, it } from "vitest";
import { parseMail, TEXT_LIMIT } from "../src/mime.ts";

const mail = (headers: string[], body: string): string => [...headers, "", body].join("\r\n");

describe("parseMail", () => {
  it("reads a plain reply and drops the quoted request", () => {
    const raw = mail(["From: crew@example.com", "Subject: Re: Quote request", "Content-Type: text/plain; charset=utf-8"], "We can do it for $450 next Tuesday.\r\n\r\nOn Mon, Oct 26, 2026 at 9:00 AM EmberWalk wrote:\r\n> Hello, could you quote this?");
    expect(parseMail(raw)).toEqual({ subject: "Re: Quote request", text: "We can do it for $450 next Tuesday." });
  });

  it("decodes quoted-printable and folded, encoded subjects", () => {
    const raw = mail(["Subject: =?UTF-8?Q?Re:_Caf=C3=A9_quote?=", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable"], "Price: $300 =\r\nfor the brush. Caf=C3=A9 owner.");
    expect(parseMail(raw)).toEqual({ subject: "Re: Café quote", text: "Price: $300 for the brush. Café owner." });
  });

  it("takes the plain part of a multipart reply and skips attachments", () => {
    const body = [
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: base64",
      "",
      btoa("Friday works for us."),
      "--inner",
      "Content-Type: text/html",
      "",
      "<p>Friday works for us.</p>",
      "--inner--",
      "--outer",
      "Content-Type: text/plain",
      "Content-Disposition: attachment; filename=terms.txt",
      "",
      "Attached terms",
      "--outer--",
    ].join("\r\n");
    const raw = mail(["Subject: Re", 'Content-Type: multipart/mixed; boundary="outer"'], body);
    expect(parseMail(raw).text).toBe("Friday works for us.");
  });

  it("falls back to the html part as text, and to empty text for anything else", () => {
    const html = mail(["Content-Type: text/html"], "<div>Can you send<br>the address?</div><script>x()</script>");
    expect(parseMail(html)).toEqual({ subject: null, text: "Can you send\nthe address?" });
    expect(parseMail(mail(["Content-Type: image/jpeg"], "binary")).text).toBe("");
    expect(parseMail(mail(['Content-Type: multipart/mixed'], "--x\r\n\r\nhi\r\n--x--")).text).toBe("");
  });

  it("keeps at most the text limit", () => {
    expect(parseMail(mail(["Content-Type: text/plain"], "a".repeat(TEXT_LIMIT + 50))).text).toHaveLength(TEXT_LIMIT);
  });
});
