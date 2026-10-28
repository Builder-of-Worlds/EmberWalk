import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export type FixtureServer = {
  port: number;
  files: Map<string, Buffer>;
  puts: Map<string, Buffer>;
  failPuts: Set<string>;
  delays: Map<string, number>;
  chunked: Set<string>;
  requested: (path: string) => Promise<void>;
  close: () => Promise<void>;
};

export const startFixtureServer = async (): Promise<FixtureServer> => {
  const files = new Map<string, Buffer>();
  const puts = new Map<string, Buffer>();
  const failPuts = new Set<string>();
  const delays = new Map<string, number>();
  const chunked = new Set<string>();
  const waiting = new Map<string, (() => void)[]>();

  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    for (const wake of waiting.get(path) ?? []) wake();
    waiting.delete(path);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (failPuts.has(path)) {
          res.writeHead(500).end();
          return;
        }
        puts.set(path, Buffer.concat(chunks));
        res.writeHead(200).end();
      });
      return;
    }
    const file = files.get(path);
    const respond = () => {
      if (file === undefined) {
        res.writeHead(404).end();
        return;
      }
      if (chunked.has(path)) {
        res.writeHead(200);
        res.write(file.subarray(0, file.length / 2));
        setTimeout(() => res.end(file.subarray(file.length / 2)), 50);
        return;
      }
      res.writeHead(200, { "content-length": file.length }).end(file);
    };
    const delay = delays.get(path);
    if (delay === undefined) respond();
    else setTimeout(respond, delay);
  });

  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    files,
    puts,
    failPuts,
    delays,
    chunked,
    requested: (path) =>
      new Promise<void>((resolve) => {
        waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
