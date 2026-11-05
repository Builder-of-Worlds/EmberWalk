import type { Language } from "@emberwalk/shared";

let current: Language = "en";

export const language = (): Language => current;

export const setLanguage = (chosen: Language): void => {
  current = chosen;
};

export const follow = <T extends object>(en: T, es: unknown): T =>
  new Proxy(en, { get: (_, key) => Reflect.get(current === "es" ? (es as object) : en, key) });

export const pick =
  <A extends unknown[], R>(en: (...args: A) => R, es: (...args: A) => R) =>
  (...args: A): R =>
    current === "es" ? es(...args) : en(...args);
