"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, IconTile } from "@/components/ui";

/** Shown when a page fails to load (often a dropped connection to the database). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="flex max-w-md flex-col items-center p-8 text-center">
        <IconTile icon={RefreshCw} size="lg" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">This page didn&apos;t load</h1>
        <p className="mt-1.5 text-sm text-slate-500">Usually a short connection problem. Try again; if it keeps happening, let us know.</p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-slate-400">Ref: {error.digest}</p> : null}
        <Button type="button" className="mt-6" onClick={() => retry()}>
          Try again
        </Button>
      </Card>
    </div>
  );
}
