import type { Language } from "@emberwalk/shared";
import { createContext } from "react";

export type Choosing = { chosen: Language; choose: (language: Language) => void };

export const LanguageChoice = createContext<Choosing | null>(null);

const Choice = ({ code, name, chosen, choose }: Choosing & { code: Language; name: string }) => (
  <button type="button" lang={code} aria-pressed={chosen === code} onClick={() => choose(code)}>
    {name}
  </button>
);

export const LanguageSwitch = ({ chosen, choose, className = "language" }: Choosing & { className?: string }) => (
  <div className={className} role="group" aria-label="English, Español">
    <Choice code="en" name="English" chosen={chosen} choose={choose} />
    <span aria-hidden="true">·</span>
    <Choice code="es" name="Español" chosen={chosen} choose={choose} />
  </div>
);
