import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { explain, type ExplainAnswer } from "../src/index.ts";
import keepFixture from "./fixtures/stand-in-keep.json" with { type: "json" };
import { liveRecord, recordFile, writeRecord } from "./record.ts";
import { NOW, standIn, yardTwoInput } from "./support.ts";

const KEEP: ExplainAnswer = { findings: keepFixture.findings as ExplainAnswer["findings"] };

const folder = () => mkdtemp(path.join(tmpdir(), "explain-record-"));

describe("the record a live run keeps", () => {
  it("holds every finding with its wording and sentence, and the ledger's cost exactly", async () => {
    const { client, ledger, requests } = standIn([KEEP], { tokens: 1234 });
    const input = yardTwoInput();
    const out = await explain(client, input);

    const record = liveRecord(NOW, "test yard 2", out, ledger, requests.length);

    expect(record.findings).toEqual(
      out.results.map((r) => ({ findingId: r.findingId, wording: r.wording, instruction: r.instruction, verdict: r.verdict, reason: r.reason })),
    );
    expect(record.findings).toHaveLength(input.findings.length);
    expect(record.requests).toBe(1);
    expect(record.models).toEqual([...new Set(ledger.entries.map((e) => e.model))]);
    expect(record.entries).toEqual(ledger.entries.map((e) => ({ model: e.model, totalUsd: e.totalUsd, cached: e.cached })));
    expect(record.costUsd).toBeGreaterThan(0);
    expect(record.costUsd).toBe(ledger.entries.reduce((sum, e) => sum + Math.round(e.totalUsd * 1e9), 0) / 1e9);
    expect(record).toMatchObject({ at: NOW.toISOString(), yard: "test yard 2", refused: null });
  });

  it("keeps what the run was given: its label, the spoken turns and the seconds the frames were cut at", async () => {
    const { client, ledger, requests } = standIn([KEEP]);
    const run = { label: "frames and turns", turns: [{ t: 2, text: "It is firewood." }], frameSeconds: [3.5, 9] };

    const record = liveRecord(NOW, "test yard 2", await explain(client, yardTwoInput()), ledger, requests.length, run);

    expect(record.run).toEqual(run);
    expect(liveRecord(NOW, "test yard 2", await explain(client, yardTwoInput()), ledger, requests.length).run).toEqual({
      label: "",
      turns: [],
      frameSeconds: [],
    });
  });

  it("writes the record as JSON under a name made from the date and time, and reads back the same", async () => {
    const { client, ledger, requests } = standIn([KEEP], { tokens: 1234 });
    const record = liveRecord(NOW, "test yard 2", await explain(client, yardTwoInput()), ledger, requests.length);
    const dir = await folder();

    const file = await writeRecord(record, dir);

    expect(path.basename(file)).toBe("2026-10-26-180000.json");
    expect(path.basename(file)).toBe(recordFile(NOW));
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(record);
  });

  it("keeps template wording for every finding and a cost of 0 when the client refuses", async () => {
    const { client, ledger, requests } = standIn([KEEP], { capUsd: 0.0001 });
    const input = yardTwoInput();
    const out = await explain(client, input);

    const record = liveRecord(NOW, "test yard 2", out, ledger, requests.length);

    expect(record.refused).toBe("daily_cap_reached");
    expect(record.costUsd).toBe(0);
    expect(record.requests).toBe(0);
    expect(record.models).toEqual([]);
    expect(record.findings.map((f) => f.wording)).toEqual(input.findings.map(() => "template"));
    expect(record.findings.map((f) => f.instruction)).toEqual(input.findings.map((f) => f.instruction));
  });

  it("fails when the record cannot be written", async () => {
    const { client, ledger, requests } = standIn([KEEP]);
    const record = liveRecord(NOW, "test yard 2", await explain(client, yardTwoInput()), ledger, requests.length);
    const dir = await folder();
    const blocker = path.join(dir, "not-a-folder");
    await writeFile(blocker, "");

    await expect(writeRecord(record, blocker)).rejects.toThrow();
    await expect(writeRecord(record, path.join(blocker, "inside"))).rejects.toThrow();
  });
});
