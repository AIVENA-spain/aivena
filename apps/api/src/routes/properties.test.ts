import { describe, it, expect } from 'vitest';
import {
  stripBom,
  detectDelimiter,
  parseCsv,
  resolveColumns,
  validateRow,
  normaliseStatus,
  imagesArray,
  asNumberOrNull,
} from './properties';

// O4 — CSV-import hardening. Pure-function coverage of the risky bits real Spanish
// CRM exports (Inmovilla/Witei/Mediaelx) hit: BOM, delimiter, quoted commas,
// multi-line cells, Spanish status words, multi-image cells, es-ES money formats.

describe('O4 CSV import hardening', () => {
  describe('stripBom', () => {
    it('removes a leading UTF-8 BOM', () => expect(stripBom('﻿ref,title')).toBe('ref,title'));
    it('leaves BOM-less text untouched', () => expect(stripBom('ref,title')).toBe('ref,title'));
  });

  describe('detectDelimiter', () => {
    it('detects comma', () => expect(detectDelimiter('a,b,c\n1,2,3')).toBe(','));
    it('detects semicolon', () => expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';'));
    it('detects tab', () => expect(detectDelimiter('a\tb\tc')).toBe('\t'));
    it('ignores a comma inside a quoted header cell (picks semicolon)', () =>
      expect(detectDelimiter('Ref;Title;"Precio, €"\n1;Villa;100')).toBe(';'));
    it('is not skewed by a leading BOM', () => expect(detectDelimiter('﻿a;b;c')).toBe(';'));
  });

  describe('parseCsv', () => {
    it('parses simple rows', () => {
      const r = parseCsv('ref,title\n1,Villa\n2,Piso', ',');
      expect(r.header).toEqual(['ref', 'title']);
      expect(r.rows).toEqual([['1', 'Villa'], ['2', 'Piso']]);
    });
    it('keeps a delimiter inside a quoted field', () =>
      expect(parseCsv('ref,desc\n1,"Bright, sunny"', ',').rows[0]).toEqual(['1', 'Bright, sunny']));
    it('handles escaped double-quotes', () =>
      expect(parseCsv('ref,desc\n1,"He said ""hi"""', ',').rows[0][1]).toBe('He said "hi"'));
    it('handles a newline inside a quoted field (one row, not phantom rows)', () => {
      const r = parseCsv('ref,desc\n1,"line1\nline2"', ',');
      expect(r.rows.length).toBe(1);
      expect(r.rows[0][1]).toBe('line1\nline2');
    });
    it('handles CRLF line endings', () =>
      expect(parseCsv('ref,title\r\n1,Villa\r\n', ',').rows).toEqual([['1', 'Villa']]));
  });

  describe('resolveColumns (Spanish, accent-folded)', () => {
    it('maps Spanish headers to canonical', () => {
      const { matched } = resolveColumns(['Referencia', 'Título', 'Precio', 'Dormitorios', 'Población', 'Fotos']);
      expect(matched.external_id).toBe('Referencia');
      expect(matched.title).toBe('Título');
      expect(matched.price).toBe('Precio');
      expect(matched.bedrooms).toBe('Dormitorios');
      expect(matched.location_city).toBe('Población');
      expect(matched.images).toBe('Fotos');
    });
    it('reports unmatched (e.g. owner-contact columns) rather than importing them', () => {
      const { unmatched } = resolveColumns(['ref', 'propietario', 'telefono']);
      expect(unmatched).toContain('propietario');
      expect(unmatched).toContain('telefono');
    });
  });

  describe('validateRow (bad-row behavior)', () => {
    it('requires external_id and title', () => {
      expect(validateRow({})).toHaveLength(2);
      expect(validateRow({ external_id: '1' })).toHaveLength(1);
      expect(validateRow({ external_id: '1', title: 'Villa' })).toHaveLength(0);
    });
  });

  describe('normaliseStatus (Spanish aliases)', () => {
    it('passes canonical through', () => {
      expect(normaliseStatus('sold')).toBe('sold');
      expect(normaliseStatus('reserved')).toBe('reserved');
    });
    it('maps Spanish status words', () => {
      expect(normaliseStatus('Vendido')).toBe('sold');
      expect(normaliseStatus('reservada')).toBe('reserved');
      expect(normaliseStatus('Disponible')).toBe('active');
      expect(normaliseStatus('en venta')).toBe('active');
    });
    it('defaults unknown/empty to active', () => {
      expect(normaliseStatus('banana')).toBe('active');
      expect(normaliseStatus(null)).toBe('active');
    });
  });

  describe('imagesArray (multi-image)', () => {
    it('wraps a single URL', () => expect(imagesArray('https://x/1.jpg')).toEqual(['https://x/1.jpg']));
    it('splits semicolon-separated URLs', () =>
      expect(imagesArray('https://x/1.jpg;https://x/2.jpg')).toEqual(['https://x/1.jpg', 'https://x/2.jpg']));
    it('splits pipe-separated URLs', () =>
      expect(imagesArray('https://x/1.jpg|https://x/2.jpg')).toEqual(['https://x/1.jpg', 'https://x/2.jpg']));
    it('splits space-separated http URLs', () =>
      expect(imagesArray('https://x/1.jpg https://x/2.jpg')).toEqual(['https://x/1.jpg', 'https://x/2.jpg']));
    it('returns [] for empty/non-string', () => {
      expect(imagesArray('')).toEqual([]);
      expect(imagesArray(null)).toEqual([]);
    });
  });

  describe('asNumberOrNull (es-ES money)', () => {
    it('parses plain', () => expect(asNumberOrNull('485000')).toBe(485000));
    it('parses euro thousands (lone dot + 3 digits)', () => expect(asNumberOrNull('€485.000')).toBe(485000));
    it('parses multi-dot thousands', () => expect(asNumberOrNull('1.250')).toBe(1250));
    it('parses thousands + decimal', () => expect(asNumberOrNull('1.250.000,50 €')).toBe(1250000.5));
    it('parses comma decimal', () => expect(asNumberOrNull('90,5')).toBe(90.5));
    it('preserves a genuine lone-dot decimal', () => expect(asNumberOrNull('90.5')).toBe(90.5));
    it('returns null for junk', () => expect(asNumberOrNull('n/a')).toBeNull());
  });

  describe('end-to-end: a messy real export (BOM + ; delimiter + quoted comma + Spanish status + multi-image)', () => {
    it('parses and resolves every field correctly', () => {
      const csv =
        '﻿Referencia;Título;Precio;Estado;Fotos\n' +
        'IC-1;"Villa en Jávea, con vistas";"€485.000";Vendido;"https://x/1.jpg;https://x/2.jpg"';
      const delim = detectDelimiter(csv);
      expect(delim).toBe(';');
      const parsed = parseCsv(stripBom(csv), delim);
      const { matched } = resolveColumns(parsed.header);
      const raw: Record<string, string> = {};
      parsed.header.forEach((h, i) => (raw[h] = parsed.rows[0][i]));
      // quoted comma preserved — NOT split into an extra column
      expect(raw[matched.title]).toBe('Villa en Jávea, con vistas');
      expect(raw[matched.external_id]).toBe('IC-1');
      expect(normaliseStatus(raw[matched.status])).toBe('sold');
      expect(asNumberOrNull(raw[matched.price])).toBe(485000);
      expect(imagesArray(raw[matched.images])).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    });
  });
});
