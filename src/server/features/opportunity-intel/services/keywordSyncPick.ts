/**
 * Where fetch-time keyword writes land. Graduation / last Save keywords win;
 * otherwise the newest project that has a domain, else the only/newest project.
 */
export function pickSyncProjectId(input: {
  graduatedProjectId: string | null;
  lastLoggedProjectId: string | null;
  projects: Array<{ id: string; domain: string | null }>;
}): string | null {
  const live = new Set(input.projects.map((project) => project.id));
  if (input.graduatedProjectId && live.has(input.graduatedProjectId)) {
    return input.graduatedProjectId;
  }
  if (input.lastLoggedProjectId && live.has(input.lastLoggedProjectId)) {
    return input.lastLoggedProjectId;
  }
  if (input.projects.length === 1) return input.projects[0].id;
  const withDomain = input.projects.filter((project) => project.domain);
  if (withDomain.length > 0) return withDomain[0].id;
  return input.projects[0]?.id ?? null;
}
