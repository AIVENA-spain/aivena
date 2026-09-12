/**
 * The 11 practice conversations of 2026-09-11, with the result each should get, written BEFORE any run.
 * Ten are made up; #8 is the demo agency's Norwegian viewing conversation with the lead's name removed, because this
 * repository is public. Used only by the internal scoring check and the tests: never real leads.
 */
import type { Band, Facts, ScoringInput } from './types';

export type ScoringFixture = {
  id: number;
  title: string;
  /** Christian: a band slip on these is minor ("#2 and #11 ... less serious"). */
  minor?: boolean;
  expected: { score: number | null; band: Band; range?: [number, number]; why: string };
  /** The facts a perfect reader would extract: feeds the rubric test. */
  expectedFacts: Facts;
  input: ScoringInput;
};

export const SCORING_FIXTURES: ScoringFixture[] = [
  {
    "id": 1,
    "title": "Spam",
    "expected": {
      "score": 0,
      "band": "not_a_lead",
      "why": "Spam is not a lead at all."
    },
    "expectedFacts": {
      "real_lead": false,
      "budget": {
        "state": "none"
      },
      "area": {
        "state": "none"
      },
      "need": {
        "state": "none"
      },
      "specific_property": {
        "state": "none"
      },
      "timing": {
        "state": "unknown"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": false
      },
      "financing_ready": {
        "present": false
      },
      "not_a_lead_reason": "spam"
    },
    "input": {
      "now": "2026-09-10T09:30:00Z",
      "conversation": [
        {
          "at": "2026-09-10T09:00:00Z",
          "from": "lead",
          "text": "🚀 Boost your Instagram today! 10,000 real followers for only €9.99. Reply YES to order now!"
        }
      ]
    }
  },
  {
    "id": 2,
    "title": "Vague: maybe moving to Spain one day",
    "minor": true,
    "expected": {
      "score": 20,
      "band": "very_cold",
      "why": "Curious, no area, budget or timing; mentions a country and replies once."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "curious",
      "budget": {
        "state": "none"
      },
      "area": {
        "state": "vague"
      },
      "need": {
        "state": "none"
      },
      "specific_property": {
        "state": "none"
      },
      "timing": {
        "state": "later"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": false
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T09:40:00Z",
      "conversation": [
        {
          "at": "2026-09-10T09:00:00Z",
          "from": "lead",
          "text": "Hi! We're thinking we might move to Spain one day, maybe in a few years. What are prices like around there?"
        },
        {
          "at": "2026-09-10T09:02:00Z",
          "from": "agency",
          "text": "Lovely to hear from you! Which area are you thinking of, and roughly what budget?"
        },
        {
          "at": "2026-09-10T09:10:00Z",
          "from": "lead",
          "text": "No idea yet, just curious really."
        }
      ]
    }
  },
  {
    "id": 3,
    "title": "Only \"is this still available?\"",
    "expected": {
      "score": 50,
      "band": "warm",
      "why": "Christian: 45–55 when they only ask about availability and give nothing else."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "none"
      },
      "area": {
        "state": "none"
      },
      "need": {
        "state": "none"
      },
      "specific_property": {
        "state": "availability_only"
      },
      "timing": {
        "state": "unknown"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": false
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T11:30:00Z",
      "conversation": [
        {
          "at": "2026-09-10T11:00:00Z",
          "from": "lead",
          "text": "Hi, is this villa still available? Ref IC-81596"
        }
      ]
    }
  },
  {
    "id": 4,
    "title": "Edge: availability, then a concrete question",
    "expected": {
      "score": 66,
      "band": "warm",
      "why": "Christian: 60–69 if they keep replying or ask something concrete, with no budget, area, need or viewing yet."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "none"
      },
      "area": {
        "state": "none"
      },
      "need": {
        "state": "none"
      },
      "specific_property": {
        "state": "discussed"
      },
      "timing": {
        "state": "unknown"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": true
      },
      "asked_for_listings_or_photos": {
        "present": true
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T12:40:00Z",
      "conversation": [
        {
          "at": "2026-09-10T12:00:00Z",
          "from": "lead",
          "text": "Is the townhouse in Torrevieja, ref MI3321, still available?"
        },
        {
          "at": "2026-09-10T12:03:00Z",
          "from": "agency",
          "text": "Yes, it is! Would you like more photos or details?"
        },
        {
          "at": "2026-09-10T12:10:00Z",
          "from": "lead",
          "text": "Yes please. Does it have its own parking, and how far is it to the beach?"
        }
      ]
    }
  },
  {
    "id": 5,
    "title": "Area and need, no budget (Spanish)",
    "expected": {
      "score": 64,
      "band": "warm",
      "why": "Two of budget/area/need clear, asked what we have, no timing."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "none"
      },
      "area": {
        "state": "clear"
      },
      "need": {
        "state": "clear"
      },
      "specific_property": {
        "state": "none"
      },
      "timing": {
        "state": "unknown"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": true
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T10:45:00Z",
      "conversation": [
        {
          "at": "2026-09-10T10:00:00Z",
          "from": "lead",
          "text": "Hola, busco un apartamento de 2 dormitorios cerca de la playa en Guardamar o La Mata. ¿Qué tenéis?"
        },
        {
          "at": "2026-09-10T10:04:00Z",
          "from": "agency",
          "text": "¡Hola! Tenemos varias opciones. ¿Qué presupuesto aproximado tienes?"
        },
        {
          "at": "2026-09-10T10:15:00Z",
          "from": "lead",
          "text": "Todavía no lo sé, depende de lo que haya."
        }
      ]
    }
  },
  {
    "id": 6,
    "title": "Budget, area and need clear, no viewing (Dutch)",
    "expected": {
      "score": 76,
      "band": "hot",
      "why": "All three clear; buying next spring is not within 30 days; no viewing."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "clear"
      },
      "area": {
        "state": "clear"
      },
      "need": {
        "state": "clear"
      },
      "specific_property": {
        "state": "none"
      },
      "timing": {
        "state": "later"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": true
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T13:42:00Z",
      "conversation": [
        {
          "at": "2026-09-10T13:00:00Z",
          "from": "lead",
          "text": "Hallo, wij zoeken een vrijstaande villa met 3 slaapkamers en een zwembad in Ciudad Quesada of Rojales. Ons budget is rond de €420.000. We willen volgend voorjaar kopen."
        },
        {
          "at": "2026-09-10T13:05:00Z",
          "from": "agency",
          "text": "Dank u wel! Ik stuur u vandaag een paar opties die passen."
        },
        {
          "at": "2026-09-10T13:12:00Z",
          "from": "lead",
          "text": "Graag, dank u."
        }
      ]
    }
  },
  {
    "id": 7,
    "title": "Viewing agreed and settled, finance confirmed (German)",
    "expected": {
      "score": 93,
      "band": "super_hot",
      "why": "85 +3 settled +2 specific villa +1 within 7 days +2 financing; no own need stated."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "clear"
      },
      "area": {
        "state": "none"
      },
      "need": {
        "state": "none"
      },
      "specific_property": {
        "state": "discussed"
      },
      "timing": {
        "state": "within_30_days"
      },
      "viewing": {
        "state": "agreed_settled",
        "within_7_days": true
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": false
      },
      "financing_ready": {
        "present": true
      }
    },
    "input": {
      "now": "2026-09-10T10:30:00Z",
      "conversation": [
        {
          "at": "2026-09-10T09:40:00Z",
          "from": "lead",
          "text": "Guten Tag, wir interessieren uns für die Villa IC-62026 in Ciudad Quesada. Unser Budget liegt bei maximal 420.000 €. Können wir sie nächste Woche besichtigen?"
        },
        {
          "at": "2026-09-10T09:45:00Z",
          "from": "agency",
          "text": "Sehr gern! Passt Ihnen Dienstag, der 15. September, um 11:00 Uhr?"
        },
        {
          "at": "2026-09-10T10:00:00Z",
          "from": "lead",
          "text": "Dienstag um 11:00 passt perfekt. Wir kommen zu zweit. Die Finanzierung ist übrigens schon von unserer Bank bestätigt."
        }
      ]
    }
  },
  {
    "id": 8,
    "title": "Norwegian family: viewing agreed, then a reschedule request (anonymised demo conversation)",
    "expected": {
      "score": 89,
      "band": "super_hot",
      "why": "85 +0 not settled +2 specific villa +1 clear need +1 within 7 days. Scored as the live system would: 30 minutes after the last message."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "clear"
      },
      "area": {
        "state": "clear"
      },
      "need": {
        "state": "clear"
      },
      "specific_property": {
        "state": "discussed"
      },
      "timing": {
        "state": "within_30_days"
      },
      "viewing": {
        "state": "agreed_change_pending",
        "within_7_days": true
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": true
      },
      "asked_for_listings_or_photos": {
        "present": true
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-08-31T15:37:00Z",
      "conversation": [
        {
          "at": "2026-08-29T14:41:12Z",
          "from": "lead",
          "text": "Hei! Jeg ser fortsatt etter et hus jeg kan kjøpe i området, har ikke funnet noe enda, vil gjerne se nye ting dere har fått inn!"
        },
        {
          "at": "2026-08-29T14:41:31Z",
          "from": "agency",
          "text": "Hei, så hyggelig at du er tilbake! For at jeg skal finne de nyeste husene som faktisk passer for deg - hvilket område på Costa Blanca er du mest interessert i?"
        },
        {
          "at": "2026-08-29T14:41:51Z",
          "from": "lead",
          "text": "Helst Torrevieja eller Ciudad quesada området, jeg har barn som skal gå på skole der. Vet du om dere har noe i nærheten av den norske skolen?"
        },
        {
          "at": "2026-08-29T14:42:27Z",
          "from": "agency",
          "text": "Godt spørsmål — jeg vil være helt sikker på detaljene her, så en kollega på kontoret dobbeltsjekker. Vi kommer tilbake til deg snart."
        },
        {
          "at": "2026-08-29T20:49:31Z",
          "from": "lead",
          "text": "Helst Torrevieja eller Ciudad quesada området, jeg har barn som skal gå på skole der. Vet du om dere har noe i nærheten av den norske skolen?"
        },
        {
          "at": "2026-08-29T20:50:06Z",
          "from": "agency",
          "text": "Den norske skolen ligger midt i Ciudad Quesada, på Avenida de Castilla 38b (Rojales) – omtrent midt mellom Torrevieja og Guardamar, ca 10 km fra kysten. Populært område for skandinaviske familier!\n\nNår det gjelder \"nyeste hus\" må jeg være ærlig: katalogen vår kan dessverre ikke vise hva som er nyest innmeldt, så jeg kan ikke garantere at dette er ferske funn. Men her er to hus i Ciudad Quesada som matcher:\n\n- MI4010 – Rekkehus/duplex, 2 soverom, 195 000 €, 11 bilder\n- MI3321 – Rekkehus/duplex, 3 soverom, 220 000 €, 14 bilder\n\nVil du at jeg spør kontoret om hva som faktisk har kommet inn nylig i området, eller vil du se flere bilder av en av disse to?"
        },
        {
          "at": "2026-08-30T09:30:17Z",
          "from": "lead",
          "text": "Helst Torrevieja eller Ciudad quesada området, jeg har barn som skal gå på skole der. Vet du om dere har noe i nærheten av den norske skolen?"
        },
        {
          "at": "2026-08-30T09:30:39Z",
          "from": "agency",
          "text": "Godt spørsmål — jeg vil være helt sikker på detaljene her, så en kollega på kontoret dobbeltsjekker. Vi kommer tilbake til deg snart."
        },
        {
          "at": "2026-08-30T09:54:02Z",
          "from": "lead",
          "text": "Helst Torrevieja eller Ciudad quesada området, jeg har barn som skal gå på skole der. Vet du om dere har noe i nærheten av den norske skolen?"
        },
        {
          "at": "2026-08-30T09:54:28Z",
          "from": "agency",
          "text": "Hei igjen! Skolen ligger midt i Ciudad Quesada – populært blant norske familier.\n\nMI3321 er en rekkehus-duplex der, 3 soverom, 220 000 €, 14 bilder. Vil du se bilder, eller skal jeg høre med kontoret om noe nyere har kommet inn?"
        },
        {
          "at": "2026-08-30T09:58:02Z",
          "from": "lead",
          "text": "Ja jeg ser gjerne noen bilder, huset ligger i quesada nært skolen?"
        },
        {
          "at": "2026-08-30T09:58:27Z",
          "from": "agency",
          "text": "Godt spørsmål — jeg vil være helt sikker på detaljene her, så en kollega på kontoret dobbeltsjekker. Vi kommer tilbake til deg snart."
        },
        {
          "at": "2026-08-30T11:00:32Z",
          "from": "lead",
          "text": "Har dere noe mer basseng?"
        },
        {
          "at": "2026-08-30T11:01:00Z",
          "from": "agency",
          "text": "La meg sjekke det med en gang – har du et cirka budsjett for huset med basseng, så jeg finner de beste treffene i Quesada/Torrevieja-området?"
        },
        {
          "at": "2026-08-30T11:01:32Z",
          "from": "lead",
          "text": "Ja fortsatt under 500 000€, og ja helst nært den norske skolen i quesada"
        },
        {
          "at": "2026-08-30T11:02:06Z",
          "from": "agency",
          "text": "To under 500 000 € med basseng i Quesada har vi to fine alternativer:\n\nEn rekkehusvilla i Ciudad Quesada, 3 soverom, 2 bad, privat basseng på sørvest-vendt terrasse, 399 900 €, 14 bilder (ref IC-62026).\n\nEn frittstående villa i Quesada, 3 soverom, 2 bad, privat basseng og egen parkering, bare noen meter fra \"high street\", 390 000 € (ref IC-81596).\n\nBegge ligger i selve Quesada-området, som jo er der skolen er – vil du at jeg sjekker nøyaktig avstand til skolen for en av dem før du bestemmer deg?"
        },
        {
          "at": "2026-08-30T11:04:06Z",
          "from": "lead",
          "text": "Jeg er mest interessert i den frittstående villaen, den er nært sentrum? Den norske skolen ligger i sentrum en plass, men ja jeg vil gjerne vite hvor den ligger eksakt"
        },
        {
          "at": "2026-08-30T11:04:33Z",
          "from": "agency",
          "text": "Villaen ligger bare noen meter fra \"high street\" i selve Quesada, altså midt i sentrumsområdet – samme del av byen som skolen ligger i. Jeg har spurt kontoret om nøyaktig adresse så jeg kan gi deg en presis avstand til skolen, og kommer tilbake til deg med det.\n\nI mellomtiden, vil du se noen bilder av villaen, eller booke en visning?"
        },
        {
          "at": "2026-08-31T14:03:15Z",
          "from": "lead",
          "text": "Hei"
        },
        {
          "at": "2026-08-31T14:03:30Z",
          "from": "agency",
          "text": "Hei! Hvordan kan jeg hjelpe deg i dag?"
        },
        {
          "at": "2026-08-31T14:04:04Z",
          "from": "agency",
          "text": "Hei igjen! Fikk nettopp svar fra kontoret på adressen du spurte om: villaen ligger på Calle Sevilla 14 i Ciudad Quesada, cirka 700 meter fra den norske skolen – omtrent 9 minutters gange.\n\nVil du booke en visning for å se den selv?"
        },
        {
          "at": "2026-08-31T14:05:27Z",
          "from": "lead",
          "text": "Ja gjerne, jeg har tid på torsdag hele dagen, hvilken tid er best for dere?"
        },
        {
          "at": "2026-08-31T14:05:56Z",
          "from": "agency",
          "text": "Torsdag har vi dessverre ikke ledig. Kan tirsdag 17:00 eller onsdag 11:00 passe?"
        },
        {
          "at": "2026-08-31T14:42:10Z",
          "from": "lead",
          "text": "Torsdag passer best for meg, når passer best for dere?"
        },
        {
          "at": "2026-08-31T14:42:43Z",
          "from": "agency",
          "text": "Beklager forvirringen – torsdag har vi faktisk ledig! Jeg kan sette opp kl 13:00 eller kl 14:00, hva passer best?"
        },
        {
          "at": "2026-08-31T14:43:41Z",
          "from": "lead",
          "text": "Jeg vet ikke om jeg kan den tiden, hva med klokka 17:00?"
        },
        {
          "at": "2026-08-31T14:44:09Z",
          "from": "agency",
          "text": "Torsdag kl 17:00 kan vi ordne – passer det?"
        },
        {
          "at": "2026-08-31T14:55:47Z",
          "from": "lead",
          "text": "Ja det passer"
        },
        {
          "at": "2026-08-31T14:56:18Z",
          "from": "agency",
          "text": "Torsdag kl 17:00 for villaen – bekrefter du denne tiden?"
        },
        {
          "at": "2026-08-31T15:06:51Z",
          "from": "lead",
          "text": "Kunne vi faktisk tatt det imrg isteden?"
        },
        {
          "at": "2026-08-31T15:07:20Z",
          "from": "agency",
          "text": "La meg dobbeltsjekke det ordentlig, så kommer jeg straks tilbake til deg."
        }
      ],
      "earlierLeadMessages": [
        {
          "at": "2026-06-11",
          "text": "Hei! Jeg så en leilighet dere har til salgs i Torrevieja. Er den fortsatt tilgjengelig, og kan jeg booke en visning neste uke?"
        },
        {
          "at": "2026-06-18",
          "text": "Hei igjen!"
        },
        {
          "at": "2026-06-18",
          "text": "Jeg leter etter et hus i Torrevieja området igjen, vil helst ha noe nærme strand, 2 soverom minst men helst 3"
        },
        {
          "at": "2026-06-19",
          "text": "Jeg vil se flere hus men sjekke Guardamar isteden, helst under 500 000 euro"
        },
        {
          "at": "2026-06-20",
          "text": "Har dere noe med basseng?"
        },
        {
          "at": "2026-06-27",
          "text": "Ja jeg ser fortsatt etter hus, jeg vil gjerne se flere alternativer andre steder som dere tror passer meg"
        },
        {
          "at": "2026-07-08",
          "text": "Kan du sende meg noen fra andre steder, ikke el raso? Trenger ikke være Guardamar."
        },
        {
          "at": "2026-07-16",
          "text": "Okey!"
        }
      ]
    }
  },
  {
    "id": 9,
    "title": "Offer and reservation intent",
    "expected": {
      "score": 97,
      "band": "ready_to_act",
      "why": "Makes an offer (97); asking how to reserve is the weaker signal."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "area": {
        "state": "none"
      },
      "need": {
        "state": "none"
      },
      "specific_property": {
        "state": "discussed"
      },
      "timing": {
        "state": "within_30_days"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "offer_or_negotiation"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": true
      },
      "asked_for_listings_or_photos": {
        "present": false
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T16:31:00Z",
      "conversation": [
        {
          "at": "2026-09-10T16:00:00Z",
          "from": "lead",
          "text": "Hi again! We viewed the villa (IC-81596) on Saturday and we love it."
        },
        {
          "at": "2026-09-10T16:01:00Z",
          "from": "lead",
          "text": "We'd like to offer €370,000. If the owners accept, how do we reserve it and how much is the deposit?"
        }
      ]
    }
  },
  {
    "id": 10,
    "title": "Edge: was hot, then bought elsewhere",
    "expected": {
      "score": null,
      "band": "lost",
      "why": "CHANGED on Christian's decision, 2026-09-11: bought elsewhere or no longer interested is closed-lost and not active, not a cold lead, and never in cold automation. The first run expected 20 very_cold."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "clear"
      },
      "area": {
        "state": "clear"
      },
      "need": {
        "state": "clear"
      },
      "specific_property": {
        "state": "none"
      },
      "timing": {
        "state": "unknown"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "bought_elsewhere"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": false
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T15:30:00Z",
      "conversation": [
        {
          "at": "2026-09-08T10:00:00Z",
          "from": "lead",
          "text": "Hello, we're looking for a 3-bedroom house with a garden in Torrevieja, budget up to €300,000."
        },
        {
          "at": "2026-09-08T10:05:00Z",
          "from": "agency",
          "text": "Great, I'll send you some options today."
        },
        {
          "at": "2026-09-10T15:00:00Z",
          "from": "lead",
          "text": "Thanks for your help, but we've just bought a house through another agency."
        }
      ]
    }
  },
  {
    "id": 11,
    "title": "Edge: early interest, one detail",
    "minor": true,
    "expected": {
      "score": 38,
      "band": "early_interest",
      "range": [
        38,
        42
      ],
      "why": "Real intent, one clear item (villa with a pool); 42 if the model counts the question as concrete."
    },
    "expectedFacts": {
      "real_lead": true,
      "intent": "real",
      "budget": {
        "state": "none"
      },
      "area": {
        "state": "none"
      },
      "need": {
        "state": "clear"
      },
      "specific_property": {
        "state": "none"
      },
      "timing": {
        "state": "unknown"
      },
      "viewing": {
        "state": "none"
      },
      "decision": {
        "state": "none"
      },
      "negative": {
        "state": "none"
      },
      "concrete_question": {
        "present": false
      },
      "asked_for_listings_or_photos": {
        "present": true
      },
      "financing_ready": {
        "present": false
      }
    },
    "input": {
      "now": "2026-09-10T17:30:00Z",
      "conversation": [
        {
          "at": "2026-09-10T17:00:00Z",
          "from": "lead",
          "text": "Do you have any villas with a pool?"
        }
      ]
    }
  }
];
