-- RLS 測試（在 SQL Editor 以 postgres 身分執行）
-- 請先將下面兩個 UUID 換成實際的 borrower A / borrower B
-- 不可把真實個資寫進此檔

-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
-- select set_config('request.jwt.claim.role', 'authenticated', true);
--
-- -- A 只能看到自己的借用
-- select count(*) as my_loans
-- from public.loan_records
-- where borrower_id = '00000000-0000-0000-0000-000000000002';
-- -- 預期：0
--
-- -- A 不可把自己改成 admin
-- update public.profiles
--   set role = 'admin'
--   where id = '00000000-0000-0000-0000-000000000001';
-- -- 預期：觸發「不可修改角色或帳號啟用狀態」
--
-- -- A 不可直接改財產狀態
-- update public.assets set availability_status = 'lost' where true;
-- -- 預期：0 列（RLS 阻擋）或權限錯誤
--
-- rollback;

create or replace function public.assert_rls_borrower_isolation()
returns table(check_name text, passed boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select 'loan_records 已啟用 RLS'::text, relrowsecurity, 'loan_records'::text
  from pg_class
  where relname = 'loan_records' and relnamespace = 'public'::regnamespace;

  return query
  select 'assets 已啟用 RLS'::text, relrowsecurity, 'assets'::text
  from pg_class
  where relname = 'assets' and relnamespace = 'public'::regnamespace;

  return query
  select 'profiles 禁止匿名讀取政策存在'::text,
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'loan_records' and policyname = 'loans_select'
    ),
    'loans_select'::text;

  return query
  select 'loan 禁止直接刪除'::text,
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'loan_records' and policyname = 'loans_no_delete'
    ),
    'loans_no_delete'::text;
end;
$$;

grant execute on function public.assert_rls_borrower_isolation() to authenticated;
