-- សហគមន៍សន្សំប្រាក់ — រចនាសម្ព័ន្ធមូលដ្ឋានទិន្នន័យ (Supabase / PostgreSQL)
-- ដំណើរការក្នុង Supabase > SQL Editor មុន seed.sql

create table settings (key text primary key, value numeric not null);
create table members (id text primary key, name text not null, joined date not null default current_date);
create table savings (
  id bigint generated always as identity primary key,
  date date not null,
  member_id text not null references members(id) on update cascade,
  shares numeric not null check (shares > 0),
  fee numeric not null default 0
);
create table loans (
  id text primary key,
  date date not null,
  member_id text not null references members(id) on update cascade,
  amount numeric not null check (amount > 0),
  months int not null check (months > 0),
  rate numeric not null,
  interest numeric not null,
  due date not null,
  status text not null default 'កំពុងខ្ចី' check (status in ('កំពុងខ្ចី','សងរួច'))
);
create table repayments (
  id bigint generated always as identity primary key,
  date date not null,
  loan_id text not null references loans(id) on update cascade on delete cascade,
  amount numeric not null check (amount > 0)
);
create table expenses (
  id bigint generated always as identity primary key,
  date date not null,
  description text not null,
  amount numeric not null check (amount > 0)
);

-- បញ្ជីអ៊ីមែល Admin (ទុកតែអ្នកមានសិទ្ធិកែប្រែ)
create table admins (email text primary key);

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

-- សុវត្ថិភាព: អ្នកទាំងអស់មើលបាន, មានតែ Admin ទេដែលសរសេរ/កែ/លុបបាន
do $$
declare t text;
begin
  foreach t in array array['settings','members','savings','loans','repayments','expenses'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('create policy "admin write" on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

alter table admins enable row level security;
create policy "see own admin row" on admins for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- បន្ថែម Admin (ប្តូរអ៊ីមែលជារបស់អ្នក ហើយដំណើរការបន្ទាត់នេះ):
-- insert into admins(email) values ('your-admin@example.com');
