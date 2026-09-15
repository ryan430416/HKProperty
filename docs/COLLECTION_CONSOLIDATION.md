# hkp_* 集合整合

## 結果

線上 `db.keson.pro` 已刪除 **6 個空的舊集合／重複 view**，`hkp_assets` 仍為 **390** 筆，未動財產主檔。現存 **18** 個 `hkp_*`。

| 已刪除 | 原因 |
|---|---|
| `hkp_reservation_public` | 舊預借公開 view，改由 `hkp_lock_public` |
| `hkp_reservation_slots` | 舊時段 view，改由 `hkp_lock_public` |
| `hkp_reservations_v2` | 空舊預借表，改由 `hkp_time_locks` |
| `hkp_asset_reservations` | 更舊一層預借，無人使用且 0 筆 |
| `hkp_return_requests` | 空舊歸還表，併入 `hkp_borrow_requests`（`return_pending`） |
| `hkp_assets_public` | 與 `hkp_assets_guest` 重複，公開目錄改讀 guest |

## 現在保留（約 18）

**帳號**
- `hkp_staff_users`：經辦／管理者登入
- `hkp_users`：舊帳號集合（仍有 4 筆，暫留，未刪）

**主資料**
- `hkp_assets`：財產主檔（390）
- `hkp_borrow_requests` / `hkp_borrow_records`：借用申請與借出紀錄
- `hkp_time_locks`：預借時段鎖
- `hkp_usage_records`：使用紀錄
- `hkp_operation_logs`：操作日誌
- `hkp_system_settings`：系統設定
- `hkp_inventory_audits` / `hkp_location_history`：盤點、位置（管理用）
- `hkp_loan_records`：舊借出表（0 筆，因 `hkp_assets.current_loan` 仍指向它，暫留）

**View（欄位／規則隔離）**
- `hkp_assets_guest`、`hkp_borrow_slots`、`hkp_borrow_verify`
- `hkp_lock_public`、`hkp_lock_verify`、`hkp_usage_counts`

## 為何不能再砍成「一個大表」

PocketBase 用 collection／view 管 API 規則與可見欄位。匿名端、經辦端、管理者看到的欄位不同；若全部併進 `hkp_assets`，電話與內部欄位較容易外洩。View 看起來像「多資料庫」，實際多半是同一份資料的安全視窗。

## 之後可再收斂（需另外確認）

1. 清掉 `hkp_assets.current_loan` 關聯後，再刪 `hkp_loan_records`
2. 確認不再需要 `hkp_users` 後再移轉／刪除那 4 個帳號
3. 主機部署更新後的 `pb_hooks`（已移除對舊集合的相容碼）

重跑腳本（僅刪空目標，assets≠390 會中止）：

```bash
node scripts/consolidate-hkp-collections.mjs
```
