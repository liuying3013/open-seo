import { getStandardErrorMessage } from "@/client/lib/error-messages";

export function Loading() {
  return (
    <div className="flex justify-center py-6">
      <span className="loading loading-spinner loading-md" />
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  return (
    <div role="alert" className="rounded-lg bg-error/10 p-3 text-sm">
      {getStandardErrorMessage(error)}
    </div>
  );
}
