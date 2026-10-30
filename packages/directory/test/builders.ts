const encoder = new TextEncoder();

const deflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

type Entry = { name: string; method: number; packed: Uint8Array; size: number };

export const makeZip = async (files: Record<string, string>, options: { stored?: boolean; lie?: number } = {}): Promise<Uint8Array> => {
  const entries: Entry[] = [];
  for (const [name, text] of Object.entries(files)) {
    const raw = encoder.encode(text);
    entries.push(
      options.stored
        ? { name, method: 0, packed: raw, size: raw.length }
        : { name, method: 8, packed: await deflate(raw), size: raw.length + (options.lie ?? 0) },
    );
  }
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = encoder.encode(e.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, e.method, true);
    lv.setUint32(18, e.packed.length, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 20, true);
    hv.setUint16(10, e.method, true);
    hv.setUint32(20, e.packed.length, true);
    hv.setUint32(24, e.size, true);
    hv.setUint16(28, name.length, true);
    hv.setUint32(42, offset, true);
    head.set(name, 46);
    central.push(head);
    parts.push(local, e.packed);
    offset += local.length + e.packed.length;
  }
  const directory = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const letters = (i: number): string => String.fromCharCode(65 + i);

export const sheetXml = (rows: string[][], prefix = "x:"): string => {
  const body = rows
    .map(
      (row, r) =>
        `<${prefix}row r="${r + 1}">${row
          .map((v, c) => (v === "" ? "" : `<${prefix}c r="${letters(c)}${r + 1}" t="inlineStr"><${prefix}is><${prefix}t>${v.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${prefix}t></${prefix}is></${prefix}c>`))
          .join("")}</${prefix}row>`,
    )
    .join("");
  return `\uFEFF<?xml version="1.0" encoding="utf-8"?><${prefix}worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${prefix}sheetData>${body}</${prefix}sheetData></${prefix}worksheet>`;
};

export const makeXlsx = (rows: string[][]): Promise<Uint8Array> => makeZip({ "xl/worksheets/sheet.xml": sheetXml(rows) });

export const xlsxWithSharedStrings = (): Promise<Uint8Array> =>
  makeZip({
    "xl/sharedStrings.xml":
      '<?xml version="1.0"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>License</x:t></x:si><x:si><x:r><x:t xml:space="preserve"> Smith </x:t></x:r><x:r><x:t>&amp; Sons &#65;&#x42;</x:t></x:r><x:rPh><x:t>ignored</x:t></x:rPh></x:si><x:si><x:t/></x:si></x:sst>',
    "xl/worksheets/sheet.xml":
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row><x:row r="2"/><x:row r="3"><x:c r="A3" t="n"><x:v>1105787</x:v></x:c><x:c r="B3" t="s"><x:v>2</x:v></x:c><x:c r="D3" t="b"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>',
  });
