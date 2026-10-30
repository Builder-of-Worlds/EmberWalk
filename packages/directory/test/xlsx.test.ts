import { describe, expect, it } from "vitest";
import { DirectoryRefused } from "../src/errors.ts";
import { readXlsx } from "../src/xlsx.ts";
import { unzip } from "../src/zip.ts";
import { makeXlsx, makeZip, sheetXml, xlsxWithSharedStrings } from "./builders.ts";

const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

describe("reading a zip", () => {
  it("reads deflated and stored entries and skips folders", async () => {
    for (const stored of [false, true]) {
      const files = await unzip(await makeZip({ "a.txt": "hello", "dir/b.txt": "x".repeat(5000) }, { stored }));
      expect([...files.keys()]).toEqual(["a.txt", "dir/b.txt"]);
      expect(decode(files.get("a.txt"))).toBe("hello");
      expect(decode(files.get("dir/b.txt"))).toBe("x".repeat(5000));
    }
  });

  it("refuses bytes that are not a zip, a cut off zip and a damaged index", async () => {
    await expect(unzip(new TextEncoder().encode("plain text, not a zip at all"))).rejects.toThrow(DirectoryRefused);
    const good = await makeZip({ "a.txt": "hello" });
    await expect(unzip(good.subarray(0, good.length - 30))).rejects.toThrow(DirectoryRefused);
    const damaged = good.slice();
    new DataView(damaged.buffer).setUint32(damaged.length - 22 - 46 - 5, 0, true);
    await expect(unzip(damaged)).rejects.toThrow(DirectoryRefused);
  });

  it("refuses an entry that inflates to a different size than the index says", async () => {
    await expect(unzip(await makeZip({ "a.txt": "hello world" }, { lie: 3 }))).rejects.toThrow(DirectoryRefused);
    await expect(unzip(await makeZip({ "a.txt": "hello world" }, { lie: -3 }))).rejects.toThrow(DirectoryRefused);
  });
});

describe("reading a workbook", () => {
  it("reads the first sheet's cells as text, filling empty cells and dropping empty rows", async () => {
    const rows = [
      ["License", "Name", "", "Zip"],
      ["1", "Smith & <Sons>", "", "95945"],
      ["", "", "", ""],
      ["2", "Two", "x", ""],
    ];
    expect(await readXlsx(await makeXlsx(rows))).toEqual([
      ["License", "Name", "", "Zip"],
      ["1", "Smith & <Sons>", "", "95945"],
      ["2", "Two", "x"],
    ]);
  });

  it("reads shared strings with runs, entities and phonetic parts, numbers, empty rows and cells left out", async () => {
    expect(await readXlsx(await xlsxWithSharedStrings())).toEqual([
      ["License", "", " Smith & Sons AB"],
      ["1105787", "", "", "1"],
    ]);
  });

  it("reads a sheet written without a namespace prefix", async () => {
    const bytes = await makeZip({ "xl/worksheets/sheet1.xml": sheetXml([["a", "b"]], "") });
    expect(await readXlsx(bytes)).toEqual([["a", "b"]]);
  });

  it("refuses a zip with no sheet", async () => {
    await expect(readXlsx(await makeZip({ "readme.txt": "no sheet" }))).rejects.toThrow(/no sheet/);
  });

  const MEGABYTE = 1024 * 1024;
  const padded = (megabytes: number, rows: string[][]) => makeZip({ "xl/worksheets/sheet.xml": `${sheetXml(rows)}<!--${"x".repeat(megabytes * MEGABYTE)}-->` });

  it("reads a sheet as large as the real list of seven classes, 80 MB of XML", async () => {
    expect(await readXlsx(await padded(80, [["License", "Name"], ["1", "Smith"]]))).toEqual([["License", "Name"], ["1", "Smith"]]);
  });

  it("refuses a sheet larger than any list of licenses can be", async () => {
    const bytes = await makeZip({ "xl/worksheets/sheet.xml": sheetXml([["a"]]) }, { lie: 129 * MEGABYTE });
    await expect(readXlsx(bytes)).rejects.toThrow(/too large/);
  });
});
