"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

/** Disabled while the page is being created, so repeated clicks cannot create several pages. */
export function UseTemplateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? "Creating..." : "Use template"}
    </Button>
  );
}
