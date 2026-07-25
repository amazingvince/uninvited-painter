import { afterEach, describe, expect, it } from "vitest";
import {
  AI_SOURCE_MAX_BYTES,
  validateReferencePng,
} from "../worker/ai-input";
import { drawingReferencePng } from "../src/lib/share";

function pngHeader(width: number, height: number, size = 32): ArrayBuffer {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

describe("AI reference PNG validation", () => {
  it("accepts exactly a 1024px square PNG", () => {
    expect(validateReferencePng(pngHeader(1024, 1024))).toEqual({
      width: 1024,
      height: 1024,
    });
  });

  it("rejects bad signatures, dimensions, and oversized input", () => {
    expect(() => validateReferencePng(new Uint8Array([1, 2, 3]).buffer)).toThrow(/PNG/);
    expect(() => validateReferencePng(pngHeader(512, 512))).toThrow(/1024/);
    expect(() =>
      validateReferencePng(pngHeader(1024, 1024, AI_SOURCE_MAX_BYTES + 1)),
    ).toThrow(/large/i);
  });
});

describe("AI reference renderer", () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  });

  it("renders a wordless 1024px PNG", async () => {
    let canvasWidth = 0;
    let canvasHeight = 0;
    let labels = 0;
    const context = {
      save() {},
      restore() {},
      translate() {},
      fillRect() {},
      fillText() {
        labels += 1;
      },
    };
    const canvas = {
      get width() {
        return canvasWidth;
      },
      set width(value: number) {
        canvasWidth = value;
      },
      get height() {
        return canvasHeight;
      },
      set height(value: number) {
        canvasHeight = value;
      },
      getContext: () => context,
      toBlob: (callback: BlobCallback, type?: string) => {
        expect(type).toBe("image/png");
        callback(new Blob(["png"], { type: "image/png" }));
      },
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => canvas },
    });

    const blob = await drawingReferencePng([]);

    expect(blob.type).toBe("image/png");
    expect(canvasWidth).toBe(1024);
    expect(canvasHeight).toBe(1024);
    expect(labels).toBe(0);
  });
});
