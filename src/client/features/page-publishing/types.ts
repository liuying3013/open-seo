import type {
  getPageReviewDetail,
  listPublishAttempts,
} from "@/serverFunctions/page-publishing";

export type ReviewDetail = Awaited<ReturnType<typeof getPageReviewDetail>>;
export type PublishAttemptRow = Awaited<
  ReturnType<typeof listPublishAttempts>
>[number];
