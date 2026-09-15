# PocketBase 設定（正式後端 db.keson.pro）

正式前端：https://hk-property.vercel.app/  
正式後端：https://db.keson.pro  

這台 PocketBase 是共用實例。**390 筆財產已在 `hkp_assets`，不可改動、不可重建、不可把資料抄到 `assets`。** 也不可修改共用的 `users`。

## 環境變數

前端只使用：

```env
VITE_POCKETBASE_URL=https://db.keson.pro
VITE_ENABLE_TEST_MODE=false
```

正式站必須是 `VITE_ENABLE_TEST_MODE=false`。只有本機開發可設 `true`。不要把帳號密碼放進 Vercel。

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

規格中的名稱在這台共用庫都加 `hkp_` 前綴，避免碰到其他人的 Collection。舊 Collection 沒有刪除。

## 角色重構後的 Collection

### `hkp_staff_users`（對應 `staff_users`，Auth）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `email` / `password` | Auth | 由 PocketBase 雜湊，前端不存明文 |
| `name` | text，必填 | 2–40 字 |
| `employee_number` | text，必填，唯一 | index `idx_hkp_staff_employee` |
| `role` | select | `admin` 或 `staff` |
| `department` / `phone` | text | |
| `active` / `is_active` | bool | 停用帳號 |
| `last_login_at` | date | 登入時嘗試寫入；規則若拒絕不影響登入 |

沒有 `created_by` relation。目前不能由前端建立另一個 admin（createRule 只允許 `role = staff`）。第一個管理員用本機腳本建立，密碼不進 Git。

API Rules：

```text
listRule: @request.auth.role = "admin" && @request.auth.is_active = true && @request.auth.collectionName = "hkp_staff_users" || id = @request.auth.id
viewRule: 同上
createRule: @request.auth.role = "admin" && @request.auth.is_active = true && @request.auth.collectionName = "hkp_staff_users" && @request.body.role = "staff"
updateRule: @request.auth.role = "admin" && @request.auth.is_active = true && @request.auth.collectionName = "hkp_staff_users" && (@request.body.role:isset = false || @request.body.role = role) && (id != @request.auth.id || @request.body.active:isset = false)
deleteRule: null
```

### `hkp_assets_guest`（公開 View）

只開放：`property_id`、`name`、`location`、`availability_status`、`is_borrowable`、`is_active`、`photo`。不含保管人、單價、備註。

```text
listRule: （空白＝公開讀）
viewRule: （空白＝公開讀）
createRule / updateRule / deleteRule: null
```

### `hkp_borrow_requests`（借用申請）

| 欄位 | 型別 |
| --- | --- |
| `request_number` | text，唯一 index `idx_hkp_borrow_request_number` |
| `borrower_unit` / `borrower_name` / `borrower_phone` | text |
| `asset` | relation → `hkp_assets` |
| `purpose` / `notes` / `checkout_condition` | text |
| `requested_at` / `expected_return_at` | date |
| `status` | select：pending、borrowed、rejected、cancelled、return_pending、returned |
| `public_token_hash` | text。只存雜湊 |
| `privacy_ack` | bool |

```text
listRule / viewRule: @request.auth.role != "" && @request.auth.is_active = true && @request.auth.collectionName = "hkp_staff_users"
createRule: @request.body.status = "pending" && @request.body.public_token_hash != "" && @request.body.privacy_ack = true
updateRule: 經辦登入，或待審取消且 header x-hkp-token 等於雜湊
deleteRule: 僅 hkp_staff_users admin
```

### `hkp_reservations_v2`（預借）

欄位：`reservation_number`（唯一）、`borrower_unit`、`borrower_name`、`borrower_phone`、`asset` → `hkp_assets`、`start_at`、`end_at`、`purpose`、`status`（pending/approved/rejected/cancelled/converted/expired）、`public_token_hash`、`notes`、`privacy_ack`、`rejection_reason`、`reviewed_at`。Rules 與借用申請相同模式：匿名不可 List/View，建立只能 pending。

### `hkp_borrow_records`（正式借出）

`borrow_request`、`asset`、借用人欄位、`borrowed_at`、`expected_return_at`、`returned_at`、`status`（borrowed/return_pending/returned）、`checkout_condition`、`return_condition`、`processed_by` / `returned_by` → `hkp_staff_users`。List/View/Create/Update 僅經辦與管理員。

### `hkp_return_requests`

`borrow_request`、`request_number`、`asset`、`borrower_name`、`borrower_phone`、`condition`、`notes`、`status`（pending/confirmed/rejected）、`requested_at`。List/View/Update 僅經辦。匿名 create 目前只允許 `status = pending`，正式核對應走自訂 Route。

### `hkp_reservation_public` / `hkp_borrow_slots`

公開 View，只有資產 id、時段與狀態，沒有姓名電話。用來擋重疊與雙重借出，不列出借用人。

## 自訂 Route 與 Hook

