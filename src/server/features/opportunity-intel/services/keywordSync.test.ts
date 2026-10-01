import { describe, expect, it } from "vitest";
import { pickSyncProjectId } from "./keywordSyncPick";

const defaultProject = { id: "proj_default", domain: null };
const helmet = { id: "proj_helmet", domain: "helmetclean.example" };
const other = { id: "proj_other", domain: "other.example" };

describe("pickSyncProjectId", () => {
  it("prefers the graduated project when it is still live", () => {
    expect(
      pickSyncProjectId({
        graduatedProjectId: helmet.id,
        lastLoggedProjectId: other.id,
        projects: [other, helmet, defaultProject],
      }),
    ).toBe(helmet.id);
  });

  it("uses the last Save-keywords / graduation target next", () => {
    expect(
      pickSyncProjectId({
        graduatedProjectId: "gone",
        lastLoggedProjectId: helmet.id,
        projects: [other, helmet],
      }),
    ).toBe(helmet.id);
  });

  it("picks the newest project that has a domain when nothing was chosen", () => {
    expect(
      pickSyncProjectId({
        graduatedProjectId: null,
        lastLoggedProjectId: null,
        projects: [helmet, defaultProject],
      }),
    ).toBe(helmet.id);
  });

  it("falls back to the only project, even without a domain", () => {
    expect(
      pickSyncProjectId({
        graduatedProjectId: null,
        lastLoggedProjectId: null,
        projects: [defaultProject],
      }),
    ).toBe(defaultProject.id);
  });
});
