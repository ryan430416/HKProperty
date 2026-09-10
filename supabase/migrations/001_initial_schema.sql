-- HKProperty 初始資料表
-- 財產編號 property_id 以 text 儲存，不可轉成數字或科學記號

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  school_number text,
  department text,
  role text not null default 'borrower' check (role in ('borrower', 'staff', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_school_number_unique
  on public.profiles (school_number)
  where school_number is not null and length(trim(school_number)) > 0;

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  property_id text unique not null,
  name text not null,
  purchase_date date,
  service_life integer,
  specification text,
  unit text,
  price numeric,
  department text,
  location text,
  custodian text,
  supplier text,
  asset_status text not null default 'normal',
  availability_status text not null default 'available'
    check (availability_status in ('available', 'pending', 'checked_out', 'overdue', 'maintenance', 'lost')),
  usage_count integer not null default 0 check (usage_count >= 0),
  note text,
  brand text,
  model text,
  is_borrowable boolean not null default true,
  is_active boolean not null default true,
  current_loan_id uuid,
  audit_status text not null default '待盤點',
  last_audit_at timestamptz,
  return_alert text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_property_id_text check (property_id ~ '^[0-9A-Za-z\-]+$')
);

create table public.loan_records (
  id uuid primary key default gen_random_uuid(),
  loan_number text unique not null,
  asset_id uuid not null references public.assets(id),
  property_id text not null,
  property_name text not null,
  borrower_id uuid not null references public.profiles(id),
  borrower_name text not null,
  borrower_number text not null,
  borrower_department text not null,
  purpose text not null,
  contact text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  checkout_at timestamptz,
  expected_return_at timestamptz not null,
  returned_at timestamptz,
  checkout_condition text,
  return_condition text,
  return_result text,
  return_location text,
  checkout_method text,
  checkout_operator text,
  return_operator text,
  status text not null default 'pending'
    check (status in (
      'pending', 'approved', 'checked_out', 'overdue',
      'return_pending', 'returned', 'rejected', 'cancelled'
    )),
  rejection_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assets
  add constraint assets_current_loan_fk
  foreign key (current_loan_id) references public.loan_records(id);

create unique index loan_records_one_active_per_asset
  on public.loan_records (asset_id)
  where status in ('pending', 'approved', 'checked_out', 'overdue', 'return_pending');

create index loan_records_borrower_idx on public.loan_records (borrower_id);
create index loan_records_status_idx on public.loan_records (status);
create index loan_records_asset_idx on public.loan_records (asset_id);

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  loan_id uuid references public.loan_records(id),
  user_name text not null,
  department text not null,
  used_at timestamptz not null,
  purpose text not null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index usage_records_asset_idx on public.usage_records (asset_id, used_at desc);

create table public.inventory_audits (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  registered_location text,
  actual_location text not null,
  result text not null,
  auditor text not null,
  audited_at timestamptz not null default now(),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index inventory_audits_asset_idx on public.inventory_audits (asset_id, audited_at desc);

create table public.location_history (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  from_location text,
  to_location text not null,
  reason text,
  operator_id uuid references public.profiles(id),
  operator_name text,
  changed_at timestamptz not null default now()
);

create index location_history_asset_idx on public.location_history (asset_id, changed_at desc);

create table public.asset_images (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  storage_path text not null unique,
  is_primary boolean not null default true,
  mime_type text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index asset_images_asset_idx on public.asset_images (asset_id);

create table public.operation_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text,
  entity_id uuid,
  asset_id uuid references public.assets(id),
  actor_id uuid references public.profiles(id),
  actor_name text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index operation_logs_created_idx on public.operation_logs (created_at desc);

create table public.system_settings (
  id integer primary key default 1 check (id = 1),
  require_loan_approval boolean not null default false,
  default_loan_days integer not null default 1,
  allow_self_checkout boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create or replace view public.loan_records_view
with (security_invoker = true)
as
select
  l.*,
  case
    when l.returned_at is null
      and l.status = 'checked_out'
      and now() > l.expected_return_at
    then 'overdue'
    else l.status
  end as display_status,
  (
    l.returned_at is null
    and l.status = 'checked_out'
    and now() > l.expected_return_at
  ) as is_overdue
from public.loan_records l;

create or replace view public.overdue_loans
with (security_invoker = true)
as
select *
from public.loan_records_view
where is_overdue = true;

-- 此視圖由擁有者執行，只暴露基本欄位，不含單價、保管人、供應商
create or replace view public.assets_basic as
select
  id,
  property_id,
  name,
  location,
  department,
  specification,
  unit,
  availability_status,
  usage_count,
  is_borrowable,
  is_active,
  current_loan_id,
  audit_status,
  last_audit_at,
  created_at,
  updated_at
from public.assets
where is_active = true;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

create trigger loan_records_set_updated_at
  before update on public.loan_records
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), '使用者'),
    'borrower',
    true
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    if actor_role is distinct from 'admin' then
      raise exception '不可修改角色或帳號啟用狀態';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.protect_asset_usage_count()
returns trigger
language plpgsql
as $$
begin
  if new.usage_count is distinct from old.usage_count
     and current_setting('hkproperty.allow_usage_count', true) is distinct from 'on' then
    raise exception '使用次數不可由一般操作直接修改';
  end if;
  if new.property_id is distinct from old.property_id then
    raise exception '財產編號不可變更';
  end if;
  return new;
end;
$$;

create trigger assets_protect_usage
  before update on public.assets
  for each row execute function public.protect_asset_usage_count();
