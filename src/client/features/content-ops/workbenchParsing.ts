import type { z } from "zod";
export function parseStored<T>(
  schema: z.ZodType<T>,
  value: string | null,
): T | null {
  if (!value) return null;
  try {
    const result = schema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
