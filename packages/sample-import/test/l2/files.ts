import type { RenderSource } from "../../src/index.ts";

export const hostRender = (files: Fetcher): RenderSource => {
  const ask = (name: string, query: string): Promise<Response> => files.fetch(`http://render/${name}${query}`);
  return {
    async json(name) {
      return (await ask(name, "")).json();
    },
    async video(fileName) {
      const sized = await ask(fileName, "?op=size");
      if (!sized.ok) return null;
      const { size } = (await sized.json()) as { size: number };
      return {
        sizeBytes: size,
        sha256: async () => ((await (await ask(fileName, "?op=sha256")).json()) as { sha256: string }).sha256,
        read: async (from, to) => new Uint8Array(await (await ask(fileName, `?op=read&from=${from}&to=${to}`)).arrayBuffer()),
      };
    },
  };
};
