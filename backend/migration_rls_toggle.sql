-- ============================================================================
-- SCHRITT A — VOR der Migration ausführen (öffnet die Tabellen kurzzeitig,
-- damit der Massenimport per öffentlichem Key durchläuft):
-- ============================================================================
do $$
declare
  t text;
  tables text[] := array[
    'betrieb','flaechen','sub_flaechen','kulturen','fruchtfolge','schnitte','feldarbeiten',
    'duengungen','weinbau_massnahmen','reifemessungen','wein_lese','tanks','keller_logbuch',
    'abfuellungen','flaschenbestand','flaschen_bewegungen','maschinen','betriebsstunden',
    'wartungs_intervalle','maschinen_kosten','allgemeine_kosten','erntevermarktung','tiere',
    'zuchtereignisse','tier_kosten','tier_erloese','tierbestand','tierbestand_bewegungen',
    'futtermittel','futtermittel_bewegungen','todos','aktivitaets_log'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I disable row level security;', t);
  end loop;
end $$;

-- ============================================================================
-- SCHRITT B — ERST NACHDEM die Migration erfolgreich durchgelaufen ist ausführen
-- (aktiviert die Absicherung wieder - ohne das liegen die Daten offen!):
-- ============================================================================
-- do $$
-- declare
--   t text;
--   tables text[] := array[
--     'betrieb','flaechen','sub_flaechen','kulturen','fruchtfolge','schnitte','feldarbeiten',
--     'duengungen','weinbau_massnahmen','reifemessungen','wein_lese','tanks','keller_logbuch',
--     'abfuellungen','flaschenbestand','flaschen_bewegungen','maschinen','betriebsstunden',
--     'wartungs_intervalle','maschinen_kosten','allgemeine_kosten','erntevermarktung','tiere',
--     'zuchtereignisse','tier_kosten','tier_erloese','tierbestand','tierbestand_bewegungen',
--     'futtermittel','futtermittel_bewegungen','todos','aktivitaets_log'
--   ];
-- begin
--   foreach t in array tables loop
--     execute format('alter table public.%I enable row level security;', t);
--   end loop;
-- end $$;
