import * as api from "@/serverFunctions/content-workbench";

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export async function getContentWorkbench(
  input: Parameters<typeof api.getContentWorkbench>[0],
) {
  return unwrap(await api.getContentWorkbench(input));
}
export async function getWorkbenchTopic(
  input: Parameters<typeof api.getWorkbenchTopic>[0],
) {
  return unwrap(await api.getWorkbenchTopic(input));
}
export async function createWorkbenchTopic(
  input: Parameters<typeof api.createWorkbenchTopic>[0],
) {
  return unwrap(await api.createWorkbenchTopic(input));
}
export async function saveWorkbenchOffer(
  input: Parameters<typeof api.saveWorkbenchOffer>[0],
) {
  return unwrap(await api.saveWorkbenchOffer(input));
}
export async function getWorkbenchSerpQuote(
  input: Parameters<typeof api.getWorkbenchSerpQuote>[0],
) {
  return unwrap(await api.getWorkbenchSerpQuote(input));
}
export async function runWorkbenchClusterAction(
  input: Parameters<typeof api.runWorkbenchClusterAction>[0],
) {
  return unwrap(await api.runWorkbenchClusterAction(input));
}
export async function runWorkbenchAssetAction(
  input: Parameters<typeof api.runWorkbenchAssetAction>[0],
) {
  return unwrap(await api.runWorkbenchAssetAction(input));
}
export async function saveWorkbenchDraft(
  input: Parameters<typeof api.saveWorkbenchDraft>[0],
) {
  return unwrap(await api.saveWorkbenchDraft(input));
}
