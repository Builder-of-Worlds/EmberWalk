import { useEffect, useState } from "react";
import { OFFLINE } from "../account-api.ts";
import type { Asked } from "../account-api.ts";
import { useDeps } from "../deps.ts";
import { closePortfolio, signInWords as w } from "../draft-words.ts";
import { ROUTES } from "../router.ts";

const phoneLines = (): Record<string, string> => ({ other_phone: w.notLinked, held: w.heldPhone });

export const useSignedIn = (ask: boolean) => {
  const { account, forgetSent } = useDeps();
  const [email, setEmail] = useState<string | null>(null);
  const [phoneLine, setPhoneLine] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!ask) return;
    let live = true;
    void account.me().then(async (answer) => {
      if (!live || answer.code !== undefined) return;
      setEmail(answer.value.email);
      const phone = await account.linkPhone();
      if (live && phone.code === undefined) setPhoneLine(phone.value.reason === null ? null : (phoneLines()[phone.value.reason] ?? null));
    });
    return () => {
      live = false;
    };
  }, [account, ask]);

  const leave = async (asked: Promise<Asked<true>>) => {
    setLine(null);
    const answer = await asked;
    if (answer.code !== undefined) return setLine(answer.code === OFFLINE ? w.noSignal : answer.code === "walk_busy" ? w.walkBusy : w.failed);
    try {
      await forgetSent();
    } catch {
      setLine(w.failed);
    }
    closePortfolio();
    window.location.hash = ROUTES.signIn;
  };

  return { email, phoneLine, line, signOut: () => leave(account.signOut()), signOutEverywhere: () => leave(account.signOutEverywhere()) };
};
