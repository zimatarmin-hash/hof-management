-- ============================================================================
-- 1) Spalte sicherstellen (falls noch nicht vorhanden - ungefährlich, egal ob
--    das schon lief oder nicht):
-- ============================================================================
alter table public.erntevermarktung
  add column if not exists flaschenbewegung_id uuid references public.flaschen_bewegungen(id) on delete set null;

-- ============================================================================
-- 2) Fehlende Finanzen-Einträge nachtragen: findet alle "Verkauf"-Bewegungen im
--    Flaschenlager mit Erlös, zu denen (noch) kein Erntevermarktung-Eintrag
--    existiert (z.B. weil das beim Anlegen wegen der fehlenden Spalte
--    fehlgeschlagen ist), und legt sie nachträglich an. Mehrfaches Ausführen
--    erzeugt keine Duplikate (prüft "not exists" vorher).
-- ============================================================================
insert into public.erntevermarktung (datum, kategorie, menge, einheit, erloes, beschreibung, flaschenbewegung_id)
select
  fb.datum, 'Wein', fb.anzahl, 'Flaschen', fb.erloes,
  'Verkauf ' || coalesce(best.bezeichnung, '') ||
    case when fb.notiz is not null and fb.notiz <> '' then ' — ' || fb.notiz else '' end,
  fb.id
from public.flaschen_bewegungen fb
join public.flaschenbestand best on best.id = fb.flaschenbestand_id
where fb.typ = 'Verkauf'
  and fb.erloes is not null and fb.erloes > 0
  and not exists (select 1 from public.erntevermarktung e where e.flaschenbewegung_id = fb.id);

-- ============================================================================
-- 3) Kontrolle: sollte nach Schritt 2 keine Zeilen mehr liefern. Falls doch,
--    schick mir das Ergebnis (z.B. Verkäufe ohne Erlös, die deshalb bewusst
--    übersprungen werden).
-- ============================================================================
select fb.id, fb.datum, fb.anzahl, fb.erloes, fb.notiz
from public.flaschen_bewegungen fb
where fb.typ = 'Verkauf'
  and not exists (select 1 from public.erntevermarktung e where e.flaschenbewegung_id = fb.id);
