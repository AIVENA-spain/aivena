import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emailProviderView, resolveAutomationPosture, whatsappProviderView } from './automation-state';
import { computeOperations } from './operations/compute';

// D-54a (2026-09-18): the demo agency ran amanda_mode=full while five screens,
// reading older fields the engine ignores, said "Approval-first", "replies off",
// "automation off" or "the WhatsApp channel is off".
describe('resolveAutomationPosture — the mode is the only input', () => {
  it.each(['assisted', 'full'])('%s is never described as approval-first or safe-by-default', (m) => {
    const p = resolveAutomationPosture(m)!;
    expect(p.sendsWithoutReview).toBe(true);
    expect(p.status).toBe('live_but_unproven');
    expect(p.copy).not.toMatch(/approval-first|reviews before/i);
  });

  it.each(['off', 'shadow', 'approval'])('%s sends nothing without a person', (m) => {
    const p = resolveAutomationPosture(m)!;
    expect(p.sendsWithoutReview).toBe(false);
    expect(p.status).toBe('ready');
  });

  it('only approval mode is called approval-first', () => {
    expect(resolveAutomationPosture('approval')!.label).toBe('Approval-first');
    for (const m of ['off', 'shadow', 'assisted', 'full']) {
      expect(resolveAutomationPosture(m)!.label).not.toBe('Approval-first');
    }
  });

  it('an unreadable mode is unavailable, never a guess', () => {
    expect(resolveAutomationPosture(null)).toBeNull();
    expect(resolveAutomationPosture(undefined)).toBeNull();
  });

  it('an unknown stored value fails closed to off', () => {
    expect(resolveAutomationPosture('turbo')!.mode).toBe('off');
  });
});

describe('whatsappProviderView — connection and delivery, never the old channel flag', () => {
  const proven = { whatsapp_sender_ready: true, template_send_path_proven: true };

  it('connected and proven is ready at every automation level', () => {
    for (const m of ['off', 'shadow', 'approval', 'assisted', 'full']) {
      expect(whatsappProviderView(proven, resolveAutomationPosture(m)).status).toBe('ready');
    }
  });

  it('never says the channel or automation is off', () => {
    for (const m of [null, 'off', 'shadow', 'approval', 'assisted', 'full']) {
      const v = whatsappProviderView(proven, resolveAutomationPosture(m));
      expect(`${v.uiCopy} ${v.detail}`).not.toMatch(/channel is off|automation off|switched on/i);
    }
  });

  it('full automation reads as sending', () => {
    expect(whatsappProviderView(proven, resolveAutomationPosture('full')).detail).toBe('Connected and sending.');
  });

  it('connected but never delivered is unproven; not connected is missing', () => {
    expect(whatsappProviderView({ whatsapp_sender_ready: true, template_send_path_proven: false }, null).status).toBe('live_but_unproven');
    expect(whatsappProviderView({ whatsapp_sender_ready: false, template_send_path_proven: false }, null).status).toBe('missing');
  });
});

describe('no status screen reads the fields the engine ignores', () => {
  const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

  it('readiness posture comes from amanda_mode, not the reply-lane fields', () => {
    const src = read('readiness/compute.ts');
    expect(src).toMatch(/resolveAutomationPosture\(/);
    expect(src).not.toMatch(/reply_handling_mode === 'manual'/);
  });

  it('WhatsApp status on readiness and Operations ignores whatsapp_channel_enabled', () => {
    for (const f of ['readiness/compute.ts', 'operations/compute.ts']) {
      const src = read(f);
      expect(src, f).toMatch(/whatsappProviderView\(/);
      expect(src, f).not.toMatch(/wa\.whatsapp_channel_enabled\s*&&|!wa\.whatsapp_channel_enabled/);
    }
  });

  it('Operations shows agencies no internal build references', () => {
    const res = computeOperations('x', { failedSends: [], openTasks: [], lifecycle: [], whatsapp: null, email: null, nowMs: 0 });
    const shown = [res.failedSends.note, ...res.providers.map((p) => p.detail)].join(' ');
    expect(shown).not.toMatch(/\bF\d\b|Chat \d|channel is off/);
  });
});

describe('emailProviderView — one email answer for Settings and Operations', () => {
  it('ready only when configured AND a real send is proven', () => {
    expect(emailProviderView({ configured: true, sendProven: true }).status).toBe('ready');
    expect(emailProviderView({ configured: true, sendProven: false }).status).toBe('live_but_unproven');
    expect(emailProviderView({ configured: false, sendProven: true }).status).toBe('missing');
  });

  it('readiness and Operations both decide email through it, and Operations reads the proof signal', () => {
    const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
    expect(read('readiness/compute.ts')).toMatch(/emailProviderView\(/);
    expect(read('operations/compute.ts')).toMatch(/emailProviderView\(/);
    expect(readFileSync(join(__dirname, '../routes/operations.ts'), 'utf8')).toMatch(/dashboard_settings\(0\)->'profile'/);
  });
});
