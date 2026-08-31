-- ============================================================================
-- Ergänzt Tiere um Eingangsdatum (Zugang/Kauf am Betrieb - kann vom Geburtsdatum
-- abweichen, z.B. bei zugekauften Tieren) und Ausgangsdatum (Verkauf/Schlachtung/
-- Tod). Einmal im Supabase SQL Editor ausführen:
-- ============================================================================
alter table public.tiere add column if not exists eingangsdatum date;
alter table public.tiere add column if not exists ausgangsdatum date;
