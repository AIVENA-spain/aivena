import { describe, it, expect } from 'vitest';
import { screenFuturePromise, FUTURE_PROMISE_LANGUAGES, SUPPORTED_LANGUAGES, validateDraft } from './validators';

// Christian 2026-09-19 (binding): Amanda must not promise to "come back", "check
// and return" or otherwise act later on her own — nothing in the system can do
// it. Live miss that day: "La meg sjekke hva vi har ledig i morgen, så kommer jeg
// straks tilbake med tider." passed the old fixed-word-order list, which caught
// 2 of 9 natural phrasings. This is the minimum regression set, per language.
const MUST_CATCH: Record<string, string[]> = {
  en: [
    "I'll check the calendar and come right back to you.",
    'Let me look into it and write back to you tonight.',
    "Let me check what's free tomorrow and I'll come straight back with times.",
    "Let me check and get back to you.",
    "I'll get back to you shortly with some options.",
    'I will come right back to you with the details.',
    "I'm coming back to you in a bit with prices.",
    "I'll let you know once I've checked the calendar.",
    "We'll send you the floor plans later today.",
    "I'll be in touch with a few more ideas.",
    'Let me come back to you with a few listings.',
  ],
  es: [
    'Déjame revisar y vuelvo enseguida con los horarios.',
    'Lo miro y vuelvo contigo en un rato.',
    'Te escribiré en cuanto lo tenga.',
    'Te aviso enseguida con las opciones.',
    'Te mando opciones enseguida.',
    'Me pondré en contacto contigo mañana.',
    'Le respondo en un momento con la información.',
  ],
  de: [
    'Ich prüfe das und komme gleich auf dich zurück.',
    'Ich schaue nach, dann melde ich mich gleich mit Zeiten.',
    'Ich melde mich bald mit ein paar Vorschlägen.',
    'Ich komme gleich mit den Zeiten auf dich zurück.',
    'Dann komme ich mit den Details zurück.',
    'Ich gebe dir gleich Bescheid.',
    'Ich schicke dir die Unterlagen später.',
    'Du bekommst gleich eine Rückmeldung von mir.',
  ],
  nl: [
    'Ik zoek het uit en kom er zo bij je op terug.',
    'Ik kijk even, dan kom ik zo terug met tijden.',
    'Ik kom er zo bij je op terug.',
    'Ik laat het je zo snel mogelijk weten.',
    'Ik stuur je straks een paar opties.',
    'Ik neem morgen contact met je op.',
    'We komen er later op terug.',
  ],
  fr: [
    'Je vérifie et je reviens vers vous tout de suite.',
    'Je reviens vers vous avec les horaires.',
    'Je vous recontacte dès que possible.',
    'Je vous tiens au courant.',
    'Je vous envoie les plans plus tard.',
    'Je reviens rapidement avec des options.',
  ],
  it: [
    'Controllo e ti faccio sapere.',
    'Ti ricontatto appena ho gli orari.',
    'Ti rispondo subito con i dettagli.',
    'Ti mando le foto più tardi.',
    'Torno da te con le opzioni.',
    'Mi faccio sentire domani.',
  ],
  pt: [
    'Digo-te algo logo que puder.',
    'Deixa-me verificar e volto já com os horários.',
    'Volto com as opções em breve.',
    'Entro em contacto contigo amanhã.',
    'Aviso-te logo que souber.',
    'Te envio as plantas mais tarde.',
    'Dou-te notícias hoje.',
  ],
  pl: [
    'Sprawdzę i wrócę z terminami.',
    'Zaraz wracam z odpowiedzią.',
    'Odezwę się jutro.',
    'Dam ci znać, jak tylko sprawdzę.',
    'Prześlę ci zdjęcia później.',
    'Skontaktuję się z tobą wkrótce.',
  ],
  sv: [
    'Jag kollar med kontoret och kommer strax tillbaka till dig.',
    'Jag kollar vad som är ledigt, så kommer jag tillbaka strax med tider.',
    'Kommer tillbaka strax med några förslag.',
    'Jag återkommer strax.',
    'Jag hör av mig imorgon.',
    'Jag ger dig besked så snart jag vet.',
    'Jag skickar dig ritningarna senare.',
  ],
  nb: [
    'Jeg sjekker kalenderen og kommer straks tilbake til deg.',
    'La meg sjekke hva vi har ledig i morgen, så kommer jeg straks tilbake med tider.',
    'Jeg kommer straks tilbake med tider.',
    'Jeg sjekker nye boliger nå. Kommer straks tilbake med konkrete alternativer!',
    'Hei igjen! Jeg sender deg forslag straks.',
    'Jeg gir deg beskjed så snart jeg vet.',
    'Du hører fra meg i morgen.',
    'Jeg tar kontakt senere i dag.',
    'Vi vender tilbake med flere forslag.',
  ],
  da: [
    'Jeg tjekker kalenderen og vender straks tilbage til dig.',
    'Jeg tjekker, hvad der er ledigt, så vender jeg straks tilbage med tider.',
    'Jeg vender tilbage med det samme.',
    'Jeg giver dig besked, når jeg ved det.',
    'Du hører fra mig i morgen.',
    'Jeg sender dig tegningerne senere.',
    'Kommer straks tilbage med forslag.',
  ],
  fi: [
    'Tarkistan ja palaan asiaan heti.',
    'Palaan aikojen kanssa pian.',
    'Ilmoitan sinulle huomenna.',
    'Otan sinuun yhteyttä myöhemmin.',
    'Lähetän kuvat myöhemmin.',
    'Kerron lisää pian.',
  ],
  ru: [
    'Проверю и сразу вернусь к вам с ответом.',
    'Я вернусь с вариантами.',
    'Сообщу вам завтра.',
    'Напишу, как только узнаю.',
    'Дам вам знать позже.',
    'Пришлю планировки чуть позже.',
  ],
};

