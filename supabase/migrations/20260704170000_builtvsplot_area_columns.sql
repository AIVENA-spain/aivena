-- Built-vs-plot m² — capture the built/plot area columns (Packet 3 task 9). DRAFT — NOT YET APPLIED.
--
-- The `properties` table lives out-of-band (schema drift); `area_built_sqm` + `area_plot_sqm`
-- ALREADY EXIST on the live DB, so this migration is an idempotent NO-OP capture — it records the
-- columns in version control and documents the built/plot/neutral split. It performs NO data rewrite:
-- existing rows are untouched (the behaviour fix is code-only — the CSV importer now writes built and
-- plot into their own columns, and `area_sqm` stays a neutral legacy column = generic-header ?? built,
-- never plot).
--
-- Apply ONLY with control-tower approval, alongside the API deploy that ships the importer change.
-- Rollback: additive IF NOT EXISTS columns that pre-exist live — nothing to undo on apply; if ever
-- removed (not recommended, they pre-date this file): ALTER TABLE public.properties DROP COLUMN ...

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS area_built_sqm numeric,
  ADD COLUMN IF NOT EXISTS area_plot_sqm  numeric;

COMMENT ON COLUMN public.properties.area_built_sqm IS 'Built (construida) area in m². Distinct fact from plot; never conflated with area_sqm.';
COMMENT ON COLUMN public.properties.area_plot_sqm  IS 'Plot (parcela) area in m². Distinct fact; never displayed as built.';
COMMENT ON COLUMN public.properties.area_sqm       IS 'Legacy/neutral area in m² (generic header, or built fallback). Shown as a bare "m²", never asserted as built. Prefer area_built_sqm / area_plot_sqm.';
