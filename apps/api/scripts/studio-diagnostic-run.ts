/**
 * ONE controlled Studio generation, on the real production route, with the full record printed.
 *
 * ⚠️  THIS SPENDS REAL MONEY AND WRITES A REAL ROW.
 *     It runs the actual content engine against the actual Anthropic account and inserts a real
 *     `image_generations` row for a real agency — the post appears in that agency's library. It is
 *     for deliberate, approved diagnostics only. It is never run by the test suite: it lives in
 *     scripts/, is not a *.test.ts, and refuses to start without an explicit --i-know flag.
 *
 * WHAT IS REAL AND WHAT IS NOT. It mounts the actual studio-wizard router and the actual
 * agencyContextMiddleware, so option assembly, the transaction, the GUCs, RLS and the engine are
 * the ones production uses. The ONLY layer replaced is JWT verification — the middleware that turns
 * a Supabase token into `user`. It also runs from wherever you run it, so page-fetch latency is
 * your network's, not Railway's.
 *
 * No credentials are embedded. Everything comes from the repo-root .env via dotenv, exactly as the
 * API does; the agency and the acting user are arguments.
 *
 *   npx tsx apps/api/scripts/studio-diagnostic-run.ts --i-know \
 *     --agency <agency_id> --user <auth_user_uuid> --topic "…"           # run one, then print it
 *   npx tsx apps/api/scripts/studio-diagnostic-run.ts --read <generation_id>   # print an old one
 */
