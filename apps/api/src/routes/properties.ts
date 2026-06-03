import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Property catalog ingestion (§5.17). CC owns this route; the three tables
 * (properties, property_imports, property_import_batches) are live. This runs
 * as aivena_app inside the agency-context tx, so every write is RLS-scoped to
 * current_setting('app.current_agency_id'). The `:id` path param mirrors the
 * spec path shape but is NOT trusted for scoping — it must equal the context
 * agency or the request is refused (defence in depth on top of RLS).
 *
 * Flow:
 *   1. POST /:id/property-imports        — parse CSV, resolve aliases, stage
 *      rows in property_imports, write a property_import_batches row. Returns a
 *      preview (matched/unmatched columns + sample rows). Nothing reaches
 *      `properties` yet.
 *   2. POST /:id/property-imports/:batchId/confirm — promote the validated
 *      staged rows into `properties`. `properties.embedding` is left NULL:
 *      Vega's embedding step (OpenAI text-embedding-3-small) fills it
 *      asynchronously — we do NOT call OpenAI here.
 */

const route = new Hono();

// Canonical CSV columns → accepted source aliases. Matching is
// case-insensitive, accent-folded, and whitespace/underscore-trimmed (see
// normaliseHeader). Spanish CRM exports (Inmovilla/Witei/Mediaelx) are the
// primary source, hence the Spanish aliases.
const COLUMN_ALIASES: Record<string, string[]> = {
  external_id: ['property_reference', 'reference', 'ref', 'referencia', 'external_id', 'id', 'codigo', 'cod'],
  title: ['title', 'titulo', 'nombre', 'name'],
  description: ['description', 'descripcion', 'description_es', 'descripcion_es', 'description_en', 'descripcion_en'],
  property_type: ['property_type', 'tipo', 'tipo_propiedad', 'type', 'tipologia'],
  price: ['price_eur', 'price', 'precio', 'precio_venta', 'pvp', 'precio_eur', 'importe'],
  bedrooms: ['bedrooms', 'dormitorios', 'habitaciones', 'beds', 'hab', 'dorm'],
  bathrooms: ['bathrooms', 'banos', 'baths', 'aseos'],
  area_sqm: ['square_meters', 'm2', 'm2_construidos', 'metros', 'superficie', 'area', 'built_area', 'superficie_construida'],
  location_city: ['city', 'ciudad', 'town', 'poblacion', 'municipio', 'location_city', 'localidad'],
  location_region: ['region', 'provincia', 'location_region', 'comunidad'],
  status: ['status', 'estado', 'situacion'],
  images: ['photos_url', 'photo', 'image', 'imagen', 'foto', 'url', 'photo_url', 'imagen_principal'],
};

const PROPERTY_STATUS = new Set(['active', 'reserved', 'sold']);

/**
 * GET /:id/properties — the agency's promoted catalog, newest first. Read as
 * aivena_app inside the agency-context tx (RLS-scoped). Capped at 500 — Pilot 1
 * catalogs are small; pagination is a later concern.
 */
