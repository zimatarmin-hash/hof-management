-- ============================================================================
-- HOF-MANAGEMENT — Supabase/Postgres Schema (Ersatz für Google Sheets)
-- Einmal komplett im Supabase SQL Editor ausführen (Projekt -> SQL Editor -> New query
-- -> dieses Skript einfügen -> Run). Danach folgt in einem separaten Schritt die
-- Google-Anmeldung (Auth Provider) und die Datenübernahme aus dem bestehenden Sheet.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- PROFILE (ersetzt die "Users"-Tabelle) — verknüpft mit Supabase Auth (auth.users)
-- ============================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  role text not null default 'Mitarbeiter',       -- Admin | Mitarbeiter
  status text not null default 'Gesperrt',         -- Aktiv | Gesperrt
  created_at timestamptz not null default now()
);

-- Erster jemals angemeldete Nutzer wird automatisch Admin/Aktiv (Bootstrap) - alle
-- weiteren starten als Mitarbeiter/Gesperrt und müssen von einem Admin freigeschaltet werden.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, role, status)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    case when is_first then 'Admin' else 'Mitarbeiter' end,
    case when is_first then 'Aktiv' else 'Gesperrt' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- FACHLICHE TABELLEN
-- ============================================================================
create table public.betrieb (
  id int primary key default 1 check (id = 1),
  hof_name text, adresse text, betriebsnummer text, ansprechpartner text,
  erinnerung_wochen_vorher int,
  aktualisiert_am timestamptz default now()
);
insert into public.betrieb (id) values (1);

