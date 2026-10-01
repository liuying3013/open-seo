import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Markdown } from "@/client/components/Markdown";
import {
  getLearningDoc,
  learningDocs,
} from "@/client/features/learnings/catalog";

export function LearningsIndexPage() {
  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">学习文档</h1>
        <p className="mt-2 text-sm text-base-content/60">
          从竞品和外链研究里沉淀下来的可执行笔记。点开一篇就能看全文。
        </p>

        <ul className="mt-8 space-y-3">
          {learningDocs.map((doc) => (
            <li key={doc.slug}>
              <Link
                to="/learnings/$slug"
                params={{ slug: doc.slug }}
                className="block rounded-lg border border-base-300 px-5 py-4 transition-colors hover:bg-base-200/50"
              >
                <p className="text-sm font-semibold">{doc.title}</p>
                <p className="mt-1 text-sm text-base-content/60">
                  {doc.summary}
                </p>
                <p className="mt-2 text-xs text-base-content/40">
                  {doc.updatedAt}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function LearningDocPage({ slug }: { slug: string }) {
  const doc = getLearningDoc(slug);

  if (!doc) {
    return (
      <div className="h-full overflow-auto bg-base-100 px-4 py-8 md:px-6 md:py-12">
        <div className="mx-auto w-full max-w-3xl">
          <BackToLearnings />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            找不到这篇文档
          </h1>
          <p className="mt-2 text-sm text-base-content/60">
            这篇学习文档不存在，或 slug 已经换过。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <BackToLearnings />
        <p className="mt-4 text-xs text-base-content/40">{doc.updatedAt}</p>
        <Markdown className="mt-4 text-sm text-base-content/80">
          {doc.body}
        </Markdown>
      </div>
    </div>
  );
}

function BackToLearnings() {
  return (
    <Link
      to="/learnings"
      className="inline-flex items-center gap-1 text-sm text-base-content/60 transition-colors hover:text-base-content"
    >
      <ChevronLeft className="size-4" />
      学习文档
    </Link>
  );
}
