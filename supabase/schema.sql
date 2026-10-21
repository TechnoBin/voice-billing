-- Kirana Voice Billing starter schema. Run in Supabase SQL Editor.
-- For a single-owner store, sign in/auth is not yet part of this starter UI.
-- IMPORTANT: the starter policies below allow anonymous access to data and are suitable ONLY for a private test project.
-- Before real customer/store use, implement Supabase Auth + owner_id columns + owner-scoped RLS. Do not store sensitive data until then.
create extension if not exists pgcrypto;
create table if not exists public.products (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 price numeric(12,2) not null default 0 check (price >= 0),
 aliases text[] not null default '{}',
 category text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.bills (
 id uuid primary key default gen_random_uuid(),
 customer_name text,
 subtotal numeric(12,2) not null check (subtotal >= 0),
 discount numeric(12,2) not null default 0 check (discount >= 0),
 total numeric(12,2) not null check (total >= 0),
 status text not null default 'saved',
 created_at timestamptz not null default now()
);
create table if not exists public.bill_items (
 id uuid primary key default gen_random_uuid(),
 bill_id uuid not null references public.bills(id) on delete cascade,
 product_id uuid references public.products(id) on delete set null,
 name_snapshot text not null,
 unit_price numeric(12,2) not null check (unit_price >= 0),
 quantity integer not null check (quantity > 0),
 line_total numeric(12,2) not null check (line_total >= 0),
 created_at timestamptz not null default now()
);
create index if not exists bills_created_at_idx on public.bills(created_at desc);
create index if not exists bill_items_bill_id_idx on public.bill_items(bill_id);
alter table public.products enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
-- TEST-ONLY anonymous policies. Replace with authenticated owner-only policies before real use.
drop policy if exists "test anon products access" on public.products;
create policy "test anon products access" on public.products for all to anon using (true) with check (true);
drop policy if exists "test anon bills access" on public.bills;
create policy "test anon bills access" on public.bills for all to anon using (true) with check (true);
drop policy if exists "test anon bill items access" on public.bill_items;
create policy "test anon bill items access" on public.bill_items for all to anon using (true) with check (true);
