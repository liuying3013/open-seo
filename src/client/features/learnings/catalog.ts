import andorwillowBacklinks from "@/client/features/learnings/docs/andorwillow-backlinks.md?raw";

type LearningDoc = {
  slug: string;
  title: string;
  summary: string;
  updatedAt: string;
  body: string;
};

export const learningDocs: LearningDoc[] = [
  {
    slug: "andorwillow-backlinks",
    title: "Andor Willow 外链：哪些值得学",
    summary:
      "andorwillow.com 外链第一页里，哪些稿和经销商页值得抄，哪些 PBN 直接丢掉。",
    updatedAt: "2026-09-01",
    body: andorwillowBacklinks,
  },
];

export function getLearningDoc(slug: string): LearningDoc | undefined {
  return learningDocs.find((doc) => doc.slug === slug);
}
