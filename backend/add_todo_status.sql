-- ============================================================================
-- Kanban-Status für To-Dos (Backlog / Zu erledigen / In Arbeit / Erledigt) statt
-- nur eines einfachen Erledigt-Häkchens. "erledigt" bleibt zusätzlich bestehen und
-- wird vom Frontend synchron mitgeschrieben (Status='Erledigt' <=> erledigt=true).
-- Einmal in Supabase ausführen:
-- ============================================================================
alter table public.todos add column if not exists status text;

update public.todos
set status = case when erledigt then 'Erledigt' else 'Zu erledigen' end
where status is null;

alter table public.todos alter column status set default 'Zu erledigen';
