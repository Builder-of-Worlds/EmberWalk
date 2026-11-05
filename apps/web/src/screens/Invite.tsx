import { useState } from "react";
import { OFFLINE } from "../account-api.ts";
import { shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { inviteWords as w, portfolioWords } from "../draft-words.ts";
import { propertyFor, ROUTES, tenantInviteFor } from "../router.ts";

const shareOf = (): ((data: ShareData) => Promise<void>) | null => (typeof navigator.share === "function" ? (data) => navigator.share(data) : null);

export const Invite = ({ propertyId }: { propertyId: string | null }) => {
  const { portfolio } = useDeps();
  const [made, setMade] = useState<{ link: string; day: string } | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const share = shareOf();

  const make = async () => {
    setLine(null);
    const answer = await portfolio.invite(propertyId ?? "");
    if (answer.code === "unauthorized") {
      window.location.hash = ROUTES.signIn;
      return;
    }
    if (answer.code !== undefined) {
      setLine(answer.code === OFFLINE ? w.noSignal : answer.code === "not_found" || answer.code === "property_removed" ? portfolioWords.notFound : portfolioWords.failed);
      return;
    }
    setMade({ link: `${window.location.origin}/${tenantInviteFor(answer.value.code)}`, day: shortDay(answer.value.expiresAt.slice(0, 10)) });
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(made?.link ?? "").catch(() => undefined);
    setCopied(true);
  };

  return (
    <main className="screen invite">
      <h1>{w.title}</h1>
      <p>{w.lead}</p>
      {made === null ? (
        <button type="button" className="button primary" onClick={() => void make()}>
          {w.make}
        </button>
      ) : (
        <>
          <h2>{w.ready}</h2>
          <p className="invite-link" data-part="invite-link">
            {made.link}
          </p>
          <p>{w.ends(made.day)}</p>
          <button type="button" className="button primary" onClick={() => void copy()}>
            {w.copy}
          </button>
          {copied ? <p role="status">{w.copied}</p> : null}
          {share === null ? null : (
            <button type="button" className="button" onClick={() => void share({ url: made.link }).catch(() => undefined)}>
              {w.share}
            </button>
          )}
        </>
      )}
      {line === null ? null : <p role="alert">{line}</p>}
      <a className="button" href={propertyId === null ? ROUTES.homes : propertyFor(propertyId)}>
        {portfolioWords.backHomes}
      </a>
    </main>
  );
};