檔案：`pb_hooks/public_borrow.pb.js`

```text
POST /api/hkp/public/borrow
POST /api/hkp/public/reserve
POST /api/hkp/public/lookup
POST /api/hkp/public/cancel
POST /api/hkp/public/return
```

伺服器用 `$security.sha256` 只存雜湊，查詢失敗一律回「借用資料驗證失敗，請確認借用編號、姓名及電話。」同一 IP 10 分鐘內失敗 8 次後拒絕。

安裝：把正式三個檔放到 PocketBase 主機的 `pb_hooks/`，用 `deploy-pocketbase-hooks.sh` 備份、複製、重啟並健康檢查。細節見 `docs/POCKETBASE_HOOKS_DEPLOY.md`。遠端 `db.keson.pro` 在未部署前 Route 會是 HTTP 404。不要部署 `pb_hooks/main.pb.js`（本機舊集合）。重啟方式依主機而定，腳本預設 `systemctl restart pocketbase`。沒有主機權限就不能安裝。

## 回復

不要刪 `hkp_assets`。新 Collection 是新增的，舊的 `hkp_loan_records`、`hkp_asset_reservations`、`hkp_usage_records` 沒有清空。前端回復用還原 Git 後重新部署。已建立的管理員帳號可停用，不要改財產主檔。

## 主要欄位

### hkp_usage_records

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `asset` | relation → `hkp_assets` | 必填 |
| `user_name` | text | 必填 |
| `user_number` | text | 學號／教職員編號 |
| `user` | relation → `hkp_users` | 使用者，由登入者寫入，不接受前端指定他人 |
| `property_id` | text | 財產編號 |
| `property_name` | text | 財產名稱 |
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

## 名稱對照

使用者提到的一般名稱，在這台共用庫對應如下。不要改去建立未加前綴的 Collection，否則會看不到 390 筆。

| 需求名稱 | 實際 Collection |
| --- | --- |
| users | `hkp_users`（不要改共用 `users`） |
| assets | `hkp_assets` |
| borrow_records | `hkp_loan_records` |
| reservations | `hkp_asset_reservations` |
| usage_records | `hkp_usage_records` |
| inventory_records | `hkp_inventory_audits` |
| location_records | `hkp_location_history` |
| audit_logs | `hkp_operation_logs` |

資料存取層是現有的 JavaScript modules，不是 React `src/services/*.ts`：

- `services/pocketbaseClient.js`
- `services/inventoryService.js`
- `services/loanService.js`
- `services/reservationService.js`
- `services/usageService.js`

正式寫入都經過 `services/hkpApi.js`。測試模式只寫 `sessionStorage`，不會呼叫這些寫入 API。

## 可直接複製的 API Rules

下列規則已套用在 https://db.keson.pro。若後台被改掉，請到 Collection 的 API rules 貼上。`$AUTH`、`$STAFF`、`$ADMIN` 只是說明用縮寫，後台要貼展開後的整段。

```text
AUTH  = @request.auth.id != "" && @request.auth.collectionName = "hkp_users"
STAFF = @request.auth.id != "" && @request.auth.collectionName = "hkp_users" && (@request.auth.role = "staff" || @request.auth.role = "admin")
ADMIN = @request.auth.id != "" && @request.auth.collectionName = "hkp_users" && @request.auth.role = "admin"
```

### hkp_users

- list / view：`ADMIN || @request.auth.id = id`
- create：`@request.body.role = "borrower" || (ADMIN)`
- update：`ADMIN || (@request.auth.id = id && @request.body.role:isset = false && @request.body.is_active:isset = false && @request.body.email:isset = false && @request.body.verified:isset = false)`
- delete：`ADMIN`

未登入不能列出使用者。一般人註冊只能建立 `borrower`。自己不能改角色或停用狀態。管理者才能管理使用者。共用 `users` 不要改。

### hkp_assets

- list / view / create：`STAFF`
- delete：`ADMIN`
- update：

```text
STAFF || (AUTH && (
  @request.body.name:isset = false && @request.body.property_id:isset = false && @request.body.price:isset = false && @request.body.custodian:isset = false && @request.body.supplier:isset = false && @request.body.department:isset = false && @request.body.note:isset = false && @request.body.location:isset = false && @request.body.is_active:isset = false && @request.body.is_borrowable:isset = false && @request.body.photo:isset = false && @request.body.specification:isset = false && @request.body.unit:isset = false && @request.body.brand:isset = false && @request.body.model:isset = false && @request.body.purchase_date:isset = false && @request.body.service_life:isset = false && @request.body.asset_status:isset = false && @request.body.audit_status:isset = false && @request.body.last_audit_at:isset = false && @request.body.return_alert:isset = false && @request.body.usage_count:isset = false && (
    (availability_status = "available" && (@request.body.availability_status = "checked_out" || @request.body.availability_status = "reserved"))
    || (current_loan.borrower = @request.auth.id && (@request.body.availability_status = "available" || @request.body.availability_status = "maintenance" || @request.body.availability_status = "lost"))
  )
))
```

