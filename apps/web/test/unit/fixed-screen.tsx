import { App } from "../../src/App.tsx";
import { fixedApi } from "../../src/fixed-api.ts";
import type { Deps } from "../../src/deps.ts";
import { testDeps } from "./fakes.ts";
import { standInFetch, WALK } from "./fixed-fakes.ts";
import type { StandIn } from "./fixed-fakes.ts";
import { render, settle } from "./render.ts";
import { finding, liveFindingId, walk } from "./result-fakes.ts";

export const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

export const RESULTS = walk(
  [finding(liveFindingId(1), { instruction: "Move the wood pile." }), finding(liveFindingId(2), { instruction: "Clear the dry brush." })],
  [],
  { id: WALK },
);

export const mount = async (hash: string, state: StandIn, over: Partial<Deps> = {}) => {
  window.location.hash = hash;
  const deps = testDeps({
    fixed: fixedApi("https://ember.test", standInFetch(state), () => "v"),
    results: async (id) => (id === WALK ? RESULTS : null),
    ...over,
  });
  const view = await render(<App deps={deps} />);
  return { ...view, deps };
};

export const find = <T extends Element = HTMLElement>(host: HTMLElement, selector: string): T => {
  const found = host.querySelector<T>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
};

export const named = (host: HTMLElement, text: string, tag = "button, a"): HTMLElement => {
  const found = [...host.querySelectorAll<HTMLElement>(tag)].find((el) => el.textContent === text);
  if (found === undefined) throw new Error(`no ${tag} "${text}"`);
  return found;
};

export const has = (host: HTMLElement, text: string, tag = "button, a"): boolean =>
  [...host.querySelectorAll(tag)].some((el) => el.textContent === text);

export const tap = async (host: HTMLElement, text: string, tag = "button, a") => {
  const target = named(host, text, tag);
  await settle(() => target.click());
};

export const typeInto = async (field: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await settle(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

export const lines = (host: HTMLElement, selector: string): (string | null)[] => [...host.querySelectorAll(selector)].map((el) => el.textContent);

export const callsTo = (state: StandIn, method: string, path: string) => state.calls.filter((c) => c.method === method && c.path === path);