create table public.flaechen (
  id uuid primary key default gen_random_uuid(),
  name text not null, katastral_gemeinde text, parzellennummer text,
  flaeche_ha numeric, besitzart text, nutzungsart text, rebsorte text, anzahl_pflanzen int,
  arbeitsablauf_json jsonb, geojson jsonb, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.sub_flaechen (
  id uuid primary key default gen_random_uuid(),
  flaeche_id uuid references public.flaechen(id) on delete cascade,
  name text, rebsorte text, flaeche_m2 numeric, pflanzjahr int, geojson jsonb, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.kulturen (
  kultur text primary key,
  kategorie text, saatmenge_kg_ha numeric,
  duengeempfehlung_n_kg_ha numeric, duengeempfehlung_p_kg_ha numeric, duengeempfehlung_k_kg_ha numeric,
  unvertraegliche_vorfruechte text, anbaupause_jahre int, karten_farbe text, karten_symbol text
);

create table public.fruchtfolge (
  id uuid primary key default gen_random_uuid(),
  flaeche_id uuid references public.flaechen(id) on delete cascade,
  jahr int, kultur text, aussaatdatum date, erntedatum date,
  ertragsmenge numeric, ertragseinheit text,
  saatmenge_kg_ha_berechnet numeric, saatmenge_gesamt_kg numeric, notiz text,
  erstellt_von text, erstellt_am timestamptz default now()
);

create table public.schnitte (
  id uuid primary key default gen_random_uuid(),
  flaeche_id uuid references public.flaechen(id) on delete cascade,
  schnitt_nummer int, datum date, erntetyp text, ertragsmenge numeric, ertragseinheit text, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.feldarbeiten (
  id uuid primary key default gen_random_uuid(),
  flaeche_id uuid references public.flaechen(id) on delete cascade,
  schritt text, datum date, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.duengungen (
  id uuid primary key default gen_random_uuid(),
  flaeche_id uuid references public.flaechen(id) on delete cascade,
  datum date, duengerart text, menge numeric, einheit text, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

-- sub_flaeche_id ist BEWUSST ohne Fremdschlüssel: das Frontend erlaubt, eine ganze
-- Fläche (Nutzungsart Weinbau/Obstbau) direkt als "Rebanlage" zu behandeln, wenn sie
-- nicht in SubFlächen unterteilt ist - dann steht hier eine flaechen.id statt einer
-- sub_flaechen.id drin. Ein FK auf sub_flaechen würde solche Einträge ablehnen.
create table public.weinbau_massnahmen (
  id uuid primary key default gen_random_uuid(),
  sub_flaeche_id uuid,
  datum date, massnahme text, bio boolean, mittel text, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.reifemessungen (
  id uuid primary key default gen_random_uuid(),
  sub_flaeche_id uuid,
  datum date, oechsle numeric, brix numeric, kmw numeric, saeure numeric, ph numeric, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.wein_lese (
  id uuid primary key default gen_random_uuid(),
  sub_flaeche_id uuid,
  datum date, menge_kg numeric, mostgewicht_oechsle numeric, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.tanks (
  id uuid primary key default gen_random_uuid(),
  bezeichnung text, volumen_liter numeric, aktueller_inhalt_liter numeric default 0,
  sorte text, jahrgang int, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.keller_logbuch (
  id uuid primary key default gen_random_uuid(),
  tank_id uuid references public.tanks(id) on delete cascade,
  datum date, aktion text, oechsle numeric, brix numeric, kmw numeric,
  restzucker_gl numeric, verbleibend_liter numeric, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.abfuellungen (
  id uuid primary key default gen_random_uuid(),
  tank_id uuid references public.tanks(id) on delete cascade,
  datum date, flaschen_anzahl int, flaschen_groesse_ml int, charge text, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.flaschenbestand (
  id uuid primary key default gen_random_uuid(),
  bezeichnung text, sorte text, jahrgang int, flaschen_groesse_ml int,
  anzahl_aktuell int default 0, foto_url text, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.flaschen_bewegungen (
  id uuid primary key default gen_random_uuid(),
  flaschenbestand_id uuid references public.flaschenbestand(id) on delete cascade,
  datum date, typ text, anzahl int, erloes numeric, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.maschinen (
  id uuid primary key default gen_random_uuid(),
  geraete_nummer text, bezeichnung text, typ text, baujahr int,
  anschaffungspreis numeric, anschaffungsdatum date, betriebsstunden_aktuell numeric default 0,
  foto_url text, dokumente_json jsonb, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.betriebsstunden (
  id uuid primary key default gen_random_uuid(),
  maschinen_id uuid references public.maschinen(id) on delete cascade,
  datum date, stunden_delta numeric, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.wartungs_intervalle (
  id uuid primary key default gen_random_uuid(),
  maschinen_id uuid references public.maschinen(id) on delete cascade,
  bezeichnung text, intervall_stunden numeric, intervall_monate int,
  letzte_wartung_stunden numeric, letzte_wartung_datum date, notiz text
);

create table public.maschinen_kosten (
  id uuid primary key default gen_random_uuid(),
  maschinen_id uuid references public.maschinen(id) on delete cascade,
  datum date, kategorie text, betrag numeric, beschreibung text, beleg_url text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.allgemeine_kosten (
  id uuid primary key default gen_random_uuid(),
  datum date, kategorie text, menge_liter numeric, betrag numeric, beschreibung text, beleg_url text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.erntevermarktung (
  id uuid primary key default gen_random_uuid(),
  datum date, kategorie text, menge numeric, einheit text, erloes numeric, beschreibung text,
  -- gesetzt, wenn diese Zeile automatisch aus einem "Verkauf"-Austrag im Flaschenlager
  -- entstanden ist - erlaubt, sie beim Bearbeiten/Löschen der Bewegung nachzuführen.
  flaschenbewegung_id uuid references public.flaschen_bewegungen(id) on delete set null,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.tiere (
  id uuid primary key default gen_random_uuid(),
  tierart text, ohrmarke text, rasse text, name text, geburtsdatum date,
  geschlecht text, status text, mutter_ohrmarke text, notiz text,
  eingangsdatum date, ausgangsdatum date,
  erstellt_von text, erstellt_am timestamptz default now()
);

create table public.zuchtereignisse (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid references public.tiere(id) on delete cascade,
  datum date, typ text, vatertier text,
  voraussichtliches_abkalbedatum date, trockenstellen_ab date, notiz text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.tier_kosten (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid references public.tiere(id) on delete cascade,
  datum date, kategorie text, betrag numeric, beschreibung text, beleg_url text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.tier_erloese (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid references public.tiere(id) on delete cascade,
  datum date, art text, betrag numeric, beschreibung text,
  erfasst_von text, erfasst_am timestamptz default now()
);

create table public.tierbestand (
  id uuid primary key default gen_random_uuid(),
  tierart text, bezeichnung text, anzahl_aktuell numeric default 0, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.tierbestand_bewegungen (
  id uuid primary key default gen_random_uuid(),
  tierbestand_id uuid references public.tierbestand(id) on delete cascade,
  datum date, typ text, anzahl numeric, notiz text, erfasst_von text
);

create table public.futtermittel (
  id uuid primary key default gen_random_uuid(),
  bezeichnung text, kategorie text, einheit text,
  bestand_aktuell numeric default 0, mindest_bestand numeric, notiz text,
  erstellt_von text, erstellt_am timestamptz default now(), aktiv boolean default true
);

create table public.futtermittel_bewegungen (
  id uuid primary key default gen_random_uuid(),
  futtermittel_id uuid references public.futtermittel(id) on delete cascade,
  datum date, typ text, menge numeric,
  herkunft_flaeche_id uuid references public.flaechen(id),
  notiz text, erfasst_von text, erfasst_am timestamptz default now()
);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  text text not null, prioritaet text default 'Mittel', erledigt boolean default false,
  erstellt_von text, erstellt_am timestamptz default now()
);

create table public.aktivitaets_log (
  id bigserial primary key,
  ts timestamptz default now(),
  user_email text, user_name text, aktion text, details text
);

-- ============================================================================
-- INDIZES auf Fremdschlüsseln (werden in Postgres NICHT automatisch angelegt,
-- aber ständig für Filter wie "alle Schnitte einer Fläche" gebraucht)
-- ============================================================================
create index on public.sub_flaechen (flaeche_id);
create index on public.fruchtfolge (flaeche_id);
create index on public.schnitte (flaeche_id);
create index on public.feldarbeiten (flaeche_id);
create index on public.duengungen (flaeche_id);
create index on public.weinbau_massnahmen (sub_flaeche_id);
create index on public.reifemessungen (sub_flaeche_id);
create index on public.wein_lese (sub_flaeche_id);
create index on public.keller_logbuch (tank_id);
create index on public.abfuellungen (tank_id);
create index on public.flaschen_bewegungen (flaschenbestand_id);
create index on public.betriebsstunden (maschinen_id);
create index on public.wartungs_intervalle (maschinen_id);
create index on public.maschinen_kosten (maschinen_id);
create index on public.zuchtereignisse (tier_id);
create index on public.tier_kosten (tier_id);
create index on public.tier_erloese (tier_id);
create index on public.tierbestand_bewegungen (tierbestand_id);
create index on public.futtermittel_bewegungen (futtermittel_id);

-- ============================================================================
-- ROW LEVEL SECURITY — nur angemeldete UND freigeschaltete (status='Aktiv')
-- Nutzer dürfen lesen/schreiben, Löschen nur für Admins. Ohne das wäre die
-- Datenbank für jeden mit dem (öffentlich im Frontend sichtbaren) API-Key offen.
-- ============================================================================
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'Aktiv');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'Aktiv' and role = 'Admin');
$$;

alter table public.profiles enable row level security;
create policy "eigenes profil oder admin liest alle" on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "admins bearbeiten nutzer" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy "admins entfernen nutzer" on public.profiles for delete using (public.is_admin());

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
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy "select_active" on public.%I for select using (public.is_active_user());', t);
    execute format('create policy "insert_active" on public.%I for insert with check (public.is_active_user());', t);
    execute format('create policy "update_active" on public.%I for update using (public.is_active_user()) with check (public.is_active_user());', t);
    execute format('create policy "delete_admin" on public.%I for delete using (public.is_admin());', t);
  end loop;
end $$;

-- ============================================================================
-- STORAGE (Fotos/Belege) — ersetzt Google Drive
-- ============================================================================
insert into storage.buckets (id, name, public) values ('hof-management', 'hof-management', true)
on conflict (id) do nothing;

create policy "aktive nutzer laden hoch" on storage.objects for insert
  with check (bucket_id = 'hof-management' and public.is_active_user());
create policy "jeder liest oeffentliche dateien" on storage.objects for select
  using (bucket_id = 'hof-management');
create policy "aktive nutzer loeschen eigene dateien" on storage.objects for delete
  using (bucket_id = 'hof-management' and public.is_active_user());
