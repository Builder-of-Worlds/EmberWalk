import { useState } from "react";
import type { FormEvent } from "react";
import { useDeps } from "../deps.ts";
import { crewWords as words, phoneOf } from "../draft-words.ts";
import { ROUTES } from "../router.ts";
import { useAction } from "../use-load.ts";
import { Problem } from "./Failed.tsx";

type Field = { id: string; label: string; value: string; set: (value: string) => void; type?: string; mode?: "numeric"; auto: string; max: number };

const Line = ({ id, label, value, set, type = "text", mode, auto, max }: Field) => (
  <>
    <label htmlFor={id}>{label}</label>
    <input id={id} type={type} inputMode={mode} autoComplete={auto} maxLength={max} required={id !== "crew-phone"} value={value} onChange={(e) => set(e.target.value)} />
  </>
);

const CrewForm = () => {
  const { fixed } = useDeps();
  const action = useAction();
  const [name, setName] = useState("");
  const [license, setLicense] = useState("");
  const [licenseClass, setLicenseClass] = useState<"C-27" | "C-49">("C-27");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const typed = phone.trim();
    const number = typed === "" ? null : phoneOf(typed);
    if (!agreed) return setSaid(words.mustAgree);
    if (typed !== "" && number === null) return setSaid(words.badPhone);
    setSaid(null);
    const answer = await action.run(() =>
      fixed.crewSignup({ businessName: name.trim(), licenseNumber: license.trim(), licenseClass, email: email.trim(), phone: number, zip: zip.trim(), agreed: true }),
    );
    if (answer === null) return;
    if (answer.status === "check_email") return setDone(true);
    setSaid(answer.status === "license_listed" ? words.licenseListed : words.licenseWaiting);
  };

  if (done) return <p role="status">{words.checkEmail}</p>;
  return (
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <Line id="crew-name" label={words.name} value={name} set={setName} auto="organization" max={120} />
      <Line id="crew-license" label={words.license} value={license} set={setLicense} mode="numeric" auto="off" max={12} />
      <label htmlFor="crew-class">{words.licenseClass}</label>
      <select id="crew-class" value={licenseClass} onChange={(e) => setLicenseClass(e.target.value as "C-27" | "C-49")}>
        <option value="C-27">{words.classes["C-27"]}</option>
        <option value="C-49">{words.classes["C-49"]}</option>
      </select>
      <Line id="crew-email" label={words.email} value={email} set={setEmail} type="email" auto="email" max={254} />
      <Line id="crew-phone" label={words.phone} value={phone} set={setPhone} type="tel" auto="tel" max={20} />
      <Line id="crew-zip" label={words.zip} value={zip} set={setZip} mode="numeric" auto="postal-code" max={5} />
      <label className="agree" htmlFor="crew-agree">
        <input id="crew-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{words.agree}</span>
      </label>
      {said === null ? null : <p role="status">{said}</p>}
      {action.code === "conflict" ? <p role="status">{words.notListed}</p> : null}
      {action.code === null || action.code === "conflict" ? null : <Problem code={action.code} />}
      {action.busy ? <p role="status">{words.sending}</p> : null}
      <button className="button primary" type="submit" disabled={action.busy}>
        {words.submit}
      </button>
    </form>
  );
};

export const CrewSignup = () => (
  <main className="screen fix crew-signup">
    <h1>{words.title}</h1>
    <p>{words.lead}</p>
    <CrewForm />
    <a className="button" href={ROUTES.about}>
      {words.back}
    </a>
  </main>
);
