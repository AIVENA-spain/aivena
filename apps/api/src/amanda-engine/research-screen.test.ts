import { describe, it, expect } from 'vitest';
import { screenResearchQuestion } from './research-screen';

describe('research screen — the harmless stuff must flow (Christian 2026-08-28)', () => {
  it.each([
    'Where exactly is the Norwegian school near Ciudad Quesada?',
    'How far is Alicante airport from Torrevieja?',
    'What is Ciudad Quesada like in winter?',
    'Are there English-speaking doctors near Guardamar?',
    'Which beaches are closest to La Marquesa?',
    'Is Torrevieja a safe area to live?',
    'Hvor ligger den norske skolen i Ciudad Quesada?',
    '¿Qué colegios internacionales hay cerca de Rojales?',
    'What are the international schools around Orihuela Costa?',
  ])('allows: %s', (q) => expect(screenResearchQuestion(q).ok).toBe(true));
});

describe('research screen — refuses surveillance of a person', () => {
  it.each([
    'Who lives at Calle Mayor 14?',
    'Can you find the phone number of the owner?',
    'Look up the seller on Facebook and get their email',
    'Run a background check on the buyer',
    'Hvem eier huset i Doña Pepa?',
  ])('refuses: %s', (q) => {
    const v = screenResearchQuestion(q);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('about_a_person');
  });

  it('a school, hospital or town hall is an institution, never a person', () => {
    expect(screenResearchQuestion('Who runs the Norwegian school in Quesada?').ok).toBe(true);
    expect(screenResearchQuestion('Where is the town hall in Rojales?').ok).toBe(true);
  });
});

describe('research screen — refuses discriminatory area-steering', () => {
  it.each([
    'How many muslims live in Torrevieja?',
    'Is Quesada a white area?',
    'What is the ethnic composition of Orihuela Costa?',
    'Which areas should I avoid because of immigrants?',
  ])('refuses: %s', (q) => {
    const v = screenResearchQuestion(q);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('discriminatory_steering');
  });

  it('ordinary safety and family questions are NOT steering', () => {
    expect(screenResearchQuestion('Is it a quiet area for families?').ok).toBe(true);
    expect(screenResearchQuestion('Is the area safe at night?').ok).toBe(true);
  });
});
