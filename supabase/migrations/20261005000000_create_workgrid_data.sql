create table if not exists public.workgrid_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint workgrid_tasks_are_array check (jsonb_typeof(tasks) = 'array')
);

alter table public.workgrid_data enable row level security;

create policy "Users can read their own WorkGrid data"
on public.workgrid_data for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own WorkGrid data"
on public.workgrid_data for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own WorkGrid data"
on public.workgrid_data for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own WorkGrid data"
on public.workgrid_data for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.touch_workgrid_data()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    new.revision = old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_workgrid_data on public.workgrid_data;
create trigger touch_workgrid_data
before update on public.workgrid_data
for each row execute function public.touch_workgrid_data();

do $$
begin
  alter publication supabase_realtime add table public.workgrid_data;
exception
  when duplicate_object then null;
end;
$$;
