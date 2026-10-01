// Deterministic 0-100 score for how much of the approved content draft shows
// up in the live page text. Pure functions, no I/O.
//
// Both sides are reduced to tokens (words, or single CJK characters). Every
// approved block (title, each heading, each line of body text) contributes its
// 3-token shingles; the score is the share of those shingles found in the live
// token stream. Short blocks use shingles of their own length.

const SHINGLE_SIZE = 3;
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export type ApprovedDraftText = { title: string; body: string };

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.normalize("NFKC").toLowerCase();
  for (const piece of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    let word = "";
    for (const char of piece) {
      if (CJK.test(char)) {
        if (word) tokens.push(word);
        word = "";
        tokens.push(char);
      } else {
        word += char;
      }
    }
    if (word) tokens.push(word);
  }
  return tokens;
}

function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images: alt text is not page text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/[`*_~>|]/g, " ");
}

/** Text blocks of the approved draft: the title, then one block per body line. */
export function draftBlocks(draft: ApprovedDraftText): string[] {
  const blocks = [draft.title];
  let inFence = false;
  for (const line of draft.body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*([-*_]\s*){3,}$/.test(line)) continue;
    if (/^\s*\|?\s*:?-{2,}/.test(line)) continue; // table separator row
    blocks.push(stripInlineMarkdown(line));
  }
  return blocks.filter((block) => tokenize(block).length > 0);
}

function shinglesOf(tokens: string[], size: number): string[] {
  const n = Math.min(size, tokens.length);
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i += 1) {
    out.push(`${n}:${tokens.slice(i, i + n).join(" ")}`);
  }
  return out;
}

/** Per approved block: how many of its shingles the live text contains. */
export function blockCoverage(draft: ApprovedDraftText, liveText: string) {
  const liveTokens = tokenize(liveText);
  const live = new Set<string>();
  for (let size = 1; size <= SHINGLE_SIZE; size += 1) {
    for (const shingle of shinglesOf(liveTokens, size)) live.add(shingle);
  }
  return draftBlocks(draft).map((block) => {
    const shingles = shinglesOf(tokenize(block), SHINGLE_SIZE);
    return {
      block,
      total: shingles.length,
      found: shingles.filter((shingle) => live.has(shingle)).length,
    };
  });
}

/** 0-100, rounded. Returns 0 when the draft has no text. */
export function textMatchScore(
  draft: ApprovedDraftText,
  liveText: string,
): number {
  let total = 0;
  let found = 0;
  for (const block of blockCoverage(draft, liveText)) {
    total += block.total;
    found += block.found;
  }
  return total === 0 ? 0 : Math.round((found / total) * 100);
}
