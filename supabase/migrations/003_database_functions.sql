-- 以 transaction 完成借出、歸還、盤點等操作（函式本身為單一交易）

create or replace function public.current_actor()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles
  where id = auth.uid() and is_active = true
$$;

create or replace function public.log_operation(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_asset_id uuid,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
begin
  select * into actor from public.current_actor();
  insert into public.operation_logs (action, entity_type, entity_id, asset_id, actor_id, actor_name, detail)
  values (
    p_action,
    p_entity_type,
    p_entity_id,
    p_asset_id,
    actor.id,
    coalesce(actor.display_name, '系統'),
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

create or replace function public.next_loan_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp text;
  prefix text;
  next_serial int;
begin
  stamp := to_char(timezone('Asia/Taipei', now()), 'YYYYMMDD');
  prefix := 'LOAN-' || stamp || '-';
  select coalesce(max(substring(loan_number from length(prefix) + 1)::int), 0) + 1
    into next_serial
  from public.loan_records
  where loan_number like prefix || '%';
  return prefix || lpad(next_serial::text, 4, '0');
end;
$$;

create or replace function public.get_system_settings()
returns public.system_settings
language sql
stable
security definer
set search_path = public
as $$
  select * from public.system_settings where id = 1
$$;

create or replace function public.list_overdue_loans()
returns setof public.loan_records_view
language sql
stable
security invoker
set search_path = public
as $$
  select * from public.overdue_loans
$$;

create or replace function public.resolve_borrower_id(p_borrower_number text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found_id uuid;
  actor public.profiles;
begin
  select * into actor from public.current_actor();
  if actor.id is null then
    raise exception '請先登入';
  end if;
  if actor.role = 'borrower' then
    return actor.id;
  end if;
  select id into found_id
  from public.profiles
  where school_number is not null
    and lower(trim(school_number)) = lower(trim(p_borrower_number))
  limit 1;
  if found_id is null then
    return actor.id;
  end if;
  return found_id;
end;
$$;

create or replace function public.create_loan_request(
  p_asset_id uuid,
  p_borrower_name text,
  p_borrower_number text,
  p_borrower_department text,
  p_purpose text,
  p_expected_return_at timestamptz,
  p_contact text default null,
  p_checkout_at timestamptz default now(),
  p_checkout_condition text default null,
  p_note text default null,
  p_checkout_method text default 'self_service'
)
returns public.loan_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  item public.assets;
  settings public.system_settings;
  rec public.loan_records;
begin
  select * into actor from public.current_actor();
  if actor.id is null then raise exception '請先登入'; end if;
  if length(trim(p_borrower_name)) = 0 then raise exception '請填寫借用人姓名'; end if;
  if length(trim(p_borrower_number)) < 4 then raise exception '學號或教職員編號至少 4 個字元'; end if;
  if length(trim(p_borrower_department)) = 0 then raise exception '請填寫借用單位、系所或社團'; end if;
  if length(trim(p_purpose)) = 0 then raise exception '請填寫借用用途'; end if;
  if p_expected_return_at is null then raise exception '請填寫預計歸還日期與時間'; end if;
  if p_expected_return_at < coalesce(p_checkout_at, now()) then
    raise exception '預計歸還時間不得早於借出時間';
  end if;
  if actor.role = 'borrower' and p_checkout_method is distinct from 'self_service' then
    raise exception '借用人只能使用自助借用';
  end if;

  select * into settings from public.get_system_settings();
  select * into item from public.assets where id = p_asset_id for update;
  if item.id is null or item.is_active = false then raise exception '查無此財產編號'; end if;
  if item.is_borrowable = false then raise exception '此財產不可借用'; end if;
  if item.availability_status = 'maintenance' then raise exception '此財產維修中，無法辦理借出'; end if;
  if item.availability_status = 'lost' then raise exception '此財產狀態為異常，無法辦理借出'; end if;
  if item.availability_status in ('checked_out', 'overdue') then raise exception '此財產目前已借出，不可再次借出'; end if;
  if item.availability_status = 'pending' then raise exception '此財產已有待處理的借用申請'; end if;
  if exists (
    select 1 from public.loan_records
    where asset_id = item.id
      and status in ('pending', 'approved', 'checked_out', 'overdue', 'return_pending')
  ) then
    raise exception '此財產已有未完成的借用紀錄，不可重複借出';
  end if;

  insert into public.loan_records (
    loan_number, asset_id, property_id, property_name, borrower_id, borrower_name, borrower_number, borrower_department,
    purpose, contact, requested_at, checkout_at, expected_return_at, checkout_condition,
    checkout_method, checkout_operator, status, note
  ) values (
    public.next_loan_number(),
    item.id,
    item.property_id,
    item.name,
    public.resolve_borrower_id(p_borrower_number),
    trim(p_borrower_name),
    trim(p_borrower_number),
    trim(p_borrower_department),
    trim(p_purpose),
    nullif(trim(coalesce(p_contact, '')), ''),
    now(),
    coalesce(p_checkout_at, now()),
    p_expected_return_at,
    nullif(trim(coalesce(p_checkout_condition, '')), ''),
    coalesce(p_checkout_method, 'self_service'),
    case when coalesce(p_checkout_method, 'self_service') = 'self_service' then '自助借用' else coalesce(actor.display_name, '管理者') end,
    'pending',
    nullif(trim(coalesce(p_note, '')), '')
  ) returning * into rec;

  if coalesce(settings.require_loan_approval, false) = true
     and actor.role = 'borrower' then
    update public.assets set availability_status = 'pending', current_loan_id = rec.id
    where id = item.id;
    perform public.log_operation('借用申請', 'loan', rec.id, item.id, jsonb_build_object('loan_number', rec.loan_number));
    return rec;
  end if;

  return public.checkout_asset(rec.id);
end;
$$;

create or replace function public.approve_loan_request(p_loan_id uuid)
returns public.loan_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.loan_records;
begin
  select * into actor from public.current_actor();
  if actor.role not in ('staff', 'admin') then raise exception '沒有核准權限'; end if;
  select * into rec from public.loan_records where id = p_loan_id for update;
  if rec.id is null then raise exception '找不到借用申請'; end if;
  if rec.status is distinct from 'pending' then raise exception '僅能核准待審核的申請'; end if;
  update public.loan_records
    set status = 'approved', approved_at = now(), approved_by = actor.id
    where id = rec.id
    returning * into rec;
  update public.assets set availability_status = 'pending' where id = rec.asset_id;
  perform public.log_operation('核准', 'loan', rec.id, rec.asset_id, jsonb_build_object('loan_number', rec.loan_number));
  return rec;
end;
$$;

create or replace function public.reject_loan_request(p_loan_id uuid, p_reason text)
returns public.loan_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.loan_records;
begin
  select * into actor from public.current_actor();
  if actor.role not in ('staff', 'admin') then raise exception '沒有拒絕權限'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception '請填寫拒絕原因'; end if;
  select * into rec from public.loan_records where id = p_loan_id for update;
  if rec.id is null then raise exception '找不到借用申請'; end if;
  if rec.status not in ('pending', 'approved') then raise exception '此申請目前無法拒絕'; end if;
  update public.loan_records
    set status = 'rejected', rejection_reason = trim(p_reason)
    where id = rec.id
    returning * into rec;
  update public.assets
    set availability_status = 'available', current_loan_id = null
    where id = rec.asset_id and current_loan_id = rec.id;
  perform public.log_operation('拒絕', 'loan', rec.id, rec.asset_id, jsonb_build_object('reason', trim(p_reason)));
  return rec;
end;
$$;

create or replace function public.checkout_asset(p_loan_id uuid)
returns public.loan_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.loan_records;
  item public.assets;
  settings public.system_settings;
begin
  select * into actor from public.current_actor();
  if actor.id is null then raise exception '請先登入'; end if;
  select * into settings from public.get_system_settings();
  select * into rec from public.loan_records where id = p_loan_id for update;
  if rec.id is null then raise exception '找不到借用紀錄'; end if;
  if rec.status = 'checked_out' then raise exception '此筆借用已完成借出'; end if;
  if rec.status in ('returned', 'rejected', 'cancelled') then raise exception '此筆借用無法借出'; end if;
  if rec.status = 'pending' and settings.require_loan_approval = true and actor.role = 'borrower' then
    raise exception '借用申請尚待核准';
  end if;
  if rec.status not in ('pending', 'approved') then raise exception '目前狀態不可辦理借出'; end if;
  if actor.role = 'borrower' and rec.borrower_id is distinct from actor.id then
    raise exception '只能辦理自己的借用';
  end if;
  if actor.role = 'borrower' and coalesce(settings.allow_self_checkout, false) = false then
    raise exception '目前未開放自助借出，請由管理者辦理';
  end if;

  select * into item from public.assets where id = rec.asset_id for update;
  if item.id is null or item.is_active = false then raise exception '查無此財產編號'; end if;
  if item.availability_status in ('checked_out', 'overdue') then
    raise exception '此財產目前已借出，不可再次借出';
  end if;
  if item.availability_status in ('maintenance', 'lost') then
    raise exception '此財產目前不可借用';
  end if;
  if exists (
    select 1 from public.loan_records
    where asset_id = item.id
      and id is distinct from rec.id
      and status in ('pending', 'approved', 'checked_out', 'overdue', 'return_pending')
  ) then
    raise exception '此財產已有其他有效借用紀錄';
  end if;

  update public.loan_records
    set status = 'checked_out',
        checkout_at = coalesce(checkout_at, now()),
        checkout_operator = coalesce(checkout_operator, case when rec.checkout_method = 'self_service' then '自助借用' else coalesce(actor.display_name, '管理者') end)
    where id = rec.id
    returning * into rec;

  perform set_config('hkproperty.allow_usage_count', 'on', true);
  update public.assets
    set availability_status = 'checked_out',
        current_loan_id = rec.id,
        usage_count = usage_count + 1,
        return_alert = null
    where id = item.id;
  perform set_config('hkproperty.allow_usage_count', 'off', true);

  insert into public.usage_records (asset_id, loan_id, user_name, department, used_at, purpose, note, created_by)
  values (
    item.id, rec.id, rec.borrower_name, rec.borrower_department,
    coalesce(rec.checkout_at, now()), rec.purpose, '借用編號 ' || rec.loan_number, actor.id
  );

  perform public.log_operation('借出', 'loan', rec.id, item.id, jsonb_build_object('loan_number', rec.loan_number));
  return rec;
end;
$$;

create or replace function public.request_asset_return(
  p_loan_id uuid,
  p_returned_at timestamptz default now(),
  p_return_location text default null,
  p_return_result text default '正常歸還',
  p_return_condition text default null,
  p_note text default null
)
returns public.loan_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.loan_records;
  settings public.system_settings;
begin
  select * into actor from public.current_actor();
  if actor.id is null then raise exception '請先登入'; end if;
  select * into settings from public.get_system_settings();
  select * into rec from public.loan_records where id = p_loan_id for update;
  if rec.id is null then raise exception '找不到借用紀錄'; end if;
  if rec.returned_at is not null or rec.status = 'returned' then
    raise exception '此筆借用已完成歸還，不可重複歸還';
  end if;
  if rec.status not in ('checked_out', 'overdue', 'return_pending') then
    raise exception '目前狀態不可辦理歸還';
  end if;
  if actor.role = 'borrower' and rec.borrower_id is distinct from actor.id then
    raise exception '只能歸還自己的借用';
  end if;

  if actor.role = 'borrower' and coalesce(settings.allow_self_checkout, false) = true then
    return public.complete_asset_return(
      p_loan_id, p_returned_at, p_return_location, p_return_result, p_return_condition, p_note
    );
  end if;

  update public.loan_records
    set status = 'return_pending',
        return_location = coalesce(nullif(trim(coalesce(p_return_location, '')), ''), return_location),
        return_result = p_return_result,
        return_condition = p_return_condition,
        note = case when p_note is not null and length(trim(p_note)) > 0
          then coalesce(note || '；', '') || trim(p_note) else note end
    where id = rec.id
    returning * into rec;
  perform public.log_operation('歸還申請', 'loan', rec.id, rec.asset_id, jsonb_build_object('loan_number', rec.loan_number));
  return rec;
end;
$$;

create or replace function public.complete_asset_return(
  p_loan_id uuid,
  p_returned_at timestamptz,
  p_return_location text,
  p_return_result text,
  p_return_condition text default null,
  p_note text default null
)
returns public.loan_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.loan_records;
  item public.assets;
  settings public.system_settings;
  result_text text;
  next_status text;
  next_alert text;
begin
  select * into actor from public.current_actor();
  if actor.id is null then raise exception '請先登入'; end if;
  select * into settings from public.get_system_settings();
  select * into rec from public.loan_records where id = p_loan_id for update;
  if rec.id is null then raise exception '找不到借用紀錄'; end if;
  if rec.returned_at is not null or rec.status = 'returned' then
    raise exception '此筆借用已完成歸還，不可重複歸還';
  end if;
  if rec.status not in ('checked_out', 'overdue', 'return_pending') then
    raise exception '目前狀態不可辦理歸還';
  end if;
  if actor.role = 'borrower' then
    if rec.borrower_id is distinct from actor.id then raise exception '只能歸還自己的借用'; end if;
    if coalesce(settings.allow_self_checkout, false) = false then
      raise exception '目前未開放自助歸還，請由管理者辦理';
    end if;
  end if;
  if p_returned_at is null then raise exception '請填寫實際歸還日期與時間'; end if;
  if length(trim(coalesce(p_return_location, ''))) = 0 then raise exception '請填寫歸還後存放地點'; end if;
  if p_returned_at < coalesce(rec.checkout_at, rec.requested_at) then
    raise exception '實際歸還時間不得早於借出時間';
  end if;

  result_text := case trim(coalesce(p_return_result, ''))
    when '正常' then '正常歸還'
    when '正常歸還' then '正常歸還'
    when '有損壞' then '有損壞'
    when '配件缺少' then '配件缺少'
    when '送修' then '送修'
    when '遺失' then '遺失'
    else null
  end;
  if result_text is null then raise exception '請選擇物品歸還狀況'; end if;
  if result_text is distinct from '正常歸還'
     and length(trim(coalesce(p_return_condition, ''))) = 0
     and actor.role = 'borrower' then
    raise exception '請填寫問題說明';
  end if;

  next_status := 'available';
  next_alert := null;
  if result_text = '送修' then next_status := 'maintenance'; end if;
  if result_text = '遺失' then next_status := 'lost'; end if;
  if result_text = '有損壞' then next_alert := 'damaged'; end if;
  if result_text = '配件缺少' then next_alert := 'missing_parts'; end if;

  select * into item from public.assets where id = rec.asset_id for update;

  update public.loan_records
    set status = 'returned',
        returned_at = p_returned_at,
        return_location = trim(p_return_location),
        return_result = result_text,
        return_condition = nullif(trim(coalesce(p_return_condition, '')), ''),
        return_operator = case when rec.checkout_method = 'self_service' and actor.role = 'borrower' then '自助歸還' else coalesce(actor.display_name, '管理者') end,
        note = case when p_note is not null and length(trim(p_note)) > 0
          then coalesce(note || '；', '') || trim(p_note) else note end
    where id = rec.id
    returning * into rec;

  update public.assets
    set availability_status = next_status,
        current_loan_id = null,
        return_alert = next_alert
    where id = item.id;

  if trim(p_return_location) is distinct from coalesce(item.location, '') then
    insert into public.location_history (asset_id, from_location, to_location, reason, operator_id, operator_name)
    values (item.id, item.location, trim(p_return_location), '歸還後更新存放位置（' || result_text || '）', actor.id, coalesce(actor.display_name, '管理者'));
    update public.assets set location = trim(p_return_location) where id = item.id;
  end if;

  perform public.log_operation('歸還', 'loan', rec.id, item.id, jsonb_build_object('loan_number', rec.loan_number, 'result', result_text));
  return rec;
end;
$$;

create or replace function public.record_asset_usage(
  p_asset_id uuid,
  p_user_name text,
  p_department text,
  p_used_at timestamptz,
  p_purpose text,
  p_note text default null
)
returns public.usage_records
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  item public.assets;
  rec public.usage_records;
begin
  select * into actor from public.current_actor();
  if actor.role not in ('staff', 'admin') then raise exception '沒有登記使用的權限'; end if;
  select * into item from public.assets where id = p_asset_id for update;
  if item.id is null then raise exception '找不到財產'; end if;
  if length(trim(p_user_name)) = 0 then raise exception '請填寫使用人'; end if;
  if length(trim(p_department)) = 0 then raise exception '請填寫使用單位'; end if;
  if p_used_at is null then raise exception '請填寫使用日期與時間'; end if;
  if length(trim(p_purpose)) = 0 then raise exception '請填寫使用用途'; end if;

  insert into public.usage_records (asset_id, user_name, department, used_at, purpose, note, created_by)
  values (item.id, trim(p_user_name), trim(p_department), p_used_at, trim(p_purpose), nullif(trim(coalesce(p_note, '')), ''), actor.id)
  returning * into rec;

  perform set_config('hkproperty.allow_usage_count', 'on', true);
  update public.assets set usage_count = usage_count + 1 where id = item.id;
  perform set_config('hkproperty.allow_usage_count', 'off', true);
  return rec;
end;
$$;

create or replace function public.record_inventory_audit(
  p_asset_id uuid,
  p_registered_location text,
  p_actual_location text,
  p_result text,
  p_auditor text,
  p_audited_at timestamptz,
  p_note text default null
)
returns public.inventory_audits
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  item public.assets;
  rec public.inventory_audits;
  next_audit text;
begin
  select * into actor from public.current_actor();
  if actor.role not in ('staff', 'admin') then raise exception '沒有盤點權限'; end if;
  select * into item from public.assets where id = p_asset_id for update;
  if item.id is null then raise exception '找不到財產'; end if;
  if length(trim(p_auditor)) = 0 then raise exception '請填寫盤點人'; end if;
  if length(trim(p_actual_location)) = 0 then raise exception '請填寫本次實際位置'; end if;
  if p_result is null then raise exception '請選擇盤點結果'; end if;
  if p_result = '位置正確' and trim(p_actual_location) is distinct from coalesce(p_registered_location, '') then
    raise exception '實際位置與系統登記位置不同，請改選「位置異常」';
  end if;

  insert into public.inventory_audits (
    asset_id, registered_location, actual_location, result, auditor, audited_at, note, created_by
  ) values (
    item.id, p_registered_location, trim(p_actual_location), p_result, trim(p_auditor),
    coalesce(p_audited_at, now()), nullif(trim(coalesce(p_note, '')), ''), actor.id
  ) returning * into rec;

  next_audit := case p_result
    when '位置正確' then '已盤點'
    when '位置異常' then '位置異常'
    when '找不到物品' then '找不到物品'
    when '物品損壞' then '物品損壞'
    else '待盤點'
  end;
  update public.assets set last_audit_at = rec.audited_at, audit_status = next_audit where id = item.id;
  perform public.log_operation('盤點', 'audit', rec.id, item.id, jsonb_build_object('result', p_result));
  return rec;
end;
$$;

create or replace function public.update_asset_location(
  p_asset_id uuid,
  p_from_location text,
  p_to_location text,
  p_reason text
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  item public.assets;
begin
  select * into actor from public.current_actor();
  if actor.role not in ('staff', 'admin') then raise exception '沒有修改位置的權限'; end if;
  select * into item from public.assets where id = p_asset_id for update;
  if item.id is null then raise exception '找不到財產'; end if;
  if length(trim(p_to_location)) = 0 then raise exception '請填寫新的存放位置'; end if;
  if trim(p_to_location) = coalesce(p_from_location, item.location, '') then
    raise exception '新位置與目前位置相同';
  end if;
  insert into public.location_history (asset_id, from_location, to_location, reason, operator_id, operator_name)
  values (item.id, coalesce(p_from_location, item.location), trim(p_to_location), coalesce(nullif(trim(p_reason), ''), '更新存放位置'), actor.id, coalesce(actor.display_name, '管理者'));
  update public.assets set location = trim(p_to_location) where id = item.id returning * into item;
  perform public.log_operation('位置異動', 'asset', item.id, item.id, jsonb_build_object('to', trim(p_to_location)));
  return item;
end;
$$;

create or replace function public.admin_update_profile(
  p_profile_id uuid,
  p_role text default null,
  p_is_active boolean default null,
  p_display_name text default null,
  p_department text default null,
  p_school_number text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.profiles;
begin
  select * into actor from public.current_actor();
  if actor.role is distinct from 'admin' then raise exception '只有管理者可以修改使用者角色'; end if;
  if p_role is not null and p_role not in ('borrower', 'staff', 'admin') then
    raise exception '角色不正確';
  end if;
  select * into rec from public.profiles where id = p_profile_id for update;
  if rec.id is null then raise exception '找不到使用者'; end if;
  update public.profiles
    set role = coalesce(p_role, role),
        is_active = coalesce(p_is_active, is_active),
        display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
        department = coalesce(p_department, department),
        school_number = coalesce(p_school_number, school_number)
    where id = rec.id
    returning * into rec;
  perform public.log_operation('角色修改', 'profile', rec.id, null, jsonb_build_object('role', rec.role, 'is_active', rec.is_active));
  return rec;
end;
$$;

create or replace function public.admin_update_settings(
  p_require_loan_approval boolean,
  p_allow_self_checkout boolean,
  p_default_loan_days integer
)
returns public.system_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  rec public.system_settings;
begin
  select * into actor from public.current_actor();
  if actor.role is distinct from 'admin' then raise exception '只有管理者可以修改系統設定'; end if;
  update public.system_settings
    set require_loan_approval = coalesce(p_require_loan_approval, require_loan_approval),
        allow_self_checkout = coalesce(p_allow_self_checkout, allow_self_checkout),
        default_loan_days = coalesce(p_default_loan_days, default_loan_days),
        updated_by = actor.id,
        updated_at = now()
    where id = 1
    returning * into rec;
  perform public.log_operation('修改系統設定', 'settings', null, null, to_jsonb(rec));
  return rec;
end;
$$;

create or replace function public.admin_set_asset_active(p_asset_id uuid, p_is_active boolean)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  item public.assets;
begin
  select * into actor from public.current_actor();
  if actor.role is distinct from 'admin' then raise exception '只有管理者可以停用財產'; end if;
  update public.assets set is_active = p_is_active where id = p_asset_id returning * into item;
  if item.id is null then raise exception '找不到財產'; end if;
  perform public.log_operation(case when p_is_active then '修改財產' else '停用財產' end, 'asset', item.id, item.id, jsonb_build_object('property_id', item.property_id, 'is_active', p_is_active));
  return item;
end;
$$;

grant execute on function public.create_loan_request(uuid, text, text, text, text, timestamptz, text, timestamptz, text, text, text) to authenticated;
grant execute on function public.approve_loan_request(uuid) to authenticated;
grant execute on function public.reject_loan_request(uuid, text) to authenticated;
grant execute on function public.checkout_asset(uuid) to authenticated;
grant execute on function public.request_asset_return(uuid, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.complete_asset_return(uuid, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.record_asset_usage(uuid, text, text, timestamptz, text, text) to authenticated;
grant execute on function public.record_inventory_audit(uuid, text, text, text, text, timestamptz, text) to authenticated;
grant execute on function public.update_asset_location(uuid, text, text, text) to authenticated;
grant execute on function public.admin_update_profile(uuid, text, boolean, text, text, text) to authenticated;
grant execute on function public.admin_update_settings(boolean, boolean, integer) to authenticated;
grant execute on function public.admin_set_asset_active(uuid, boolean) to authenticated;
grant execute on function public.get_system_settings() to authenticated;
grant execute on function public.list_overdue_loans() to authenticated;
grant execute on function public.next_loan_number() to authenticated;
