-- 系統設定：測試環境預設不需審核、允許自助借還
-- 正式上線請改為 require_loan_approval = true, allow_self_checkout = false

insert into public.system_settings (
  id,
  require_loan_approval,
  default_loan_days,
  allow_self_checkout
) values (
  1,
  false,
  1,
  true
)
on conflict (id) do update set
  require_loan_approval = excluded.require_loan_approval,
  default_loan_days = excluded.default_loan_days,
  allow_self_checkout = excluded.allow_self_checkout;
