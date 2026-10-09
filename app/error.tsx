"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-4">
      <p className="eyebrow mb-2">Error</p>
      <h1 className="page-title">Something went wrong</h1>
      <p className="mt-2 text-[13.5px] text-ink-2">
        The page could not load. Nothing was changed. If it keeps happening, contact support and
        quote the reference below.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[12px] text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6">
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
