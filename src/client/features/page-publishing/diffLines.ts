type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

export type DiffLine = { kind: DiffLineKind; text: string };
type DiffFile = { path: string; lines: DiffLine[] };

// Appended by the server when it cuts a diff at its size limit.
const TRUNCATED_MARKER = "[diff truncated]";

function classify(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/**
 * Split a unified diff into one section per file and classify each line for
 * colouring. Lines before the first `diff --git` header are kept under an
 * empty path so nothing is dropped.
 */
export function parseUnifiedDiff(diffText: string): {
  files: DiffFile[];
  truncated: boolean;
} {
  const trimmed = diffText.trimEnd();
  const truncated = trimmed.endsWith(TRUNCATED_MARKER);
  const body = truncated ? trimmed.slice(0, -TRUNCATED_MARKER.length) : trimmed;
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunk = false;
  for (const text of body.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(text);
    if (header) {
      current = { path: header[2], lines: [{ kind: "meta", text }] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) {
      if (text === "") continue;
      current = { path: "", lines: [] };
      files.push(current);
    }
    if (text.startsWith("@@")) inHunk = true;
    // Inside a hunk "---"/"+++" are ordinary removed/added lines.
    current.lines.push({
      kind: inHunk && !text.startsWith("@@") ? hunkKind(text) : classify(text),
      text,
    });
  }
  return { files, truncated };
}

function hunkKind(line: string): DiffLineKind {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}
