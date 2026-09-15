# 第二階段驗收報告

> 分支：`rebuild-inventory-system`  
> 狀態：**已完成開發／測試準備，未部署正式站、未合併 main、未刪舊表**  
> 時間：2026-09-15

---

## 1. 新增與修改的主要檔案

### 新增
- `shared/reservationStatus.js` — 狀態常數與轉換驗證
- `api/_lib/*` — Serverless 共用（PB、HTTP、security、status）
- `api/public/assets.js`
- `api/reservations/{create,lookup,cancel}.js`
- `api/staff/{reservations,approve,reject,checkout,return}.js`
- `api/inventory/{sessions,records}.js`
- `api/admin/{assets,staff}.js`
- `services/v2Api.js` — 前端呼叫 Vercel API
- `scripts/phase2-*.mjs` — 檢查、schema、服務帳號、規則、遷移、smoke
- `docs/exports/phase2/*` — 對照／檢查輸出
- `docs/migrations/PHASE2_MIGRATION_DRAFT.md`（既有）
- `.env.example` — 僅變數名稱

### 修改
- `js/publicPortal.js`、`index.html` — 公開端精簡＋走 API
- `js/app.js` — 經辦工作台／盤點改新 API
- `pocketbase/schema.mjs` — PB 對照更新
- `services/hkpDirect.js` — 停止寫入 `hkp_loan_records`／舊 time_locks 審核路徑

---

## 2. 新 Collections schema（已建立於正式 PocketBase，空資料）

| Collection | 用途 |
|---|---|
| `hkp_reservations` | 統一預借→歸還 |
| `hkp_inventory_sessions` | 盤點批次 |
| `hkp_inventory_records` | 盤點明細（session+asset 唯一） |

`hkp_assets` 新增欄位（不刪舊欄）：`current_location`、`deleted_at`、`enabled`  
`hkp_staff_users.role` 新增選項：`service`

詳見 `docs/exports/phase2/schema-setup-report.json`。

---

## 3. 舊→新欄位遷移對照

| 舊 | 新 `hkp_reservations` |
|---|---|
| `request_number` / `reservation_number` | `request_no` |
| `public_token_hash` | `verification_hash`（新驗證碼雜湊） |
| `borrower_*` | 同名 |
| `requested_at` / `start_at` | `borrow_date` |
| `expected_return_at` / `end_at` | `expected_return_date` |
| `borrowed` | `checked_out` |
| `return_pending` | `return_requested` |
| `hkp_borrow_records` + usage | checkout 時寫 `hkp_usage_records` |

遷移工具（預設 dry-run）：`node scripts/phase2-migrate-reservations.mjs`

---

## 4. 帳號對照

見 `docs/exports/phase2/HKP_USERS_STAFF_MAP.md`（無密碼／token）。

摘要：staff 2 筆；hkp_users 4 筆（2 筆 email 與 staff 重複勿遷移、1 admin 待你確認、1 borrower 保留不用）。

---

## 5. `current_loan` 檢查

見 `docs/exports/phase2/current-loan-check.json`：

- assets 390
- loan_records 0
- current_loan 非空 0／有效 0／孤兒 0
- 忙碌 availability 0  
→ 第三階段才可清欄位；本階段未刪表。

---

## 6. 已刪六個空 Collections（接受不重建）

| 名稱 | 原用途 | 不重建理由 |
|---|---|---|
| `hkp_reservation_public` | 舊預借公開 view | 0 筆；改由 API／`hkp_reservations` |
| `hkp_reservation_slots` | 舊時段 view | 0 筆；無子表策略 |
| `hkp_reservations_v2` | 舊預借表 | 0 筆；由 `hkp_reservations` 取代 |
| `hkp_asset_reservations` | 更舊預借 | 0 筆；已取代 |
| `hkp_return_requests` | 舊歸還申請 | 0 筆；改 `return_requested` 狀態 |
| `hkp_assets_public` | 公開資產 view | 與 guest 重複；公開改走 Vercel API |

---

## 7. Vercel 環境變數（名稱 only）

- `POCKETBASE_URL`
- `POCKETBASE_SERVICE_EMAIL`
- `POCKETBASE_SERVICE_PASSWORD`

前端可保留：`VITE_POCKETBASE_URL`（僅 staff 登入 SDK，不含服務密碼）

服務帳號已建立：`hkp-service@hkproperty.local`（role=`service`），密碼只在本機 `.env.service.local`（gitignored）。請自行貼到 Vercel Runtime。

---

## 8. API Rules（重點）

- `hkp_reservations`：僅 staff／admin／service 讀寫；匿名不可直連
- `hkp_assets`：service 可讀＋受限更新（availability）；admin 管理核心欄位
- 公開財產僅經 `/api/public/assets` 白名單欄位

完整 dump：重跑 `node scripts/export-phase1-audit.mjs` 或見既有 exports。

---

## 9–10. 角色與流程測試

執行：`node scripts/phase2-smoke.mjs`

涵蓋：狀態機、必填驗證、service 登入、建立／核准路徑資料、usage idem 標記、歸還、390＋指紋。

（HTTP 層需在 Vercel 設定 env 後以 `vercel dev`／預覽環境測端點。）

---

## 11–12. 財產數量與指紋

- 數量：**390**
- 指紋：`421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132`

不一致則停止——本階段驗證通過。

---

## 你需要做的事（才能實際點公開預借）

1. 在 Vercel Project → Settings → Environment Variables 設定上述三個變數（Production／Preview）。
2. **不要**部署到正式 production（本階段禁止）；可用 Preview 自行測。
3. 實際測完後回覆，再進第三階段（舊表清理／正式部署）。

---

**第二階段在此停止。**