route.get('/:id/properties', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  if (c.req.param('id') !== agencyId) {
    return c.json({ error: 'That agency doesn\'t match your session.' }, 403);
  }
  try {
    const result = await tx.execute(sql`
      SELECT id, external_id, title, property_type, status, price, price_currency,
             bedrooms, bathrooms, area_sqm, location_city, location_region,
             images, (embedding IS NOT NULL) AS has_embedding, updated_at
        FROM properties
       WHERE agency_id = current_setting('app.current_agency_id', true)
       ORDER BY updated_at DESC
       LIMIT 500
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ properties: rows });
  } catch (err) {
    console.error('[/properties GET] read failed:', err);
    return c.json({ error: 'Failed to load properties' }, 500);
  }
});

route.post('/:id/property-imports', async (c) => {
  const tx = c.get('tx');
  const user = c.get('user');
  const agencyId = c.get('agencyId');
  if (c.req.param('id') !== agencyId) {
    return c.json({ error: 'That agency doesn\'t match your session.' }, 403);
  }

  let csvText: string;
  let filename: string | null = null;
  try {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Attach a CSV file to import.' }, 400);
    }
    filename = file.name ?? null;
    csvText = await file.text();
  } catch (err) {
    console.error('[/property-imports] form parse failed:', err);
    return c.json({ error: 'Couldn\'t read that upload — please try again.' }, 400);
  }

  if (!csvText.trim()) {
    return c.json({ error: 'That file looks empty.' }, 400);
  }

  const delimiter = detectDelimiter(csvText);
  const parsed = parseCsv(csvText, delimiter);
  if (parsed.rows.length === 0) {
    return c.json({ error: 'No data rows found below the header.' }, 400);
  }

  const { matched, unmatched } = resolveColumns(parsed.header);

  try {
    const batchResult = await tx.execute(sql`
      INSERT INTO property_import_batches
        (agency_id, source_filename, detected_delimiter, matched_columns,
         unmatched_columns, total_rows, status, created_by)
      VALUES
        (current_setting('app.current_agency_id', true),
         ${filename},
         ${delimiter},
         ${JSON.stringify(matched)}::jsonb,
         ${JSON.stringify(unmatched)}::jsonb,
         ${parsed.rows.length},
         'validating',
         ${user.sub})
      RETURNING id
    `);
    const batchId = (batchResult as unknown as Array<{ id: string }>)[0]?.id;
    if (!batchId) {
      return c.json({ error: 'Couldn\'t start the import — please try again.' }, 500);
    }

    const sampleRows: Array<Record<string, unknown>> = [];
    let validCount = 0;

    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = rowObject(parsed.header, parsed.rows[i]);
      const resolved = resolveRow(raw, matched);
      const errors = validateRow(resolved);
      const status = errors.length === 0 ? 'validated' : 'failed';
      if (status === 'validated') validCount++;
      if (sampleRows.length < 5) {
        sampleRows.push({ rowNumber: i + 1, status, resolved, errors });
      }
      await tx.execute(sql`
        INSERT INTO property_imports
          (agency_id, import_batch_id, row_number, raw_payload, resolved_payload,
           status, validation_errors)
        VALUES
          (current_setting('app.current_agency_id', true),
           ${batchId},
           ${i + 1},
           ${JSON.stringify(raw)}::jsonb,
           ${JSON.stringify(resolved)}::jsonb,
           ${status},
           ${errors.length ? JSON.stringify(errors) : null}::jsonb)
      `);
    }

    return c.json({
      batchId,
      totalRows: parsed.rows.length,
      validRows: validCount,
      matchedColumns: matched,
      unmatchedColumns: unmatched,
      sampleRows,
    });
  } catch (err) {
    console.error('[/property-imports] staging failed:', err);
    return c.json({ error: 'Couldn\'t stage that import — please try again, and contact support if it keeps happening.' }, 500);
  }
});

route.post('/:id/property-imports/:batchId/confirm', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  if (c.req.param('id') !== agencyId) {
    return c.json({ error: 'That agency doesn\'t match your session.' }, 403);
  }
  const batchId = c.req.param('batchId');

  try {
    const staged = await tx.execute(sql`
      SELECT id, resolved_payload
        FROM property_imports
       WHERE import_batch_id = ${batchId}
         AND status = 'validated'
       ORDER BY row_number ASC
    `);
    const rows = staged as unknown as Array<{ id: string; resolved_payload: Record<string, unknown> | null }>;
    if (rows.length === 0) {
      return c.json({ error: 'Nothing to import — no valid rows were staged in this batch.' }, 400);
    }

    let promoted = 0;
    for (const r of rows) {
      const p = r.resolved_payload ?? {};
      // embedding generated asynchronously by Vega's embedding step (OpenAI
      // text-embedding-3-small) — do not call OpenAI here. Upsert on
      // (agency_id, external_id) so a re-import updates rather than duplicates.
      const promotedRow = await tx.execute(sql`
        INSERT INTO properties
          (agency_id, external_id, title, description, property_type, status,
           price, bedrooms, bathrooms, area_sqm, location_city, location_region,
           images, raw_payload)
        VALUES
          (current_setting('app.current_agency_id', true),
           ${asText(p.external_id)},
           ${asText(p.title)},
           ${asTextOrNull(p.description)},
           ${asTextOrNull(p.property_type)},
           ${normaliseStatus(p.status)},
           ${asNumberOrNull(p.price)},
           ${asIntOrNull(p.bedrooms)},
           ${asIntOrNull(p.bathrooms)},
           ${asNumberOrNull(p.area_sqm)},
           ${asTextOrNull(p.location_city)},
           ${asTextOrNull(p.location_region)},
           ${JSON.stringify(imagesArray(p.images))}::jsonb,
           ${JSON.stringify(p)}::jsonb)
        ON CONFLICT (agency_id, external_id) DO UPDATE
           SET title = EXCLUDED.title,
               description = EXCLUDED.description,
               property_type = EXCLUDED.property_type,
               status = EXCLUDED.status,
               price = EXCLUDED.price,
               bedrooms = EXCLUDED.bedrooms,
               bathrooms = EXCLUDED.bathrooms,
               area_sqm = EXCLUDED.area_sqm,
               location_city = EXCLUDED.location_city,
               location_region = EXCLUDED.location_region,
               images = EXCLUDED.images,
               raw_payload = EXCLUDED.raw_payload,
               updated_at = now()
        RETURNING id
      `);
      const propId = (promotedRow as unknown as Array<{ id: string }>)[0]?.id;
      if (propId) {
        promoted++;
        await tx.execute(sql`
          UPDATE property_imports
             SET status = 'promoted', promoted_property_id = ${propId}
           WHERE id = ${r.id}
        `);
      }
    }

    await tx.execute(sql`
      UPDATE property_import_batches
         SET status = 'completed', completed_at = now()
       WHERE id = ${batchId}
    `);

    return c.json({ promoted, skipped: 0 });
  } catch (err) {
    console.error('[/property-imports/confirm] promote failed:', err);
    return c.json({ error: 'Couldn\'t finish the import — please try again, and contact support if it keeps happening.' }, 500);
  }
});

// ---------- CSV helpers ----------

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<string, number> = {
    ',': (firstLine.match(/,/g) ?? []).length,
    ';': (firstLine.match(/;/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
  };
  let best = ',';
  let bestN = -1;
  for (const [d, n] of Object.entries(counts)) {
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

/**
 * Minimal RFC-4180-ish CSV parser — handles quoted fields, escaped quotes
 * (""), and the chosen delimiter. Good enough for agency exports; not a full
 * streaming parser (Pilot 1 catalogs are small).
 */
function parseCsv(text: string, delimiter: string): { header: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { records.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n') {
      pushField(); pushRecord();
    } else if (ch === '\r') {
      // swallow; \n handles the line break
    } else field += ch;
  }
  // trailing field/record
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim().length > 0));
  const header = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { header, rows: nonEmpty };
}

function normaliseHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '_');
}

function resolveColumns(header: string[]): {
  matched: Record<string, string>;
  unmatched: string[];
} {
  const matched: Record<string, string> = {};
  const unmatched: string[] = [];
  const used = new Set<string>();

  // Build a normalised lookup from alias → canonical.
  const aliasToCanonical = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const a of aliases) aliasToCanonical.set(normaliseHeader(a), canonical);
  }

  for (const original of header) {
    const norm = normaliseHeader(original);
    const canonical = aliasToCanonical.get(norm);
    if (canonical && !(canonical in matched)) {
      matched[canonical] = original;
      used.add(original);
    }
  }
  for (const original of header) {
    if (!used.has(original)) unmatched.push(original);
  }
  return { matched, unmatched };
}

function rowObject(header: string[], cells: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    obj[header[i]] = (cells[i] ?? '').trim();
  }
  return obj;
}

function resolveRow(
  raw: Record<string, string>,
  matched: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [canonical, sourceCol] of Object.entries(matched)) {
    const v = raw[sourceCol];
    if (v !== undefined && v !== '') out[canonical] = v;
  }
  return out;
}

function validateRow(resolved: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!resolved.external_id) errors.push('Missing a property reference.');
  if (!resolved.title) errors.push('Missing a title.');
  return errors;
}

// ---------- value coercion for the promote insert ----------

function asText(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}
function asTextOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}
function asNumberOrNull(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  // tolerate "€485.000", "485000,50", "1.250.000 €"
  const cleaned = v.replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  // if both separators present, assume '.' thousands + ',' decimal (es-ES)
  let norm = cleaned;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    norm = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    norm = cleaned.replace(',', '.');
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}
function asIntOrNull(v: unknown): number | null {
  const n = asNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
}
function normaliseStatus(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return PROPERTY_STATUS.has(t) ? t : 'active';
}
function imagesArray(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  const t = v.trim();
  return t.length ? [t] : [];
}

export default route;
