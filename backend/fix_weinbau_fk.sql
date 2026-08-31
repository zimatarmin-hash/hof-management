-- ============================================================================
-- FIX: Rebschnitt/Reifemessungen/Ernte lassen sich nicht eintragen bzw. wurden
-- nicht migriert.
--
-- Ursache: weinbau_massnahmen/reifemessungen/wein_lese.sub_flaeche_id hatte einen
-- Fremdschlüssel auf sub_flaechen(id). Das Frontend erlaubt aber, eine ganze Fläche
-- (Nutzungsart Weinbau/Obstbau) direkt als "Rebanlage" zu nutzen, wenn sie nicht in
-- SubFlächen unterteilt ist - dann steht in sub_flaeche_id eine flaechen.id statt
-- einer sub_flaechen.id. Der Fremdschlüssel hat das abgelehnt (bei der Migration UND
-- beim Neu-Anlegen).
--
-- Einmal im Supabase SQL Editor ausführen:
-- ============================================================================
alter table public.weinbau_massnahmen drop constraint if exists weinbau_massnahmen_sub_flaeche_id_fkey;
alter table public.reifemessungen drop constraint if exists reifemessungen_sub_flaeche_id_fkey;
alter table public.wein_lese drop constraint if exists wein_lese_sub_flaeche_id_fkey;
