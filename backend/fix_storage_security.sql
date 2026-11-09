-- ============================================================================
-- SICHERHEITS-FIX: Fotos/Belege/Dokumente waren für jeden ohne Anmeldung abrufbar
-- (Bucket public = true + Lese-Policy für alle; mit dem öffentlichen Anon-Key aus der
-- config.js ließ sich der ganze Bucket sogar auflisten).
-- Einmal im Supabase SQL Editor ausführen:
-- ============================================================================

-- 1) Bucket privat stellen: Dateien sind nur noch über signierte, zeitlich begrenzte
--    Links erreichbar (das Frontend erzeugt diese per createSignedUrl).
update storage.buckets set public = false where id = 'hof-management';

-- 2) Lese-Policy: nur noch aktive, angemeldete Nutzer (wie beim Hochladen/Löschen).
drop policy if exists "jeder liest oeffentliche dateien" on storage.objects;
drop policy if exists "aktive nutzer lesen dateien" on storage.objects;
create policy "aktive nutzer lesen dateien" on storage.objects for select
  using (bucket_id = 'hof-management' and public.is_active_user());

-- 3) Zweite Lücke: user_activity_overview() lief mit erhöhten Rechten und war - wie jede
--    neue Funktion in Postgres - standardmäßig auch für "anon" aufrufbar. Damit konnte
--    jeder mit dem Anon-Key Namen/E-Mails/letzte Aktivität aller Nutzer abfragen.
--    Jetzt: nur noch aktive angemeldete Nutzer.
create or replace function public.user_activity_overview()
returns table(email text, name text, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select p.email, p.name,
    (select max(a.ts) from public.aktivitaets_log a where a.user_email = p.email) as last_seen
  from public.profiles p
  where p.status = 'Aktiv' and public.is_active_user();
$$;
revoke execute on function public.user_activity_overview() from public, anon;
grant execute on function public.user_activity_overview() to authenticated;

-- 4) OPTIONAL (Aufräumen): alte, in der Datenbank gespeicherte öffentliche Datei-URLs auf
--    reine Pfade umstellen. Nötig ist das nicht - das Frontend wandelt alte URLs beim
--    Laden selbst um -, aber so steht in der Datenbank nirgends mehr ein (toter) Link.
update public.maschinen set foto_url = regexp_replace(foto_url, '^.*/storage/v1/object/(public|sign|authenticated)/hof-management/([^?#]+).*$', '\2')
  where foto_url ~ '/storage/v1/object/(public|sign|authenticated)/hof-management/';
update public.flaschenbestand set foto_url = regexp_replace(foto_url, '^.*/storage/v1/object/(public|sign|authenticated)/hof-management/([^?#]+).*$', '\2')
  where foto_url ~ '/storage/v1/object/(public|sign|authenticated)/hof-management/';
update public.maschinen_kosten set beleg_url = regexp_replace(beleg_url, '^.*/storage/v1/object/(public|sign|authenticated)/hof-management/([^?#]+).*$', '\2')
  where beleg_url ~ '/storage/v1/object/(public|sign|authenticated)/hof-management/';
update public.allgemeine_kosten set beleg_url = regexp_replace(beleg_url, '^.*/storage/v1/object/(public|sign|authenticated)/hof-management/([^?#]+).*$', '\2')
  where beleg_url ~ '/storage/v1/object/(public|sign|authenticated)/hof-management/';
update public.tier_kosten set beleg_url = regexp_replace(beleg_url, '^.*/storage/v1/object/(public|sign|authenticated)/hof-management/([^?#]+).*$', '\2')
  where beleg_url ~ '/storage/v1/object/(public|sign|authenticated)/hof-management/';
update public.maschinen m set dokumente_json = (
  select jsonb_agg(
    case when d ? 'url' then jsonb_set(d, '{url}', to_jsonb(regexp_replace(d->>'url', '^.*/storage/v1/object/(public|sign|authenticated)/hof-management/([^?#]+).*$', '\2'))) else d end
  ) from jsonb_array_elements(m.dokumente_json) d
)
where jsonb_typeof(m.dokumente_json) = 'array' and m.dokumente_json::text ~ '/storage/v1/object/(public|sign|authenticated)/hof-management/';

-- Kontrolle: sollte 'false' liefern und nur noch die neue Policy zeigen
select id, public from storage.buckets where id = 'hof-management';
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';
