"use client";

import { useState } from "react";
import { Sparkles, LayoutTemplate } from "lucide-react";
import { EditableWizard } from "./editable-wizard";
import { StudioWizard } from "./studio-wizard";

type LibraryItem = {
  id: string; image_url: string; generation_type: string;
  content_type: string | null; created_at: string;
};

/**
 * Studio home — the fork between the two engines:
 *  · Templates (manual): the 18 accepted strip-plate templates. Pick a property
 *    + photos → an image-count-filtered template → edit every text + colour
 *    layer with a live preview. Deterministic; draws real facts.
 *  · AI Studio (auto): the existing kie image generator (ads / social / renovation).
 */
export function StudioHome({ initialLibrary }: { initialLibrary: LibraryItem[] }) {
  const [mode, setMode] = useState<"templates" | "ai">("templates");
  return (
    <div>
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-4 pt-6">
        <button
          onClick={() => setMode("templates")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
            mode === "templates" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          <LayoutTemplate className="h-4 w-4" /> Templates
        </button>
        <button
          onClick={() => setMode("ai")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
            mode === "ai" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          <Sparkles className="h-4 w-4" /> AI Studio
        </button>
      </div>
      {mode === "templates" ? <EditableWizard /> : <StudioWizard initialLibrary={initialLibrary} />}
    </div>
  );
}
