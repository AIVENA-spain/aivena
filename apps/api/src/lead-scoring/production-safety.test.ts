import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { planLead, rescoreAllowed, type RescoreLeadRow } from './rescore-plan';
import { SERVICE_SOURCE } from './source';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

describe('only live-provenance scores can reach a screen (Stage 3b, Christian 2026-09-13)', () => {
  it.each([
    ['../routes/overview.ts', [/temperature: r\.temperature/, /score: r\.score/]],
    ['../routes/tasks.ts', [/score: r\.score/, /temperature: r\.temperature/, /intent: r\.intent/]],
    ['../routes/operations.ts', [/temperature: x\.temperature/]],
    ['../routes/leads.ts', [/\(r\.temperature as string \| null\)/, /r\.score != null \? Number\(r\.score\)/, /\(r\.urgency as string \| null\)/]],
  ])('%s passes no raw score, temperature, intent or urgency', (file, raw) => {
    const src = read(file as string);
    for (const pattern of raw as RegExp[]) expect(src, String(pattern)).not.toMatch(pattern);
    expect(src).toMatch(/lead-scoring\/live-scores-db/);
  });
  it('Matches runs both of its lead lists through the guard', () => {
    expect(read('../routes/matches.ts').match(/withLiveScores\(tx, rows, 'lead_id'\)/g)).toHaveLength(2);
  });
  it('the guard reads the lead’s own score columns, never a score a task saved earlier', () => {
    const src = read('./live-scores-db.ts');
    expect(src).toMatch(/l\.score_source = \$\{SERVICE_SOURCE\}/);
    expect(src).not.toMatch(/dt\.temperature|dt\.lead_score|dashboard_tasks/);
  });
});

describe('scoring cannot trigger a send (Christian: no sends, tasks, alerts or follow-ups from scores)', () => {
  const engineDir = join(__dirname, '../amanda-engine');
  const sendPaths = [
    ...readdirSync(engineDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(engineDir, f)),
    join(__dirname, '../../../../supabase/functions/whatsapp-send-execute/index.ts'),
    join(__dirname, '../../../../supabase/functions/whatsapp-send-template/index.ts'),
    join(__dirname, '../../../../supabase/functions/twilio-whatsapp-inbound/index.ts'),
  ];
  const LEAD_SCORE_READ = /\b(l|lead|leads)\.(temperature|score)\b|\blead_score\b|\bby_temperature\b|\bscore_source\b/;
  it.each(sendPaths.map((p) => [p.split('/').slice(-2).join('/'), p]))('%s reads no lead score, temperature or temperature lane', (_label, file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(LEAD_SCORE_READ);
  });
  it('the scorer is the only module that writes a lead score, and it writes no task, queue row, event or message', () => {
    const worker = read('./worker.ts');
    expect(worker).not.toMatch(/INSERT INTO (send_queue|dashboard_tasks|lead_events|conversation_messages)/i);
  });
});

describe('re-score at go-live: the rule per lead, and it cannot run early', () => {
  const row = (over: Partial<RescoreLeadRow>): RescoreLeadRow => ({
    lead_id: 'L', full_name: 'x', status: 'active', opt_in_status: 'opted_in', score: null, temperature: null, scored_at: null,
    intent: null, urgency: null, has_reasoning: false, score_source: null, inbound_messages: 0, ...over,
  });
  const june = { score: 75, temperature: 'warm', scored_at: '2026-06-19T10:58:29Z', intent: 'buy', urgency: 'medium', has_reasoning: true };
  it('June data and messages to read: archived and cleared, then scored for real', () => {
    const p = planLead(row({ ...june, inbound_messages: 15 }));
    expect(p.action).toBe('rescore_and_clear_legacy');
    expect(p.legacyFields).toEqual(['score', 'temperature', 'scored_at', 'intent', 'urgency', 'reasoning_summary']);
  });
  it('June data and nothing to read: archived and cleared, not re-scored', () => {
    expect(planLead(row({ ...june, inbound_messages: 0 }))).toMatchObject({ action: 'clear_legacy' });
  });
  it('a closed or opted-out lead keeps no June data and is not scored', () => {
    expect(planLead(row({ ...june, inbound_messages: 9, status: 'lost' }))).toMatchObject({ action: 'clear_legacy' });
    expect(planLead(row({ ...june, inbound_messages: 9, opt_in_status: 'opted_out' }))).toMatchObject({ action: 'clear_legacy' });
  });
  it('a live score is never cleared', () => {
    expect(planLead(row({ ...june, score_source: SERVICE_SOURCE, inbound_messages: 9 }))).toMatchObject({ action: 'nothing', legacyFields: [] });
  });
  it('no June data and no messages: nothing to do', () => {
    expect(planLead(row({}))).toMatchObject({ action: 'nothing' });
  });
  it('execute refuses unless scoring is live AND writing — false with the switch values in code today', () => {
    expect(rescoreAllowed()).toBe(false);
    expect(rescoreAllowed(true, 'shadow')).toBe(false);
    expect(rescoreAllowed(false, 'write')).toBe(false);
    expect(rescoreAllowed(true, 'write')).toBe(true);
  });
  it('the execute handler checks that before anything else', () => {
    const src = read('../routes/admin/scoring-rescore.ts');
    const handler = src.slice(src.indexOf("route.post('/execute'"));
    expect(handler.indexOf('rescoreAllowed()')).toBeGreaterThan(-1);
    expect(handler.indexOf('rescoreAllowed()')).toBeLessThan(handler.indexOf('withAgency') === -1 ? Infinity : handler.indexOf('activeAgencies'));
  });
});
