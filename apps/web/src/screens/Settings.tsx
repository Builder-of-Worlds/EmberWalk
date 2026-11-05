import { useContext, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { OFFLINE } from "../account-api.ts";
import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { forgetInstallSeen, installHint, thisPhone } from "../install.ts";
import { deleteEverythingWords, settingsWords as w, signInWords } from "../draft-words.ts";
import { ROUTES } from "../router.ts";
import { LanguageChoice, LanguageSwitch } from "./LanguageSwitch.tsx";
import { PlanEntry } from "./Plan.tsx";
import { useSignedIn } from "./use-signed-in.ts";

const CONTACT = "https://emberwalk.app/contact.html";

const askLines =(): Record<string, string> => ({ [OFFLINE]: signInWords.noSignal, rate_limited: signInWords.tooMany, invalid_request: signInWords.badEmail, mail_failed: signInWords.mailFailed, unauthorized: w.notSignedIn });

const codeLines = (): Record<string, string> => ({ [OFFLINE]: signInWords.noSignal, code_wrong: signInWords.codeWrong, code_tries: signInWords.codeTries, link_expired: signInWords.codeEnded, link_used: signInWords.codeEnded, email_taken: w.taken, invalid_request: signInWords.codeWrong });

const ChangeEmail = ({ changed }: { changed: (email: string) => void }) => {
  const { account, prefs } = useDeps();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [line, setLine] = useState<string | null>(null);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setLine(null);
    const answer = await account.askEmailChange(email, prefs.language());
    if (answer.code !== undefined) return setLine(askLines()[answer.code] ?? signInWords.failed);
    setSent(true);
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setLine(null);
    const answer = await account.confirmEmailChange(email, code.replace(/\D/g, ""));
    if (answer.code !== undefined) return setLine(codeLines()[answer.code] ?? signInWords.failed);
    setOpen(false);
    setSent(false);
    setCode("");
    changed(answer.value.email);
  };

  if (!open)
    return (
      <button type="button" className="button" onClick={() => setOpen(true)}>
        {w.changeEmail}
      </button>
    );
  return (
    <form className="form change-email" onSubmit={(event) => void (sent ? confirm(event) : ask(event))}>
      {sent ? (
        <>
          <p role="status">{w.codeSent(email)}</p>
          <label htmlFor="change-code">{signInWords.codeLabel}</label>
          <input id="change-code" className="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} />
        </>
      ) : (
        <>
          <label htmlFor="new-email">{w.newEmail}</label>
          <input id="new-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </>
      )}
      <button type="submit" className="button primary">
        {sent ? w.confirm : w.sendCode}
      </button>
      {line === null ? null : <p role="alert">{line}</p>}
      <button type="button" className="button" onClick={() => (setOpen(false), setSent(false), setLine(null))}>
        {w.cancel}
      </button>
    </form>
  );
};

const Reminders = () => {
  const { account } = useDeps();
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void account.reminders().then((answer) => live && answer.code === undefined && setOn(answer.value));
    return () => {
      live = false;
    };
  }, [account]);
  const choose = async (chosen: boolean) => {
    setFailed(false);
    const answer = await account.setReminders(chosen);
    if (answer.code !== undefined) return setFailed(true);
    setOn(answer.value);
  };
  if (on === null) return null;
  return (
    <section className="panel" aria-labelledby="settings-reminders">
      <h2 id="settings-reminders">{w.reminders}</h2>
      <p id="settings-reminders-line">{w.remindersLine}</p>
      <div className="choice-pair reminders" role="group" aria-labelledby="settings-reminders-line">
        <button type="button" aria-pressed={on} onClick={() => void choose(true)}>
          {w.on}
        </button>
        <button type="button" aria-pressed={!on} onClick={() => void choose(false)}>
          {w.off}
        </button>
      </div>
      {failed ? <p role="alert">{w.remindersFailed}</p> : null}
    </section>
  );
};

const ReadAloud = () => {
  const { prefs } = useDeps();
  const [on, setOn] = useState(prefs.readsStepsAloud());
  const choose = (chosen: boolean) => {
    prefs.setReadsStepsAloud(chosen);
    setOn(chosen);
  };
  return (
    <section className="panel" aria-labelledby="settings-walk">
      <h2 id="settings-walk">{w.walk}</h2>
      <p id="settings-read-aloud">{w.readAloud}</p>
      <div className="choice-pair read-aloud" role="group" aria-labelledby="settings-read-aloud">
        <button type="button" aria-pressed={on} onClick={() => choose(true)}>
          {w.on}
        </button>
        <button type="button" aria-pressed={!on} onClick={() => choose(false)}>
          {w.off}
        </button>
      </div>
    </section>
  );
};

export const Settings = () => {
  const signedIn = useSignedIn(true);
  const language = useContext(LanguageChoice);
  const [email, setEmail] = useState<string | null>(null);
  const shown = email ?? signedIn.email;
  return (
    <main className="screen settings">
      <h1>{w.title}</h1>
      <section className="panel" aria-labelledby="settings-account">
        <h2 id="settings-account">{w.account}</h2>
        {shown === null ? (
          <>
            <p>{w.notSignedIn}</p>
            <a className="button primary" href={ROUTES.signIn}>
              {signInWords.entry}
            </a>
          </>
        ) : (
          <>
            <p className="signed-in" role="status">
              {email === null ? signInWords.signedInAs(shown) : w.changed(shown)}
            </p>
            <ChangeEmail changed={setEmail} />
            <button type="button" className="button" onClick={() => void signedIn.signOut()}>
              {signInWords.signOut}
            </button>
            <button type="button" className="button" onClick={() => void signedIn.signOutEverywhere()}>
              {signInWords.signOutEverywhere}
            </button>
          </>
        )}
        {signedIn.line === null ? null : <p role="alert">{signedIn.line}</p>}
      </section>
      {language === null ? null : (
        <section className="panel" aria-labelledby="settings-language">
          <h2 id="settings-language">{w.language}</h2>
          <LanguageSwitch chosen={language.chosen} choose={language.choose} className="language-choice" />
        </section>
      )}
      {shown === null ? null : <Reminders />}
      <ReadAloud />
      <PlanEntry />
      {installHint({ ...thisPhone(), seen: () => false }) === null ? null : (
        <button
          type="button"
          className="button"
          onClick={() => {
            forgetInstallSeen();
            window.location.hash = ROUTES.home;
          }}
        >
          {w.install}
        </button>
      )}
      <section className="panel" aria-labelledby="settings-help">
        <h2 id="settings-help">{w.help}</h2>
        <a className="button" href={ROUTES.how}>
          {copy.how.title}
        </a>
        <a className="button" href={CONTACT} target="_blank" rel="noopener">
          {w.contact}
        </a>
      </section>
      <a className="button" href={ROUTES.about}>
        {deleteEverythingWords.entry}
      </a>
    </main>
  );
};
