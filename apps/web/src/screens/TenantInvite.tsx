import { useEffect, useState } from "react";
import type { InviteLookup } from "@emberwalk/shared";
import { OFFLINE } from "../account-api.ts";
import { useDeps } from "../deps.ts";
import { inviteWords as w } from "../draft-words.ts";
import { ROUTES, WALK_START } from "../router.ts";
import { holdClaim } from "../walk-claim.ts";

const refused = (): Record<NonNullable<InviteLookup["reason"]>, string> => ({ expired: w.expired, used: w.used, property_removed: w.removed });

export const TenantInvite = ({ inviteCode }: { inviteCode: string | null }) => {
  const { portfolio } = useDeps();
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void portfolio.lookup(inviteCode ?? "").then((answer) => {
      if (!live) return;
      if (answer.code !== undefined) return setLine(answer.code === OFFLINE ? w.noSignal : w.unknown);
      if (answer.value.good) return setInvite(answer.value);
      setLine(answer.value.reason === null ? w.unknown : refused()[answer.value.reason]);
    });
    return () => {
      live = false;
    };
  }, [portfolio, inviteCode]);

  return (
    <main className="screen tenant-invite">
      <h1>{w.tenantTitle}</h1>
      {invite === null ? null : (
        <>
          <p className="status-line">{invite.label}</p>
          <p>{w.tenantLead}</p>
          <p>{w.tenantShare}</p>
          <a className="button primary" href={WALK_START} onClick={() => holdClaim({ inviteCode: inviteCode ?? "" })}>
            {w.start}
          </a>
        </>
      )}
      {line === null ? null : <p role="alert">{line}</p>}
      <a className="button" href={ROUTES.home}>
        {w.back}
      </a>
    </main>
  );
};
