import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { App } from "./App.tsx";
import type { Deps } from "./deps.ts";

export const SW_URL = "sw.js";

type Workers = { register(url: string): Promise<unknown> };

export const boot = (doc: Document, workers: Workers | undefined, production: boolean, deps: Deps): Root => {
  const host = doc.getElementById("root");
  if (host === null) throw new Error("index.html has no #root element");
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <App deps={deps} />
    </StrictMode>,
  );
  if (production && workers !== undefined) void workers.register(SW_URL);
  return root;
};
