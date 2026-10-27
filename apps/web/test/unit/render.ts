import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const render = async (node: ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    text: () => host.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
};

export const settle = async (work: () => unknown = () => undefined) => {
  await act(async () => {
    await work();
  });
};
