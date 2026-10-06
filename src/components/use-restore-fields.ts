"use client";

import { useEffect, type RefObject } from "react";

/**
 * React resets a form after its action runs. When the action fails, it returns
 * what the user typed in `fields`; this puts those values back (never passwords).
 */
export function useRestoreFields(formRef: RefObject<HTMLFormElement | null>, fields: Record<string, string> | undefined) {
  useEffect(() => {
    const form = formRef.current;
    if (!form || !fields) return;
    for (const [name, value] of Object.entries(fields)) {
      const input = form.elements.namedItem(name);
      if ((input instanceof HTMLInputElement && input.type !== "password") || input instanceof HTMLSelectElement) {
        input.value = value;
      }
    }
  }, [formRef, fields]);
}
