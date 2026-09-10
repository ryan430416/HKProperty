-- Row Level Security
-- 不使用 using (true) / with check (true) 的全開政策

alter table public.profiles enable row level security;
alter table public.assets enable row level security;
alter table public.loan_records enable row level security;
alter table public.usage_records enable row level security;
alter table public.inventory_audits enable row level security;
alter table public.location_history enable row level security;
alter table public.asset_images enable row level security;
alter table public.operation_logs enable row level security;
alter table public.system_settings enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to authenticated;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and is_active = true
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role in ('staff', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role = 'admin'
  );
$$;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- profiles
grant select, update on public.profiles to authenticated;

create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy profiles_no_insert
  on public.profiles for insert to authenticated
  with check (false);

create policy profiles_no_delete
  on public.profiles for delete to authenticated
  using (false);

-- assets 主檔僅 staff/admin 可讀（含單價、保管人）
-- 借用人改讀 assets_basic 視圖（見 001，不以 security_invoker 套用主檔 RLS）
grant select on public.assets to authenticated;
grant select on public.assets_basic to authenticated;

create policy assets_select_staff
  on public.assets for select to authenticated
  using (public.is_staff());

create policy assets_insert_admin
  on public.assets for insert to authenticated
  with check (public.is_admin());

create policy assets_update_staff
  on public.assets for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy assets_no_delete
  on public.assets for delete to authenticated
  using (false);

-- loan_records
grant select, insert on public.loan_records to authenticated;
grant select on public.loan_records_view to authenticated;
grant select on public.overdue_loans to authenticated;

create policy loans_select
  on public.loan_records for select to authenticated
  using (borrower_id = auth.uid() or public.is_staff());

create policy loans_insert_own
  on public.loan_records for insert to authenticated
  with check (
    borrower_id = auth.uid()
    and status = 'pending'
  );

create policy loans_no_direct_update
  on public.loan_records for update to authenticated
  using (false)
  with check (false);

create policy loans_no_delete
  on public.loan_records for delete to authenticated
  using (false);

-- usage_records
grant select, insert on public.usage_records to authenticated;

create policy usage_select
  on public.usage_records for select to authenticated
  using (
    public.is_staff()
    or created_by = auth.uid()
    or exists (
      select 1 from public.loan_records l
      where l.id = usage_records.loan_id and l.borrower_id = auth.uid()
    )
  );

create policy usage_insert_staff
  on public.usage_records for insert to authenticated
  with check (public.is_staff());

create policy usage_no_update
  on public.usage_records for update to authenticated
  using (false);

create policy usage_no_delete
  on public.usage_records for delete to authenticated
  using (false);

-- inventory_audits
grant select, insert on public.inventory_audits to authenticated;

create policy audits_select
  on public.inventory_audits for select to authenticated
  using (public.is_staff());

create policy audits_insert
  on public.inventory_audits for insert to authenticated
  with check (public.is_staff());

create policy audits_no_update
  on public.inventory_audits for update to authenticated
  using (false);

create policy audits_no_delete
  on public.inventory_audits for delete to authenticated
  using (false);

-- location_history
grant select, insert on public.location_history to authenticated;

create policy location_select
  on public.location_history for select to authenticated
  using (public.is_staff());

create policy location_insert
  on public.location_history for insert to authenticated
  with check (public.is_staff());

create policy location_no_update
  on public.location_history for update to authenticated
  using (false);

create policy location_no_delete
  on public.location_history for delete to authenticated
  using (false);

-- asset_images
grant select, insert, delete on public.asset_images to authenticated;

create policy images_select
  on public.asset_images for select to authenticated
  using (auth.uid() is not null);

create policy images_insert
  on public.asset_images for insert to authenticated
  with check (public.is_staff());

create policy images_no_update
  on public.asset_images for update to authenticated
  using (false);

create policy images_delete
  on public.asset_images for delete to authenticated
  using (public.is_staff());

-- operation_logs：只讀，寫入由 security definer 函式完成
grant select on public.operation_logs to authenticated;

create policy logs_select
  on public.operation_logs for select to authenticated
  using (public.is_staff());

create policy logs_no_insert
  on public.operation_logs for insert to authenticated
  with check (false);

create policy logs_no_update
  on public.operation_logs for update to authenticated
  using (false);

create policy logs_no_delete
  on public.operation_logs for delete to authenticated
  using (false);

-- system_settings
grant select on public.system_settings to authenticated;

create policy settings_select
  on public.system_settings for select to authenticated
  using (auth.uid() is not null);

create policy settings_no_insert
  on public.system_settings for insert to authenticated
  with check (false);

create policy settings_update_admin
  on public.system_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy settings_no_delete
  on public.system_settings for delete to authenticated
  using (false);

-- Storage：asset-images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-images',
  'asset-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_images_select on storage.objects;
drop policy if exists storage_images_insert on storage.objects;
drop policy if exists storage_images_update on storage.objects;
drop policy if exists storage_images_delete on storage.objects;

create policy storage_images_select
  on storage.objects for select to authenticated, anon
  using (bucket_id = 'asset-images');

create policy storage_images_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'asset-images'
    and public.is_staff()
    and (storage.foldername(name))[1] = 'assets'
  );

create policy storage_images_update
  on storage.objects for update to authenticated
  using (false);

create policy storage_images_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'asset-images' and public.is_staff());
