import { describe, expect, it } from "vitest";
import { validatePassword } from "./password-policy";

describe("validatePassword", () => {
  it("rejects short passwords", () => {
    expect(validatePassword("Ab1")).toMatch(/at least 10/);
  });
  it("requires mixed case and a digit", () => {
    expect(validatePassword("alllowercase1")).toMatch(/uppercase and lowercase/);
    expect(validatePassword("ALLUPPERCASE1")).toMatch(/uppercase and lowercase/);
    expect(validatePassword("NoDigitsHereAtAll")).toMatch(/number/);
  });
  it("rejects common passwords", () => {
    expect(validatePassword("Password123")).toMatch(/too common/);
    expect(validatePassword("password123")).toMatch(/uppercase and lowercase/);
  });
  it("accepts a strong password", () => {
    expect(validatePassword("Compass2026Nairobi")).toBeNull();
  });
});
