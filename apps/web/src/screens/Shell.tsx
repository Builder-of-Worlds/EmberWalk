import type { ReactNode } from "react";
import { copy } from "../copy.ts";
import { portfolioOpen, shellWords as w } from "../draft-words.ts";
import { ROUTES } from "../router.ts";
import type { Route } from "../router.ts";

const SHIELD = "M60 8 L100 22 V58 C100 84 82 102 60 112 C38 102 20 84 20 58 V22 Z";

const Mark = () => (
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <path d={SHIELD} fill="#3d5a40" stroke="#f7f3e6" strokeWidth="5" strokeLinejoin="round" />
    <path d="M38 66 L60 44 L82 66 V86 H38 Z" fill="#f7f3e6" />
  </svg>
);

export const Top = ({ children }: { children: ReactNode }) => (
  <header className="top">
    <p className="wordmark" aria-label={copy.app.mark}>
      <Mark />
      {copy.app.name}
    </p>
    {children}
  </header>
);

const ICONS: Record<string, { name: string; d: string }> = {
  home: { name: "house", d: "M3 11 L12 3 L21 11 M5 9.5 V21 H19 V9.5" },
  walks: {
    name: "walker",
    d: "M11.6 4.2 A1.9 1.9 0 1 0 15.4 4.2 A1.9 1.9 0 1 0 11.6 4.2 M13 8.2 L11.4 14.4 L14.6 17.4 L15.4 21.6 M11.4 14.4 L9.4 18 L6.4 21.4 M12.8 9 L9.4 10.8 L7.8 13.8 M12.8 9 L15.2 11.8 L18 12.6",
  },
  fixes: {
    name: "wrench",
    d: "M17.91 3.55 L15.08 6.38 L17.62 8.92 L20.45 6.09 A5.5 5.5 0 0 1 12.91 13.35 L6.02 20.24 A1.6 1.6 0 0 1 3.76 17.98 L10.65 11.09 A5.5 5.5 0 0 1 17.91 3.55 Z",
  },
  homes: { name: "houses", d: "M2 12 L8 6 L14 12 M4 10 V20 H12 V10 M12 12 L17 7 L22 12 M14 20 H20 V11" },
  settings: {
    name: "gear",
    d: "M10.31 5.21 L10.66 2.49 L13.34 2.49 L13.69 5.21 A7 7 0 0 1 15.61 6 L17.78 4.33 L19.67 6.22 L18 8.39 A7 7 0 0 1 18.79 10.31 L21.51 10.66 L21.51 13.34 L18.79 13.69 A7 7 0 0 1 18 15.61 L19.67 17.78 L17.78 19.67 L15.61 18 A7 7 0 0 1 13.69 18.79 L13.34 21.51 L10.66 21.51 L10.31 18.79 A7 7 0 0 1 8.39 18 L6.22 19.67 L4.33 17.78 L6 15.61 A7 7 0 0 1 5.21 13.69 L2.49 13.34 L2.49 10.66 L5.21 10.31 A7 7 0 0 1 6 8.39 L4.33 6.22 L6.22 4.33 L8.39 6 A7 7 0 0 1 10.31 5.21 Z M15 12 A3 3 0 1 0 9 12 A3 3 0 1 0 15 12",
  },
};

type Tab = { key: keyof typeof ICONS; href: string; routes: Route[]; name: string };

const tabsFor = (landlord: boolean): Tab[] => [
  { key: "home", href: ROUTES.home, routes: landlord ? ["home"] : ["home", "homes", "property", "invite"], name: w.home },
  { key: "walks", href: ROUTES.walks, routes: ["walks", "results", "map", "finding", "report", "checking", "send"], name: w.walks },
  landlord ? { key: "homes", href: ROUTES.homes, routes: ["homes", "property", "invite"], name: w.homes } : { key: "fixes", href: ROUTES.history, routes: ["history", "fix", "approve", "inspection", "recheck"], name: w.fixes },
  { key: "settings", href: ROUTES.settings, routes: ["settings", "plan", "about", "signIn"], name: w.settings },
];

export const showsTabs = (route: Route): boolean => route !== "record" && route !== "tenantInvite";

export const Tabs = ({ route }: { route: Route }) => (
  <nav className="tabs" aria-label={w.nav}>
    {tabsFor(portfolioOpen()).map((tab) => (
      <a key={tab.key} href={tab.href} data-tab={tab.key} aria-current={tab.routes.includes(route) ? "page" : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true" data-icon={ICONS[tab.key]?.name}>
          <path d={ICONS[tab.key]?.d} />
        </svg>
        {tab.name}
      </a>
    ))}
  </nav>
);
