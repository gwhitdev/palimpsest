-- IRR + Kappa revision loop schema support.
-- Adds coding rounds, persisted kappa results, boundary examples, and round linkage on annotations.

create table if not exists public.coding_rounds (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  round_number integer not null,
  status       text not null default 'active' check (status in ('active', 'complete', 'archived')),
  notes        text,
  created_at   timestamptz default now(),
  unique (project_id, round_number)
);

create table if not exists public.kappa_results (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  round_id      uuid references public.coding_rounds(id) on delete cascade,
  tech_id       text not null,
  kappa_value   numeric(4,3),
  coder_count   integer,
  doc_count     integer,
  status        text not null default 'DRAFT' check (status in ('DRAFT', 'UNDER REVISION', 'LOCKED')),
  notes         text,
  calculated_at timestamptz default now(),
  unique (project_id, round_id, tech_id)
);

create table if not exists public.boundary_examples (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  tech_id      text not null,
  quoted_text  text not null,
  explanation  text,
  added_by     uuid references auth.users(id),
  created_at   timestamptz default now()
);

alter table public.annotations
  add column if not exists round_id uuid references public.coding_rounds(id) on delete set null;

create index if not exists idx_annotations_round_id on public.annotations(round_id);
create index if not exists idx_kappa_results_round on public.kappa_results(round_id);
create index if not exists idx_kappa_results_project on public.kappa_results(project_id);
create index if not exists idx_boundary_examples_project_tech on public.boundary_examples(project_id, tech_id);

alter table public.coding_rounds enable row level security;
alter table public.kappa_results enable row level security;
alter table public.boundary_examples enable row level security;

drop policy if exists "Members can read coding rounds" on public.coding_rounds;
create policy "Members can read coding rounds"
  on public.coding_rounds for select to authenticated
  using (public.project_has_permission(coding_rounds.project_id, auth.uid(), 'view_stats'));

drop policy if exists "Owners can manage coding rounds" on public.coding_rounds;
create policy "Owners can manage coding rounds"
  on public.coding_rounds for all to authenticated
  using (public.project_has_permission(coding_rounds.project_id, auth.uid(), 'manage_project'))
  with check (public.project_has_permission(coding_rounds.project_id, auth.uid(), 'manage_project'));

drop policy if exists "Members can read kappa results" on public.kappa_results;
create policy "Members can read kappa results"
  on public.kappa_results for select to authenticated
  using (public.project_has_permission(kappa_results.project_id, auth.uid(), 'view_stats'));

drop policy if exists "Owners can manage kappa results" on public.kappa_results;
create policy "Owners can manage kappa results"
  on public.kappa_results for all to authenticated
  using (public.project_has_permission(kappa_results.project_id, auth.uid(), 'manage_project'))
  with check (public.project_has_permission(kappa_results.project_id, auth.uid(), 'manage_project'));

drop policy if exists "Members can read boundary examples" on public.boundary_examples;
create policy "Members can read boundary examples"
  on public.boundary_examples for select to authenticated
  using (public.project_has_permission(boundary_examples.project_id, auth.uid(), 'view_documents'));

drop policy if exists "Annotators can add boundary examples" on public.boundary_examples;
create policy "Annotators can add boundary examples"
  on public.boundary_examples for insert to authenticated
  with check (
    public.project_has_permission(boundary_examples.project_id, auth.uid(), 'annotate')
    and boundary_examples.added_by = auth.uid()
  );

drop policy if exists "Owners can update boundary examples" on public.boundary_examples;
create policy "Owners can update boundary examples"
  on public.boundary_examples for update to authenticated
  using (public.project_has_permission(boundary_examples.project_id, auth.uid(), 'manage_project'))
  with check (public.project_has_permission(boundary_examples.project_id, auth.uid(), 'manage_project'));

drop policy if exists "Owners can delete boundary examples" on public.boundary_examples;
create policy "Owners can delete boundary examples"
  on public.boundary_examples for delete to authenticated
  using (public.project_has_permission(boundary_examples.project_id, auth.uid(), 'manage_project'));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kappa_results'
  ) then
    alter publication supabase_realtime add table public.kappa_results;
  end if;
end
$$;