借用人不能改保管人、單價、位置、使用次數。使用次數以 `hkp_usage_counts` 的紀錄筆數為準。

### hkp_loan_records

- list / view：`STAFF || borrower = @request.auth.id`
- create：`(STAFF || (AUTH && @request.body.borrower = @request.auth.id)) && @request.body.asset.availability_status = "available"`
- update：`STAFF || (AUTH && borrower = @request.auth.id && (status = "checked_out" || status = "overdue") && @request.body.status = "returned" && @request.body.borrower:isset = false && @request.body.asset:isset = false && @request.body.loan_number:isset = false && @request.body.approved_by:isset = false && @request.body.approved_at:isset = false && @request.body.purpose:isset = false && @request.body.expected_return_at:isset = false && @request.body.checkout_at:isset = false && @request.body.property_id:isset = false && @request.body.property_name:isset = false && @request.body.borrower_name:isset = false && @request.body.borrower_number:isset = false && @request.body.borrower_department:isset = false)`
- delete：`ADMIN`

借用人只能讀自己的借用，不能把別人設成借用人，也不能自己改成已核准。

### hkp_asset_reservations

- list / view：`STAFF || user = @request.auth.id`
- create：`AUTH && @request.body.user = @request.auth.id && @request.body.status = "pending"`
- update：`STAFF || (AUTH && user = @request.auth.id && status = "pending" && @request.body.status = "cancelled" && @request.body.user:isset = false && @request.body.asset:isset = false && @request.body.purpose:isset = false && @request.body.start_at:isset = false && @request.body.end_at:isset = false && @request.body.approved_by:isset = false && @request.body.approved_at:isset = false && @request.body.reservation_number:isset = false && @request.body.property_id:isset = false && @request.body.property_name:isset = false && @request.body.user_name:isset = false && @request.body.converted_loan:isset = false)`
- delete：`ADMIN`

借用人不能把自己的預借改成 `approved`。這次實測自行核准被拒絕（PocketBase 對不允許的 update 回 404，紀錄仍是 pending）。

時段重疊不能靠單一筆的開始、結束時間做唯一索引。公開預借改寫 `hkp_time_locks`，同一財產的同一小時不可重複；取消或拒絕會把時段改成已釋放，已借出的財產也不能再建立借用申請。舊的 `hkp_reservations_v2` 在新版前端部署前仍接受建立，所以直接打那條舊 API 的重疊還沒關。頻率限制仍要主機上的 Hook。

### hkp_usage_records

- list / view：`STAFF || created_by = @request.auth.id`
- create：`AUTH && @request.body.created_by = @request.auth.id`
- update：`STAFF`
- delete：`ADMIN`

沒有 `usage_count` 欄位，借用人不能改次數。次數來自 `hkp_usage_counts`。

### hkp_inventory_audits、hkp_location_history

- list / view / create / update：`STAFF`
- delete：`ADMIN`

### hkp_operation_logs

- list / view：`STAFF`
- create：`AUTH`
- update：鎖住（`null`，僅 superuser）
- delete：`ADMIN`

一般使用者不能改或刪操作紀錄。

### hkp_assets_public、hkp_usage_counts、hkp_reservation_slots

- list / view：`AUTH`
- create / update / delete：不可寫（view）

## 已套用的 API Rules（摘要）

完整可複製規則見上一節。重點：

- 未登入不能任意讀取財產、借用、預借或使用紀錄。
- 借用人讀 `hkp_assets_public`，看不到保管人、單價、供應商、內部備註。
- 借用人不能改財產管理欄位，也不能寫 `usage_count`。借出／歸還只能改允許的狀態欄位。
- 借用人不能自行核准預借，只能取消自己的 `pending`。
- 經辦只能執行 staff/admin 規則內的操作；管理使用者與系統設定要 admin。
- `hkp_operation_logs` 的 update 鎖住，delete 僅 admin。
- 共用 `users`：**不要改規則**。

對齊腳本（不會改 390 筆財產）：

```powershell
node scripts/align-keson.mjs
node scripts/align-keson-rules.mjs
node scripts/align-keson-round2.mjs
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

- 正式登入用 `hkp-admin@hkproperty.local`、`hkp-staff@hkproperty.local`、`hkp-borrower@hkproperty.local`（密碼在 `.env.local` 的 `HKP_FORMAL_PASSWORD`），不要用本機 PocketBase 的 superuser。
- 不要對 `hkp_assets` 執行匯入覆寫。
- 新版預借寫 `hkp_time_locks`，同一小時重複會被資料庫拒絕。舊集合 `hkp_reservations_v2` 在前端部署前仍可直接建立。頻率限制要等 `pb_hooks/public_borrow.pb.js` 放到主機並重啟。
- 這輪畫面修正尚未部署到 Vercel 前，線上站不會出現新的登出同步與錯誤文字。
