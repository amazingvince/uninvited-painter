import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLastRoom,
  loadLastRoom,
  saveLastRoom,
} from "../src/lib/storage";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("last room recovery", () => {
  it("returns a structurally valid room shortcut", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    saveLastRoom("ABCD");
    expect(loadLastRoom()).toEqual({
      code: "ABCD",
      at: 1_000,
    });
  });

  it("normalizes valid codes and clears malformed shortcuts", () => {
    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: "abcd", at: 1_000 }),
    );
    expect(loadLastRoom()).toEqual({ code: "ABCD", at: 1_000 });

    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: "BAD!", at: 1_000 }),
    );
    expect(loadLastRoom()).toBeNull();
    expect(values.has("painter.lastRoom.v1")).toBe(false);

    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: 1234, at: 1_000 }),
    );
    expect(loadLastRoom()).toBeNull();
    expect(values.has("painter.lastRoom.v1")).toBe(false);

    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: "ABCD", at: "yesterday" }),
    );
    expect(loadLastRoom()).toBeNull();
  });

  it("removes the shortcut explicitly", () => {
    values.set("painter.lastRoom.v1", "{}");
    clearLastRoom();
    expect(values.has("painter.lastRoom.v1")).toBe(false);
  });

  it("only clears the room code the caller actually observed", () => {
    saveLastRoom("MOLT");
    saveLastRoom("INKS");

    expect(clearLastRoom("MOLT")).toBe(false);
    expect(loadLastRoom()?.code).toBe("INKS");

    expect(clearLastRoom("INKS")).toBe(true);
    expect(loadLastRoom()).toBeNull();
  });
});
