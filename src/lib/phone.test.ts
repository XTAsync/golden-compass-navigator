import { describe, expect, it } from "vitest";
import { normaliseKenyanPhone } from "./phone";

describe("normaliseKenyanPhone", () => {
  it("accepts the common formats", () => {
    expect(normaliseKenyanPhone("0712345678")).toBe("254712345678");
    expect(normaliseKenyanPhone("+254 712 345 678")).toBe("254712345678");
    expect(normaliseKenyanPhone("712345678")).toBe("254712345678");
    expect(normaliseKenyanPhone("0112345678")).toBe("254112345678");
  });
  it("rejects bad numbers", () => {
    expect(normaliseKenyanPhone("")).toBeNull();
    expect(normaliseKenyanPhone("0812345678")).toBeNull();
    expect(normaliseKenyanPhone("07123456")).toBeNull();
    expect(normaliseKenyanPhone(undefined)).toBeNull();
  });
});