// What must NOT trip the law: welcome-backs, the buyer coming back, offers and
// questions to the buyer, and sending the times RIGHT NOW in the same message.
const MUST_PASS: Record<string, string[]> = {
  en: ['Welcome back!', 'When do you come back to Spain?', 'I can do Monday 21 September at 11:00 or 12:00 — which suits you?', 'Let me know which time works for you.', 'Here are the times: Monday 11:00 or 12:00.'],
  es: ['¿Cuándo vuelves a España?', 'Te envío los horarios: lunes 21 a las 11:00 o 12:00.', 'Por la mañana hay dos huecos: 11:00 y 12:00.', 'Avísame qué hora te va mejor.'],
  de: ['Guten Morgen!', 'Wann kommst du zurück nach Spanien?', 'Ich schicke dir die Zeiten: Montag 11:00 oder 12:00.', 'Kommen Sie gerne vorbei.'],
  nl: ['Goedemorgen!', 'Kom je terug naar Spanje?', 'Ik stuur je de tijden: maandag 11:00 of 12:00.', 'Laat me weten welke tijd past.'],
  fr: ['Revenez-vous en Espagne en octobre ?', 'Je vous envoie les créneaux : lundi 11h00 ou 12h00.', 'Dites-moi ce qui vous convient.'],
  it: ['Il volto del quartiere è cambiato.', 'Ti mando gli orari: lunedì alle 11:00 o alle 12:00.', 'Fammi sapere quale orario preferisci.'],
  pt: ['Quando voltas a Espanha?', 'Envio-te os horários: segunda às 11:00 ou 12:00.', 'Diz-me qual preferes.'],
  pl: ['Kiedy wrócisz do Hiszpanii?', 'Wysyłam terminy: poniedziałek 11:00 lub 12:00.', 'Daj znać, która godzina pasuje.'],
  sv: ['Välkommen tillbaka!', 'Återkommer du till Spanien i oktober?', 'Här är tiderna: måndag 11:00 eller 12:00.', 'Hör av dig om du vill se fler.'],
  nb: ['Velkommen tilbake!', 'Når kommer du tilbake til Spania?', 'Jeg sender deg tidene: mandag 21. september kl. 11:00 eller 12:00.', 'Gi meg beskjed om hvilken tid som passer.'],
  da: ['Velkommen tilbage!', 'Hvornår kommer du tilbage til Spanien?', 'Her er tiderne: mandag kl. 11.00 eller 12.00.', 'Giv mig besked om, hvad der passer dig.'],
  fi: ['Tervetuloa takaisin!', 'Milloin palaat Espanjaan?', 'Tässä ajat: maanantai klo 11.00 tai 12.00.', 'Kerro, mikä aika sopii.'],
  ru: ['Когда вы вернётесь в Испанию?', 'Отправляю варианты: понедельник в 11:00 или 12:00.', 'Скажите, какое время вам удобнее.'],
};

describe('deliver-now law covers every supported language', () => {
  it('has patterns for all 13 languages', () => {
    expect([...FUTURE_PROMISE_LANGUAGES].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });
});

for (const lang of SUPPORTED_LANGUAGES) {
  describe(`deliver-now law — ${lang}`, () => {
    it.each(MUST_CATCH[lang] ?? [])('catches: %s', (text) => {
      expect(screenFuturePromise(text, false).ok).toBe(false);
    });
    it.each(MUST_PASS[lang] ?? [])('leaves alone: %s', (text) => {
      expect(screenFuturePromise(text, false).ok).toBe(true);
    });
  });
}

describe('office promises are judged by whether a ticket exists', () => {
  const office = 'Jeg sjekker med kontoret og kommer straks tilbake til deg med svaret.';
  it('with a filed office question, the office sentence is legal', () => {
    expect(screenFuturePromise(office, true).ok).toBe(true);
  });
  it('with NO ticket, the same promise is not kept by anything, so it is flagged', () => {
    expect(screenFuturePromise(office, false).ok).toBe(false);
  });
  it('naming the office in ANOTHER sentence no longer excuses a self promise', () => {
    expect(screenFuturePromise('The office is open until six. I will come back to you with times.', true).ok).toBe(false);
  });
});

describe('validateDraft carries the live turn context into the law', () => {
  it('the exact live 2026-09-19 reply is rejected', () => {
    const live = 'Hei Marte! Ja, villaen ligger fortsatt bare rundt 700 meter fra den norske skolen – ca 9 minutters gange.\n\nLa meg sjekke hva vi har ledig i morgen, så kommer jeg straks tilbake med tider.';
    const v = validateDraft(live, { officeContextPresent: false });
    expect(v.violations.join(',')).toContain('self_future_promise');
  });
});
