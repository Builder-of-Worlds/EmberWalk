import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { OFFLINE } from "../account-api.ts";
import { useDeps } from "../deps.ts";
import type { PortfolioApi } from "../portfolio-api.ts";
import { openPortfolio, signInWords as w } from "../draft-words.ts";
import { ROUTES } from "../router.ts";
import { startPersonCheck } from "../turnstile.ts";
import type { PersonCheck } from "../turnstile.ts";

const askLines = (): Record<string, string> => ({
  [OFFLINE]: w.noSignal,
  not_set_up: w.notSetUp,
  mail_failed: w.mailFailed,
  rate_limited: w.tooMany,
  invalid_request: w.badEmail,
  check_failed: w.checkFailed,
  check_unavailable: w.checkFailed,
});

const linkLines = (): Record<string, string> => ({
  [OFFLINE]: w.noSignal,
  link_expired: w.linkExpired,
  link_used: w.linkUsed,
  link_invalid: w.linkInvalid,
  invalid_request: w.linkInvalid,
});

const codeLines = (): Record<string, string> => ({
  [OFFLINE]: w.noSignal,
  code_wrong: w.codeWrong,
  code_tries: w.codeTries,
  link_expired: w.codeEnded,
  link_used: w.codeEnded,
  invalid_request: w.codeWrong,
});

const arrive = async (portfolio: PortfolioApi): Promise<void> => {
  openPortfolio();
  const homes = await portfolio.homes();
  window.location.hash = homes.code === undefined && homes.value.length > 0 ? ROUTES.homes : ROUTES.home;
};

const Landing = ({ token }: { token: string }) => {
  const { account, portfolio } = useDeps();
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void account.verify(token).then(async (answer) => {
      if (!live) return;
      if (answer.code !== undefined) return setLine(linkLines()[answer.code] ?? w.failed);
      await arrive(portfolio);
    });
    return () => {
      live = false;
    };
  }, [account, portfolio, token]);

  return (
    <main className="screen sign-in">
      <h1>{w.title}</h1>
      <p role="status">{line ?? w.checking}</p>
      {line === null ? null : (
        <a className="button" href={ROUTES.signIn}>
          {w.askAgain}
        </a>
      )}
    </main>
  );
};

const Code = ({ email, again }: { email: string; again: () => void }) => {
  const { account, portfolio } = useDeps();
  const [code, setCode] = useState("");
  const [line, setLine] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLine(null);
    const answer = await account.enterCode(email, code.replace(/\D/g, ""));
    if (answer.code !== undefined) return setLine(codeLines()[answer.code] ?? w.failed);
    await arrive(portfolio);
  };

  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <p role="status">{w.codeSent(email)}</p>
      <label htmlFor="code">{w.codeLabel}</label>
      <input id="code" className="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} />
      <button type="submit" className="button primary">
        {w.enterCode}
      </button>
      {line === null ? null : <p role="alert">{line}</p>}
      <button type="button" className="button" onClick={again}>
        {w.newCode}
      </button>
    </form>
  );
};

const Ask = () => {
  const { account, prefs } = useDeps();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const check = useRef<PersonCheck | null>(null);

  useEffect(() => {
    let live = true;
    void account.siteKey().then((answer) => {
      if (!live) return;
      if (answer.code !== undefined) return setLine(askLines()[answer.code] ?? w.failed);
      if (box.current !== null) check.current = startPersonCheck(box.current, answer.value, setToken);
    });
    return () => {
      live = false;
      check.current?.stop();
      check.current = null;
    };
  }, [account]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (token === "") return setLine(w.waitForCheck);
    setLine(null);
    const answer = await account.ask(email, token, prefs.language());
    if (answer.code === undefined) return setSent(true);
    setLine(askLines()[answer.code] ?? w.failed);
    check.current?.reset();
  };

  return (
    <main className="screen sign-in">
      <h1>{w.title}</h1>
      {sent ? <Code email={email} again={() => (check.current?.reset(), setSent(false))} /> : null}
      <form className="form" hidden={sent} onSubmit={(event) => void submit(event)}>
        <p>{w.lead}</p>
        <label htmlFor="email">{w.emailLabel}</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div ref={box} className="person-check" />
        <button type="submit" className="button primary">
          {w.send}
        </button>
        {line === null ? null : <p role="alert">{line}</p>}
      </form>
      <a className="button" href={ROUTES.home}>
        {w.back}
      </a>
    </main>
  );
};

export const SignIn = ({ signInToken }: { signInToken: string | null }) => (signInToken === null ? <Ask /> : <Landing token={signInToken} />);
