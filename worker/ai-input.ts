export const AI_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const AI_MULTIPART_MAX_BYTES = AI_SOURCE_MAX_BYTES + 64 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];

export function validateReferencePng(
  bytes: ArrayBuffer,
): { width: 1024; height: 1024 } {
  if (bytes.byteLength > AI_SOURCE_MAX_BYTES) {
    throw new Error("Reference image is too large");
  }
  if (bytes.byteLength < 24) throw new Error("Reference image is not a PNG");

  const data = new Uint8Array(bytes);
  if (!PNG_MAGIC.every((byte, index) => data[index] === byte)) {
    throw new Error("Reference image is not a PNG");
  }
  if (!IHDR.every((byte, index) => data[12 + index] === byte)) {
    throw new Error("Reference PNG is missing IHDR");
  }

  const view = new DataView(bytes);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 1024 || height !== 1024) {
    throw new Error("Reference PNG must be exactly 1024 by 1024");
  }
  return { width: 1024, height: 1024 };
}
