import { DirectoryRefused } from "./errors.ts";
import { unzip } from "./zip.ts";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const unescapeXml = (text: string): string =>
  text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(\w+));/g, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name !== undefined) return ENTITIES[name] ?? whole;
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const textOf = (xml: string): string => {
  const plain = xml.replace(/<(?:\w+:)?rPh\b[^>]*>.*?<\/(?:\w+:)?rPh>/gs, "");
  return unescapeXml([...plain.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>(.*?)<\/(?:\w+:)?t>/gs)].map((m) => m[1] ?? "").join(""));
};

const sharedStrings = (xml: string | undefined): string[] =>
  xml === undefined ? [] : [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>(.*?)<\/(?:\w+:)?si>/gs)].map((m) => textOf(m[1] ?? ""));

const columnOf = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const attribute = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

export const readXlsx = async (bytes: Uint8Array): Promise<string[][]> => {
  const files = await unzip(bytes);
  const sheetName = [...files.keys()].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
  const sheet = sheetName === undefined ? undefined : files.get(sheetName);
  if (sheet === undefined) throw new DirectoryRefused("the workbook has no sheet");
  const decoder = new TextDecoder();
  const strings = sharedStrings(files.has("xl/sharedStrings.xml") ? decoder.decode(files.get("xl/sharedStrings.xml")) : undefined);
  const rows: string[][] = [];
  for (const row of decoder.decode(sheet).matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>(.*?)<\/(?:\w+:)?row>)/gs)) {
    const cells: string[] = [];
    for (const cell of (row[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>(.*?)<\/(?:\w+:)?c>)/gs)) {
      const attrs = cell[1] ?? "";
      const body = cell[2] ?? "";
      const ref = attribute(attrs, "r");
      const at = ref === undefined ? cells.length : columnOf(ref);
      const kind = attribute(attrs, "t");
      const raw = /<(?:\w+:)?v\b[^>]*>(.*?)<\/(?:\w+:)?v>/s.exec(body)?.[1];
      let value = "";
      if (kind === "s") value = strings[Number(raw)] ?? "";
      else if (kind === "inlineStr") value = textOf(body);
      else if (raw !== undefined) value = unescapeXml(raw);
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    if (cells.some((c) => c !== "")) rows.push(cells);
  }
  return rows;
};
