-- Reverse prospecting (P2-G): draft approval-first outreach about ONE specific
-- listing to a matched existing buyer. Mirrors create_property_suggestion_task but
-- for a single property + a "new listing just came in" intro. Creates a pending
-- suggested_reply dashboard_task (the buyer's Inbox item) with the drafted body for
-- the agent to review/edit/approve/send — it NEVER sends. Ensures a conversation
-- exists so the task attaches. Idempotent-ish: supersedes a prior pending reverse
-- draft for the same buyer+property.
CREATE OR REPLACE FUNCTION public.create_reverse_prospect_task(
  p_lead_id uuid,
  p_property_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency   text := nullif(btrim(current_setting('app.current_agency_id', true)), '');
  v_lang     text;
  v_name     text;
  v_first    text;
  v_channel  text;
  v_platform text;
  v_conv_id  text;
  v_title    text;
  v_price    numeric;
  v_beds     integer;
  v_baths    integer;
  v_url      text;
  v_pcity    text;
  v_specs    text;
  v_price_fmt text;
  v_body     text;
  v_task_id  uuid;
  v_L_intro jsonb := '{
    "en":"Hi {name}! A new listing just came in that matches what you''re looking for:",
    "es":"¡Hola {name}! Acaba de entrar una propiedad nueva que encaja con lo que buscas:",
    "de":"Hallo {name}! Gerade ist eine neue Immobilie hereingekommen, die zu Ihrer Suche passt:",
    "nl":"Hallo {name}! Er is net een nieuwe woning binnengekomen die aansluit bij wat u zoekt:",
    "fr":"Bonjour {name} ! Un nouveau bien vient d''arriver et correspond à votre recherche :",
    "pl":"Dzień dobry {name}! Właśnie pojawiła się nowa nieruchomość pasująca do Twoich oczekiwań:",
    "sv":"Hej {name}! En ny bostad har precis kommit in som matchar det du söker:",
    "no":"Hei {name}! En ny bolig kom nettopp inn som passer det du ser etter:",
    "da":"Hej {name}! Der er lige kommet en ny bolig, der matcher det, du leder efter:",
    "fi":"Hei {name}! Juuri tuli uusi kohde, joka vastaa etsimääsi:",
    "ru":"Здравствуйте, {name}! Только что появился новый объект, подходящий под ваши пожелания:",
    "it":"Ciao {name}! È appena arrivato un nuovo immobile che corrisponde a ciò che cerchi:",
    "pt":"Olá {name}! Acabou de entrar um novo imóvel que corresponde ao que procura:"
  }'::jsonb;
  v_L_bed  jsonb := '{"en":"bed","es":"hab","de":"Schlafz.","nl":"slpk","fr":"ch","pl":"syp","sv":"sovrum","no":"soverom","da":"værelser","fi":"mh","ru":"спал.","it":"camere","pt":"quartos"}'::jsonb;
  v_L_bath jsonb := '{"en":"bath","es":"baños","de":"Bäder","nl":"badk","fr":"sdb","pl":"łaz","sv":"badrum","no":"bad","da":"bad","fi":"kph","ru":"ванн.","it":"bagni","pt":"wc"}'::jsonb;
  v_L_close jsonb := '{
    "en":"Would you like to arrange a viewing?",
    "es":"¿Te gustaría organizar una visita?",
    "de":"Möchten Sie eine Besichtigung vereinbaren?",
    "nl":"Wilt u een bezichtiging plannen?",
    "fr":"Souhaitez-vous organiser une visite ?",
    "pl":"Czy chciałbyś umówić oglądanie?",
    "sv":"Vill du boka en visning?",
    "no":"Vil du avtale en visning?",
    "da":"Vil du arrangere en fremvisning?",
    "fi":"Haluaisitko järjestää esittelyn?",
    "ru":"Хотите организовать показ?",
    "it":"Vuoi organizzare una visita?",
    "pt":"Gostaria de marcar uma visita?"
  }'::jsonb;
