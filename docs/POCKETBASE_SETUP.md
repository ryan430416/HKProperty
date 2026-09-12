# PocketBase 設定（正式後端 db.keson.pro）

正式前端：https://hk-property.vercel.app/  
正式後端：https://db.keson.pro  

這台 PocketBase 是共用實例。**390 筆財產已在 `hkp_assets`，不可改動、不可重建、不可把資料抄到 `assets`。** 也不可修改共用的 `users`。

## 環境變數

前端只使用：

```env
VITE_POCKETBASE_URL=https://db.keson.pro
```

Vercel Production / Preview / Development 都必須是這個網址。正式站不可指向 `localhost`、`127.0.0.1` 或已失效的 Cloudflare 臨時隧道。改完後必須重新 Deploy，Vite 才會把網址寫進前端。

本機腳本另外使用（不可提交、不可放到 Vercel 前端）：

```env
POCKETBASE_URL=https://db.keson.pro
POCKETBASE_ADMIN_EMAIL=
POCKETBASE_ADMIN_PASSWORD=
```

## 實際 Collection（共用庫前綴）

| 用途 | 名稱 | 說明 |
| --- | --- | --- |
| 登入使用者 | `hkp_users` | auth。欄位：`display_name`、`school_number`、`department`、`role`（borrower/staff/admin）、`is_active` |
| 財產主檔 | `hkp_assets` | **390 筆，禁止改資料**。含 `property_id`（唯一）、`custodian`、`price`、`supplier`、`note` |
| 借用人可讀視圖 | `hkp_assets_public` | 只含圖片、名稱、編號、位置、狀態、使用次數等，不含內部欄位 |
| 借用 | `hkp_loan_records` | 正式借出才應 +1 使用次數 |
| 預借 | `hkp_asset_reservations` | 狀態：pending / approved / rejected / cancelled / converted / expired |
| 使用紀錄 | `hkp_usage_records` | 現場使用與借出次數的紀錄來源 |
| 使用次數視圖 | `hkp_usage_counts` | 以紀錄筆數計算，避免前端直接 +1 蓋掉 |
| 盤點 | `hkp_inventory_audits` | 經辦／管理者 |
| 位置異動 | `hkp_location_history` | 經辦／管理者 |
| 操作紀錄 | `hkp_operation_logs` | 經辦／管理者 |
| 系統設定 | `hkp_system_settings` | 核准開關、預設借用天數 |

不要改用未加前綴的 `assets`、`usage_records`。那些名稱在此實例不存在或是空的，前端若連過去會看不到 390 筆。

## 主要欄位

### hkp_usage_records

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `asset` | relation → `hkp_assets` | 必填 |
| `user_name` | text | 必填 |
| `user_number` | text | 學號／教職員編號 |
| `department` | text | 使用單位 |
| `purpose` | text | 必填 |
| `used_at` | date | 必填 |
| `note` | text | 備註（此實例欄位名是 `note`，不是 `notes`） |
| `created_by` | relation → `hkp_users` | 操作者 |
| `created` | autodate | PocketBase 自動 |

### hkp_asset_reservations

| 欄位 | 型別 |
| --- | --- |
| `reservation_number` | text，應唯一 |
| `asset` | relation → `hkp_assets` |
| `user` | relation → `hkp_users` |
| `purpose` | text |
| `start_at` / `end_at` | date |
| `status` | select：pending、approved、rejected、cancelled、converted、expired |
| `approved_by` | relation → `hkp_users` |
| `converted_loan` | relation → `hkp_loan_records` |
| `note` | text |

## 已套用的 API Rules（摘要）

- `hkp_assets` list/view：**僅 staff/admin**。借用人改讀 `hkp_assets_public`，因此無法從列表 API 拿到保管人、單價、供應商、內部備註。
- `hkp_assets` update：**僅 staff/admin**。借用人不能直接改財產主檔。
- `hkp_usage_records` create：已登入的 `hkp_users`。list/view：staff 或 `created_by = 自己`。
- `hkp_asset_reservations` list/view/update：staff 或自己的 `user`。create：已登入使用者。
- `hkp_loan_records` list/view：staff 或 `borrower = 自己`。
- 共用 `users`：**不要改規則**。

對齊腳本（不會改 390 筆財產）：

```powershell
node scripts/align-keson.mjs
node scripts/align-keson-rules.mjs
```

## CORS

`https://db.keson.pro/api/health` 目前回 `Access-Control-Allow-Origin: *`，瀏覽器可連。若日後改成白名單，必須加入：

```text
https://hk-property.vercel.app
http://localhost:5173
```

## 正式登入帳號

已在 `hkp_users` 建立三個測試帳，密碼寫在本機 `.env.local` 的 `HKP_FORMAL_PASSWORD`（勿提交）：

| 角色 | 電子郵件 |
| --- | --- |
| 管理者 | `hkp-admin@hkproperty.local` |
| 經辦 | `hkp-staff@hkproperty.local` |
| 借用人 | `hkp-borrower@hkproperty.local` |

到 https://hk-property.vercel.app/ 展開「使用 PocketBase 正式登入」後使用。這不是本機 `admin@hkproperty.local`。

## 借用人借出

共用庫沒有 `pb_hooks`。已把 `hkp_assets` 的 update 規則收成：

- 經辦／管理者仍可改完整資料
- 借用人只能在「可借用」時改成 `checked_out` 或 `reserved`，或歸還自己目前借出的財產
- 不可改保管人、單價、位置、使用次數等內部欄位
- 使用次數以 `hkp_usage_records` 筆數為準，不由借用人前端 `+1` 覆蓋

## 部署後驗證

1. 開啟 https://hk-property.vercel.app/ ，狀態應為 PocketBase 正式模式，網址含 `db.keson.pro`。
2. 用 `hkp_users` 帳號登入（不是本機 `admin@hkproperty.local`）。角色需為 admin 或 staff 才看得到完整清冊。
3. 登入後財產清冊應為 390 筆。
4. 借用人角色不應看到保管單位、保管人、單價、供應商、內部備註。
5. 現場使用寫入 `hkp_usage_records`；重整後次數來自 `hkp_usage_counts`。
6. 預借寫入 `hkp_asset_reservations`，申請本身不增加使用次數。

## 仍須手動確認

- 正式登入用 `hkp-admin@hkproperty.local`（密碼在 `.env.local`），不要用本機 PocketBase 的 superuser。
- 不要對 `hkp_assets` 執行匯入覆寫。
