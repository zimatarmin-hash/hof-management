-- ============================================================================
-- Verknüpft eine automatisch aus einem Schnitt (Dauerwiese) oder einer Fruchtfolge-
-- Ernte (Ackerland) entstandene Futtermittel-Buchung ("Zugang (Ernte)") mit ihrer
-- Quelle - damit ein Löschen/Ändern auf der einen Seite (Feldbuch/Karte <-> Futtermittel-
-- Verlauf) auf der anderen Seite nachgeführt werden kann. Einmal in Supabase ausführen:
-- ============================================================================
alter table public.futtermittel_bewegungen
  add column if not exists schnitt_id uuid references public.schnitte(id) on delete set null,
  add column if not exists fruchtfolge_id uuid references public.fruchtfolge(id) on delete set null;