import 'dotenv/config';
import { Hono } from 'hono';
import { agencyContextMiddleware } from '../src/middleware/agency-context';
import studioWizardRoute from '../src/routes/studio-wizard';
import { supabaseAdmin } from '../src/lib/supabase-admin';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const money = (n: number) => `$${n.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Print everything a generation recorded about itself. Read-only. */
async function readOut(id: string): Promise<void> {
  const { data } = await supabaseAdmin.from('image_generations')
    .select('status, created_at, completed_at, failure_reason, result_metadata').eq('id', id).single();
  if (!data) { console.error(`no generation ${id}`); process.exit(1); }
  const r = data as Record<string, any>;
  const m = r.result_metadata ?? {};
  const u = m.usage ?? {};
  const src = m.research_sources ?? [];
  const elapsed = (new Date(r.completed_at ?? Date.now()).getTime() - new Date(r.created_at).getTime()) / 1000;

  const rt = m.routing;
  console.log('\n══ HEADLINE ══');
  for (const [k, v] of [
    ['status', r.status], ['elapsed', `${elapsed.toFixed(1)}s`],
    ['risk tier', rt ? `${String(rt.tier).toUpperCase()} (${rt.signal}) — ${rt.why}` : '(not recorded)'],
    ['research ran', rt ? (rt.researched ? 'yes' : 'no') : '(not recorded)'],
    ['escalated', rt?.escalated ? `YES — ${rt.escalatedWhy}` : 'no'],
    ['cost', money(u.totalCostUsd ?? 0)], ['model calls', u.calls ?? 0],
    ['input tokens', (u.inputTokens ?? 0).toLocaleString()],
    ['output tokens', (u.outputTokens ?? 0).toLocaleString()],
    ['cache read', (u.cacheReadTokens ?? 0).toLocaleString()],
    ['cache written', (u.cacheCreationTokens ?? 0).toLocaleString()],
    ['pages opened', `${src.filter((s: any) => s.opened).length} of ${src.length}`],
    ['pages timed out', (m.fact_health?.timedOut ?? []).join(', ') || 'none'],
    ['palette degraded', m.fact_health?.degraded ?? 'no'],
    ['rewrite', m.rewrite ? `yes — ${m.rewrite.slidesBefore} → ${m.rewrite.slidesAfter}, kept ${m.rewrite.kept}` : 'no'],
    ['editor', m.copy_qa?.outcome ?? '(none)'],
    ['slides standing', m.plan?.tips?.length ?? 0],
    ['claims removed', m.claim_qa?.blocked?.length ?? 0],
    ['failure', r.failure_reason ?? '(succeeded)'],
  ] as Array<[string, unknown]>) console.log(`${k.padEnd(20)} ${String(v)}`);

  console.log('\n══ COST BY STAGE ══');
  for (const s of u.byStage ?? []) {
    console.log(`  ${String(s.stage).padEnd(28)} ${money(s.costUsd).padStart(9)} ${String(s.calls).padStart(3)} calls`
      + `  in ${s.inputTokens.toLocaleString().padStart(9)}  out ${s.outputTokens.toLocaleString().padStart(7)}`);
  }
  console.log('\n══ TIME BY STAGE ══');
  for (const [k, v] of Object.entries(m.timings ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log(`  ${k.padEnd(28)} ${secs(v as number).padStart(9)}`);
  }
  console.log('\n══ REQUIREMENT COVERAGE ══');
  for (const c of m.requirement_coverage ?? []) console.log(`  [${c.status}] ${c.id ?? ''} ${String(c.text ?? '').slice(0, 100)}`);
  console.log('\n══ SOURCES ══');
  for (const s of src) {
    console.log(`  ${String(s.source_id).padEnd(4)} ${s.opened ? 'OPENED ' : 'listed '}`
      + `${String(s.source_class).padEnd(20)} ${String(s.content_chars ?? 0).padStart(7)} chars  ${s.domain}`);
  }
  console.log('\n══ CLAIMS REMOVED ══');
  for (const b of m.claim_qa?.blocked ?? []) {
    console.log(`  · [${b.field}] "${String(b.text).slice(0, 96)}"`);
    console.log(`      ${String(b.problem ?? b.verdict).slice(0, 170)}`);
    if (b.outcome) console.log(`      → ${String(b.outcome).slice(0, 150)}`);
  }
  console.log('\n══ COPY ══');
  const p = m.plan ?? {};
  console.log(`eyebrow     ${p.eyebrow ?? ''}\nhook        ${p.hook_title ?? ''}`);
  (p.tips ?? []).forEach((t: any, i: number) => {
    console.log(`\n  SLIDE ${i + 1}\n    title  ${t.title}\n    body   ${t.body}`);
  });
  console.log(`\ncta         ${p.cta_action ?? ''}\ncaption     ${(p.caption ?? '').slice(0, 400)}`);
}

async function main(): Promise<void> {
  const read = flag('read');
  if (read) { await readOut(read); process.exit(0); }

  if (!argv.includes('--i-know')) {
    console.error('This spends real money and writes a real generation row into a real agency\'s '
      + 'library.\nRe-run with --i-know if that is what you intend, or use --read <id> to print an '
      + 'existing record.');
    process.exit(1);
  }
  const agency = flag('agency');
  const user = flag('user');
  const topic = flag('topic');
  if (!agency || !user || !topic) {
    console.error('need --agency <agency_id> --user <auth_user_uuid> --topic "…"');
    process.exit(1);
  }

  const app = new Hono();
  // Stands in for authMiddleware ONLY — everything below it is the real thing.
  app.use('/api/*', async (c, next) => { c.set('user', { sub: user, email: '' }); await next(); });
  app.use('/api/*', agencyContextMiddleware);
  app.route('/api/studio', studioWizardRoute);

  const body = {
    type: 'tips', topic, style: flag('style') ?? 'cartel', scheme: flag('scheme') ?? 'clasico',
    language: flag('language') ?? 'en', slide_count: Number(flag('slides') ?? 5),
    include_context: false, include_recap: false,
  };
  console.log('REQUEST', JSON.stringify(body, null, 2));

  const t0 = Date.now();
  const res = await app.request('/api/studio/carousel', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const started = (await res.json()) as { generation_id?: string };
  console.log(`POST ${res.status}`, JSON.stringify(started));
  const id = started.generation_id;
  if (!id) { console.error('no generation started'); process.exit(1); }
  console.log(`\nGENERATION ${id} — polling…`);

  // The route returns at once and the engine runs fire-and-forget, so hold the process open.
  for (let i = 0; i < 240; i++) {
    await new Promise((x) => setTimeout(x, 5000));
    const { data } = await supabaseAdmin.from('image_generations').select('status').eq('id', id).single();
    const st = (data as { status?: string } | null)?.status;
    if (i % 6 === 0) console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${st}`);
    if (st && st !== 'processing') {
      console.log(`\nFINISHED: ${st} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await readOut(id);
      process.exit(0);
    }
  }
  console.error('still running after 20 minutes');
  process.exit(2);
}

main().catch((e) => { console.error('THREW:', e?.stack ?? e); process.exit(1); });
