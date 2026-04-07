create table if not exists public.processed_database_files (
  key text primary key check (key = 'latest'),
  file_name text not null,
  mime_type text not null default '',
  storage_path text not null,
  uploaded_at timestamptz not null default timezone('utc', now())
);

alter table public.processed_database_files enable row level security;

drop policy if exists "Public read processed database files" on public.processed_database_files;
create policy "Public read processed database files"
on public.processed_database_files
for select
to anon, authenticated
using (true);

drop policy if exists "Public insert processed database files" on public.processed_database_files;
create policy "Public insert processed database files"
on public.processed_database_files
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public update processed database files" on public.processed_database_files;
create policy "Public update processed database files"
on public.processed_database_files
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public delete processed database files" on public.processed_database_files;
create policy "Public delete processed database files"
on public.processed_database_files
for delete
to anon, authenticated
using (true);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'processed-database',
  'processed-database',
  false,
  52428800,
  array[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read processed database objects" on storage.objects;
create policy "Public read processed database objects"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'processed-database');

drop policy if exists "Public insert processed database objects" on storage.objects;
create policy "Public insert processed database objects"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'processed-database');

drop policy if exists "Public update processed database objects" on storage.objects;
create policy "Public update processed database objects"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'processed-database')
with check (bucket_id = 'processed-database');

drop policy if exists "Public delete processed database objects" on storage.objects;
create policy "Public delete processed database objects"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'processed-database');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'processed_database_files'
  ) then
    alter publication supabase_realtime add table public.processed_database_files;
  end if;
end
$$;
