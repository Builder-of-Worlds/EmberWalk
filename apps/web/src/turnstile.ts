const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Widgets = {
  render(box: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};

type Holder = { turnstile?: Widgets };

export type PersonCheck = { reset(): void; stop(): void };

export const startPersonCheck = (box: HTMLElement, siteKey: string, onToken: (token: string) => void): PersonCheck => {
  const holder = window as unknown as Holder;
  let id: string | null = null;
  let stopped = false;
  const render = () => {
    if (stopped || holder.turnstile === undefined) return;
    id = holder.turnstile.render(box, {
      sitekey: siteKey,
      appearance: "interaction-only",
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  };
  if (holder.turnstile !== undefined) render();
  else {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = render;
    document.head.append(script);
  }
  return {
    reset: () => {
      onToken("");
      if (id !== null) holder.turnstile?.reset(id);
    },
    stop: () => {
      stopped = true;
      if (id !== null) holder.turnstile?.remove(id);
    },
  };
};
