import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sha256Fallback, sha256Hex } from "@/lib/util/ids";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const nodeSha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

describe("sha256", () => {
  it("pure-JS fallback matches node:crypto across padding boundaries", () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const data = new Uint8Array(len).map((_, i) => (i * 31 + 7) & 0xff);
      expect(hex(sha256Fallback(data))).toBe(nodeSha(data));
    }
    expect(hex(sha256Fallback(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("sha256Hex works when crypto.subtle is missing (plain-HTTP origins)", async () => {
    const input = "data:image/png;base64,AAAA";
    const expected = nodeSha(input);
    expect(await sha256Hex(input)).toBe(expected);
    vi.spyOn(globalThis.crypto, "subtle", "get").mockReturnValue(undefined as unknown as SubtleCrypto);
    try {
      expect(await sha256Hex(input)).toBe(expected);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
