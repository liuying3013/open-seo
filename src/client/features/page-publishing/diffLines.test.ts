import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diffLines";

const diff = [
  "diff --git a/src/a.md b/src/a.md",
  "--- a/src/a.md",
  "+++ b/src/a.md",
  "@@ -1,2 +1,2 @@",
  " keep",
  "--- a list rule",
  "+new line",
  "diff --git a/src/b.md b/src/b.md",
  "new file mode 100644",
  "[diff truncated]",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("splits files, colours hunk lines and detects truncation", () => {
    const { files, truncated } = parseUnifiedDiff(diff);
    expect(truncated).toBe(true);
    expect(files.map((file) => file.path)).toEqual(["src/a.md", "src/b.md"]);
    // A removed line that starts with "--" is still a removal inside a hunk.
    expect(files[0].lines.map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "del",
      "add",
    ]);
  });
});
