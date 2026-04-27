"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 p-8 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-outline">
        Something went wrong
      </p>
      <h1 className="text-3xl font-black font-headline uppercase tracking-tighter text-on-surface">
        Could not load events
      </h1>
      <p className="text-sm text-on-surface-variant font-mono max-w-sm">
        {error.message ?? "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="font-mono text-xs uppercase tracking-widest border border-outline px-4 py-2 hover:bg-surface-container transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
