# hkp_users ↔ hkp_staff_users 對照（第二階段）

匯出時間：2026-09-15T13:57:02.401Z

## hkp_staff_users（現行登入）

| ID | 名稱 | Email | role | active | last_login |
|---|---|---|---|---|---|
| fpr1kqiu3hiqmrl | 系統管理員 | hk***@hkproperty.local | admin | true | — |
| tid9bqo44lk8bbf | 經辦人員 | hk***@hkproperty.local | staff | true | — |

## hkp_users（舊帳號，不刪）

| ID | 名稱 | Email | role | active | 與 staff 重複 | 建議 |
|---|---|---|---|---|---|---|
| he1zzwob4nq9uxd | 測試管理者 | ke***@gmail.com | admin | true | 否 | review_manual_migrate_if_still_needed |
| xuk7fis62zn8noj | 正式管理者 | hk***@hkproperty.local | admin | true | 是 | do_not_migrate_duplicate_exists_in_staff |
| 44m4xig6t0ak0e8 | 正式經辦 | hk***@hkproperty.local | staff | true | 是 | do_not_migrate_duplicate_exists_in_staff |
| lvz41b9rvau8tww | 正式借用人 | hk***@hkproperty.local | borrower | true | 否 | retain_unused_public_no_login |

密碼／token 未匯出。新系統僅使用 `hkp_staff_users`。