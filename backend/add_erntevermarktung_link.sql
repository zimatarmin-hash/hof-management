-- ============================================================================
-- Verknüpft eine Erntevermarktung-Zeile (Kategorie Wein), die automatisch beim
-- Austragen "Verkauf" aus dem Flaschenlager entsteht, mit der auslösenden
-- Flaschenbewegung - damit das Bearbeiten/Löschen dieser Bewegung den
-- zugehörigen Finanzen-Eintrag mit nachführen kann. Einmal in Supabase ausführen:
-- ============================================================================
alter table public.erntevermarktung
  add column if not exists flaschenbewegung_id uuid references public.flaschen_bewegungen(id) on delete set null;
