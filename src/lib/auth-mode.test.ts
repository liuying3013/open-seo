import { describe, expect, it } from "vitest";
import { getAuthMode, isHostedAuthMode, isPasswordAuthMode } from "./auth-mode";

describe("password auth modes", () => {
  it("enables local password sessions without hosted billing or signup", () => {
    expect(getAuthMode("local_password")).toBe("local_password");
    expect(isPasswordAuthMode("local_password")).toBe(true);
    expect(isHostedAuthMode("local_password")).toBe(false);
    expect(isPasswordAuthMode("hosted")).toBe(true);
  });
  it.each(["local_noauth", "cloudflare_access", undefined])(
    "keeps %s outside password auth",
    (mode) => {
      expect(isPasswordAuthMode(mode)).toBe(false);
    },
  );
});