BEGIN
  IF v_agency IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found'); END IF;

  SELECT language, full_name INTO v_lang, v_name
  FROM public.leads WHERE id = p_lead_id AND agency_id = v_agency AND COALESCE(lead_type,'buyer') = 'buyer';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found'); END IF;

  SELECT title, price, bedrooms, bathrooms, source_url, location_city
    INTO v_title, v_price, v_beds, v_baths, v_url, v_pcity
  FROM public.properties WHERE id = p_property_id AND agency_id = v_agency AND status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'property_not_found'); END IF;

  v_lang := lower(coalesce(nullif(btrim(v_lang), ''), 'en'));
  IF length(v_lang) > 2 THEN v_lang := left(v_lang, 2); END IF;
  IF NOT (v_L_intro ? v_lang) THEN v_lang := 'en'; END IF;
  v_first := coalesce(nullif(split_part(coalesce(v_name, ''), ' ', 1), ''), v_name, '');

  -- Ensure a conversation exists to attach the Inbox task to (proactive outreach:
  -- an existing buyer may not have one yet). Default channel = whatsapp.
  SELECT id::text, channel INTO v_conv_id, v_channel
  FROM public.conversations WHERE lead_id = p_lead_id AND agency_id = v_agency
  ORDER BY (status = 'open') DESC, last_message_at DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (lead_id, agency_id, channel, status, message_count, last_message_at, created_at, updated_at)
    VALUES (p_lead_id, v_agency, 'whatsapp', 'active', 0, now(), now(), now())
    ON CONFLICT (lead_id, channel) DO UPDATE SET updated_at = now()
    RETURNING id::text, channel INTO v_conv_id, v_channel;
  END IF;
  v_platform := CASE lower(coalesce(v_channel,'')) WHEN 'whatsapp' THEN 'twilio' WHEN 'email' THEN 'resend' WHEN 'voice' THEN 'vapi' ELSE coalesce(v_channel,'unknown') END;

  v_specs := '';
  IF v_beds IS NOT NULL THEN v_specs := v_beds::text || ' ' || (v_L_bed->>v_lang); END IF;
  IF v_baths IS NOT NULL THEN v_specs := v_specs || CASE WHEN v_specs <> '' THEN ' · ' ELSE '' END || v_baths::text || ' ' || (v_L_bath->>v_lang); END IF;
  IF v_price IS NOT NULL AND v_price > 0 THEN
    v_price_fmt := '€' || regexp_replace(round(v_price)::bigint::text, '(\d)(?=(\d{3})+(?!\d))', '\1.', 'g');
    v_specs := v_specs || CASE WHEN v_specs <> '' THEN ' · ' ELSE '' END || v_price_fmt;
  END IF;

  v_body := replace(v_L_intro->>v_lang, '{name}', coalesce(v_first, ''))
            || E'\n\n' || coalesce(v_title, 'Property')
            || CASE WHEN coalesce(v_pcity,'') <> '' THEN ' — ' || v_pcity ELSE '' END
            || CASE WHEN v_specs <> '' THEN E'\n' || v_specs ELSE '' END
            || CASE WHEN coalesce(btrim(v_url),'') <> '' THEN E'\n' || v_url ELSE '' END
            || E'\n\n' || (v_L_close->>v_lang);

  -- Supersede a prior pending reverse-prospect draft for the same buyer+property.
  UPDATE public.dashboard_tasks
     SET status='dismissed', dismissal_reason='superseded_by_new_inbound', handled_at=now(), updated_at=now()
   WHERE conversation_id = v_conv_id AND agency_id = v_agency AND status='pending'
     AND task_type='suggested_reply' AND coalesce(raw_payload->>'kind','')='reverse_prospect'
     AND coalesce(raw_payload->>'property_id','') = p_property_id::text;

  INSERT INTO public.dashboard_tasks (
    agency_id, lead_id, task_type, status, title, description,
    message_body, channel, platform, priority, recommended_channel, conversation_id, raw_payload
  ) VALUES (
    v_agency, p_lead_id, 'suggested_reply', 'pending',
    'New-listing outreach ready to send',
    'A matched buyer for this listing. Review, edit, approve, or dismiss — nothing sends until you approve.',
    v_body, v_channel, v_platform, 'normal', v_channel, v_conv_id,
    jsonb_build_object('kind','reverse_prospect','property_id', p_property_id::text,
                       'language', v_lang, 'generated_by','create_reverse_prospect_task')
  ) RETURNING id INTO v_task_id;

  RETURN jsonb_build_object('ok', true, 'task_id', v_task_id, 'conversation_id', v_conv_id,
                            'channel', v_channel, 'language', v_lang, 'preview', left(v_body, 700));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reverse_prospect_task(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reverse_prospect_task(uuid, uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.create_reverse_prospect_task(uuid, uuid) TO aivena_app;
