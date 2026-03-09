create extension if not exists pgcrypto;

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  isbn text not null,
  title text not null default '',
  author text not null default '',
  publisher text not null default '',
  year text not null default '',
  pages text not null default '',
  price text not null default '',
  language text not null default '',
  type text not null default '',
  dewey text not null default '',
  initial text not null default '',
  quantity integer not null default 1,
  is_rejected boolean not null default false,
  is_flagged boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint books_isbn_unique unique (isbn)
);

create or replace function public.set_books_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_books_updated_at on public.books;
create trigger set_books_updated_at
before update on public.books
for each row
execute function public.set_books_updated_at();

alter table public.books enable row level security;

drop policy if exists "Public read books" on public.books;
create policy "Public read books"
on public.books
for select
to anon, authenticated
using (true);

drop policy if exists "Public insert books" on public.books;
create policy "Public insert books"
on public.books
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public update books" on public.books;
create policy "Public update books"
on public.books
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public delete books" on public.books;
create policy "Public delete books"
on public.books
for delete
to anon, authenticated
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'books'
  ) then
    alter publication supabase_realtime add table public.books;
  end if;
end
$$;
