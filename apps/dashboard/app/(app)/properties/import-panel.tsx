"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { UploadCloud, CheckCircle2, FileSpreadsheet } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  importPropertiesAction,
  confirmImportAction,
  type ImportPreview,
} from "./property-actions";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "confirming"; preview: ImportPreview }
  | { kind: "done"; promoted: number }
  | { kind: "error"; message: string };

/**
 * Properties — CSV catalog import (§5.17). Upload → staged preview (matched /
 * unmatched columns + sample rows + valid count) → confirm → promoted into
 * `properties`. Embeddings are filled later by Vega's step; this UI never
 * promises search is live the instant a row lands.
 */
export function PropertyImportPanel() {
  const t = useTranslations("settings.properties");
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onFile(file: File | null) {
    if (!file) return;
    setPhase({ kind: "uploading" });
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await importPropertiesAction(fd);
      if (res.ok) setPhase({ kind: "preview", preview: res.data });
      else setPhase({ kind: "error", message: res.error });
    });
  }

  function onConfirm(preview: ImportPreview) {
    setPhase({ kind: "confirming", preview });
    startTransition(async () => {
      const res = await confirmImportAction(preview.batchId);
      if (res.ok) setPhase({ kind: "done", promoted: res.data.promoted });
      else setPhase({ kind: "error", message: res.error });
    });
  }

  function reset() {
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card id="properties" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />

        {(phase.kind === "idle" ||
          phase.kind === "uploading" ||
          phase.kind === "error") && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center transition-colors hover:bg-muted disabled:opacity-60"
          >
            <UploadCloud className="h-7 w-7 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium text-foreground">
              {phase.kind === "uploading" ? t("uploading") : t("dropPrompt")}
            </span>
            <span className="text-xs text-muted-foreground">{t("dropHint")}</span>
          </button>
        )}

        {phase.kind === "error" && (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">
            {phase.message}
          </p>
        )}

        {(phase.kind === "preview" || phase.kind === "confirming") && (
          <ImportPreviewView
            preview={phase.preview}
            confirming={phase.kind === "confirming"}
            onConfirm={() => onConfirm(phase.preview)}
            onCancel={reset}
            t={t}
          />
        )}

        {phase.kind === "done" && (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft px-5 py-4">
            <div className="flex items-center gap-2 text-brand">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              <span className="text-sm font-semibold">
                {t("doneTitle", { count: phase.promoted })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("doneNote")}</p>
            <div className="flex gap-2">
              <Link href="/properties" className={buttonVariants({ size: "sm" })}>
                {t("viewProperties")}
              </Link>
              <Button type="button" size="sm" variant="outline" onClick={reset}>
                {t("importAnother")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportPreviewView({
  preview,
  confirming,
  onConfirm,
  onCancel,
  t,
}: {
  preview: ImportPreview;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: ReturnType<typeof useTranslations<"settings.properties">>;
}) {
  const matchedKeys = Object.keys(preview.matchedColumns);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span>
          {t("previewSummary", {
            valid: preview.validRows,
            total: preview.totalRows,
          })}
        </span>
      </div>

      {/* Matched columns */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t("matchedColumns")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {matchedKeys.map((canonical) => (
            <span
              key={canonical}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-[11px] text-brand"
            >
              <span className="font-mono">{canonical}</span>
              <span className="text-brand/60">←</span>
              <span>{preview.matchedColumns[canonical]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Unmatched columns (informational — they're ignored on promote) */}
      {preview.unmatchedColumns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t("unmatchedColumns")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {preview.unmatchedColumns.map((col) => (
              <span
                key={col}
                className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
              >
                {col}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("unmatchedHint")}
          </p>
        </div>
      )}

      {/* Sample rows */}
      {preview.sampleRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t("colRef")}</th>
                <th className="px-3 py-2 font-medium">{t("colTitle")}</th>
                <th className="px-3 py-2 font-medium">{t("colPrice")}</th>
                <th className="px-3 py-2 font-medium">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((r) => (
                <tr key={r.rowNumber} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {r.rowNumber}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {String(r.resolved.external_id ?? "—")}
                  </td>
                  <td className="px-3 py-2">
                    {String(r.resolved.title ?? "—")}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {String(r.resolved.price ?? "—")}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "validated" ? (
                      <span className="text-brand">{t("rowOk")}</span>
                    ) : (
                      <span
                        className="text-red-600 dark:text-red-300"
                        title={r.errors.join(" ")}
                      >
                        {t("rowInvalid")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={confirming || preview.validRows === 0}
        >
          {confirming ? t("confirming") : t("confirmImport")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={confirming}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
