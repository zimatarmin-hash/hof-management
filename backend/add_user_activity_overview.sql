-- ============================================================================
-- "Wer war wann zuletzt aktiv" für die Seitenleiste: profiles hat eine RLS-Regel,
-- die normale Mitarbeiter nur ihre EIGENE Zeile lesen lässt (nur Admins sehen alle) -
-- dadurch sah jeder Nicht-Admin in der Liste bisher nur sich selbst. Diese Funktion
-- läuft mit den Rechten des Definierers (umgeht die RLS-Einschränkung gezielt NUR für
-- die paar harmlosen Felder email/name/letzte Aktivität) und ist für alle angemeldeten
-- aktiven Nutzer freigegeben. Einmal im Supabase SQL Editor ausführen:
-- ============================================================================
create or replace function public.user_activity_overview()
returns table(email text, name text, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select p.email, p.name,
    (select max(a.ts) from public.aktivitaets_log a where a.user_email = p.email) as last_seen
  from public.profiles p
  where p.status = 'Aktiv';
$$;

grant execute on function public.user_activity_overview() to authenticated;
