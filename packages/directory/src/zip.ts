import { DirectoryRefused } from "./errors.ts";

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const SIZE_IN_ZIP64 = 0xffffffff;

const inflate = async (data: Uint8Array, size: number): Promise<Uint8Array> => {
  const reader = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const out = new Uint8Array(size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > size) throw new DirectoryRefused("a zip entry is larger than it says");
    out.set(value, at);
    at += value.length;
  }
  if (at !== size) throw new DirectoryRefused("a zip entry is smaller than it says");
  return out;
};

export const unzip = async (bytes: Uint8Array): Promise<Map<string, Uint8Array>> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new DirectoryRefused("not a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new DirectoryRefused("the zip index is damaged");
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (packed === SIZE_IN_ZIP64 || size === SIZE_IN_ZIP64 || local === SIZE_IN_ZIP64) throw new DirectoryRefused("zip64 files are not read");
    if (size > MAX_ENTRY_BYTES) throw new DirectoryRefused(`${name} is too large`);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_SIGNATURE) throw new DirectoryRefused("the zip index is damaged");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) throw new DirectoryRefused("the zip is cut short");
    const data = bytes.subarray(start, start + packed);
    if (method === 0) {
      if (packed !== size) throw new DirectoryRefused("a stored zip entry has two sizes");
      files.set(name, data);
    } else if (method === 8) files.set(name, await inflate(data, size));
    else throw new DirectoryRefused(`zip method ${method} is not read`);
  }
  return files;
};
