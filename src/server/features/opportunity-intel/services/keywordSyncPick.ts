/**
 * Where fetch-time keyword writes land. Graduation / last Save keywords win;
 * otherwise the newest research workspace — a user-created project without a
 * domain — so scans of not-yet-sold categories never pollute a site project's
 * saved keywords. Then the newest project with a domain, else the newest one.
 * The auto-created "Default" project is not a research workspace.
 */
export function pickSyncProjectId(input: {
  graduatedProjectId: string | null;
  lastLoggedProjectId: string | null;
  projects: Array<{ id: string; name: string; domain: string | null }>;
}): string | null {
  const live = new Set(input.projects.map((project) => project.id));
  if (input.graduatedProjectId && live.has(input.graduatedProjectId)) {
    return input.graduatedProjectId;
  }
  if (input.lastLoggedProjectId && live.has(input.lastLoggedProjectId)) {
    return input.lastLoggedProjectId;
  }
  if (input.projects.length === 1) return input.projects[0].id;
  const workspace = input.projects.find(
    (project) => !project.domain && project.name !== "Default",
  );
  if (workspace) return workspace.id;
  const withDomain = input.projects.filter((project) => project.domain);
  if (withDomain.length > 0) return withDomain[0].id;
  return input.projects[0]?.id ?? null;
}
