# PocketBase Collection 稽核報告（第一階段）

> **階段狀態：僅分析，未刪除、未遷移正式資料、未部署、未合併 main**  
> **分支：** `rebuild-inventory-system`  
> **匯出時間：** 2026-09-15T13:51:48.393Z（UTC）  
> **後端：** `https://db.keson.pro`（與其他系統共用，僅 `hkp_*` 屬 HKProperty）  
> **原始匯出：** `docs/exports/phase1-audit/`

---

## 先前已刪且本階段接受不重建的六個空 Collections

| 名稱 | 原用途 | 刪除前筆數 | 不重建理由 |
|---|---|---:|---|
| `hkp_reservation_public` | 舊預借公開 view（無個資） | 0 | 公開流程改 Vercel API + `hkp_reservations` |
| `hkp_reservation_slots` | 舊時段佔用 view | 0 | 不採時段子表 |
| `hkp_reservations_v2` | 舊預借主表 | 0 | 由 `hkp_reservations` 取代 |
| `hkp_asset_reservations` | 更早一層預借 | 0 | 已無程式依賴 |
| `hkp_return_requests` | 獨立歸還申請表 | 0 | 改 reservation 狀態 `return_requested` |
| `hkp_assets_public` | 公開資產 view（與 guest 重複） | view/390 | 公開改 API；guest 暫留至第三階段 |

> 以上刪除發生於本稽核流程之前；資料為空。第二階段起凍結再刪。

---

## 0. 執行摘要

| 項目 | 結果 |
|---|---|
| `hkp_*` Collections | **18** |
| `hkp_assets` 筆數 | **390**（與預期一致） |
| 財產編號指紋 SHA-256 | `421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132` |
| 預借／借出／使用／盤點業務資料 | 目前幾乎全為 **0 筆**（空殼就緒） |
| Vercel Serverless API | **尚未建立**（`api/` 不存在；僅有靜態 Vite 部署） |
| `pb_hooks` | 程式碼在 repo，**正式主機尚未安裝**；規格要求改走 Vercel API |
| 第一階段動作 | 只讀匯出 + 本報告 + migration 草稿 |

---

## 1. 現有網站損壞／衝突（程式與架構）

### 1.1 高優先衝突

| 問題 | 說明 | 影響 |
|---|---|---|
| **流程拆成兩條** | 公開「借用」走 `hkp_borrow_requests`；公開「預借」走 `hkp_time_locks` | 與目標「單一 `reservations` + status」不符 |
| **狀態詞不一致** | 現況：`pending` / `borrowed` / `return_pending` / `returned`；目標：`pending` / `approved` / `checked_out` / `returned` / `overdue`… | 遷移需對照表；前端／規則都要改 |
| **依賴 `pb_hooks`** | `public_borrow.pb.js` / `staff_borrow.pb.js` 假設主機 hooks；規格改為 **Vercel API** | 正式站若直接打 PB，缺 hooks 時安全與冪等不足 |
| **前端直連 PocketBase** | `services/publicBorrow.js` 等用瀏覽器 SDK + 匿名 create | 個資欄位保護主要靠 Rules／View；目標要求公開走 API 白名單 |
| **盤點規則仍綁 `hkp_users`** | `hkp_inventory_audits` / `hkp_location_history` / `hkp_system_settings` List/Create 仍要求 `hkp_users` | 經辦已改登入 `hkp_staff_users` 時，盤點／設定可能 **403** |
| **雙 Auth 並存** | `hkp_staff_users`（正式）+ `hkp_users`（舊，4 筆） | 規則複雜、易誤判角色來源 |
| **無 Vercel API** | `vercel.json` 僅靜態 build | 無法在無 SSH 下安全完成核准／借出冪等 |
| **舊借出路徑仍存活** | `loanService` / `hkpDirect` 仍寫 `hkp_loan_records`（0 筆） | 與新 borrow 流程並存，易雙寫或空操作 |

### 1.2 介面／產品差距（相對本規格）

- 首頁／公開端仍可能混有立即借用、大型表單、圖片相關 CSS／邏輯殘留（需第二階段重整）。
- 經辦選單仍含財產新增／帳號等管理項（規格要求經辦工作台精簡）。
- 盤點缺少「批次 session」模型；現況僅 `hkp_inventory_audits` 單筆結果。
- 公開查詢／取消目前用 token+姓名雜湊；規格要求「申請編號 + 驗證碼」。

### 1.3 先前 Consolidation 警示（必須知情）

在本稽核流程建立**之前**，線上曾刪除 6 個空集合／view（見 `docs/COLLECTION_CONSOLIDATION.md`）：

`hkp_reservation_public`、`hkp_reservation_slots`、`hkp_reservations_v2`、`hkp_asset_reservations`、`hkp_return_requests`、`hkp_assets_public`

- 當時筆數皆為 0（或 view），**未刪 `hkp_assets` 資料**。
- 但不符合本次「先稽核→遷移→人工確認→再刪」流程。
- **第一階段起凍結任何 Collection 刪除**，直到您確認第二階段清單。

---

## 2. 共用主機說明（非 HKProperty）

`db.keson.pro` 另有教學／訂餐等 Collections（例如 `teaching_record`、`timetable_slots`、`orders`…）。**一律不動。**

僅下列屬 HKProperty 範圍：名稱以 `hkp_` 開頭者，以及空殼 `HKProperty`（0 筆，建議 deprecated）。

---

## 3. 現有 `hkp_*` 清單與筆數

| Collection | 類型 | 筆數 | 用途摘要 | 個資 | 建議 |
|---|---|---:|---|---|---|
| `hkp_assets` | base | **390** | 財產主檔 | 低（內部價／保管人） | **保留並演進** |
| `hkp_assets_guest` | view | 390 | 公開白名單欄位 | 無 | **保留**（或改由 Vercel API 取代後 deprecated） |
| `hkp_staff_users` | auth | 2 | 經辦／管理登入 | 中（email／phone） | **保留** → 對應目標 `staff_users` |
| `hkp_users` | auth | 4 | 舊使用者／借用人帳號 | 中 | **deprecated**（確認後遷移或停用） |
| `hkp_borrow_requests` | base | 0 | 公開借用申請＋狀態 | **高** | **合併進目標 reservations** |
| `hkp_borrow_records` | base | 0 | 確認借出後紀錄 | **高** | **合併進 usage_records 或 reservations** |
| `hkp_time_locks` | base | 0 | 預借時段鎖（一小時一列） | **高** | **合併／重設計進 reservations** |
| `hkp_borrow_slots` | view | 0 | 佔用狀態公開視窗 | 無 | 視 API 方案保留或 deprecated |
| `hkp_borrow_verify` | view | 0 | token 驗證視窗 | 雜湊／電話 | 改驗證碼後可能替換 |
| `hkp_lock_public` | view | 0 | 時段佔用公開 | 無 | 隨 time_locks 決策 |
| `hkp_lock_verify` | view | 0 | 預借驗證 | 雜湊／電話 | 同上 |
| `hkp_usage_records` | base | 0 | 使用歷史（舊欄位模型） | 中 | **保留名稱並改 schema** |
| `hkp_usage_counts` | view | 0 | 由 usage 聚合 | 無 | 可改讀 `assets.usage_count` 後 deprecated |
| `hkp_loan_records` | base | 0 | 舊借出主檔；`assets.current_loan` 仍關聯 | **高** | **deprecated**（清關聯後刪） |
| `hkp_inventory_audits` | base | 0 | 單筆盤點結果 | 低 | **拆成 sessions + records** |
| `hkp_location_history` | base | 0 | 位置變更史 | 低 | 可併入盤點／audit 或保留 |
| `hkp_operation_logs` | base | 0 | 操作紀錄 | 低（勿寫電話） | **保留** → `audit_logs` |
| `hkp_system_settings` | base | 1 | 系統設定 | 無 | 保留或併入設定檔 |

完整欄位／Rules JSON：`docs/exports/phase1-audit/collections-full-latest.json`  
摘要 CSV：`docs/exports/phase1-audit/hkp-summary-latest.csv`  
財產編號清單：`docs/exports/phase1-audit/assets-property-ids-latest.txt`

---

## 4. 各 Collection 詳表（精簡）

### 4.1 `hkp_assets`（保留核心）

- **欄位：** `property_id`, `name`, `location`, `availability_status`, `usage_count`, `is_active`, `is_borrowable`, `photo`(暫留檔案), `current_loan`→`hkp_loan_records`, 以及採購／規格／價／保管人等管理欄位。
- **關聯：** `current_loan` → `hkp_loan_records`（目前 0 筆有值）。
- **程式：** `inventoryService`, `publicBorrow`, `hkpDirect`, `loanService`, 匯入腳本。
- **對應目標：** `assets`（建議線上名稱維持 `hkp_assets`，因共用主機前綴約定）。
- **風險：** 任何 truncate／recreate 會毀 390 筆 → **禁止**。

### 4.2 `hkp_borrow_requests` + `hkp_time_locks`（合併候選）

| | borrow_requests | time_locks |
|---|---|---|
| 角色 | 立即借用申請 | 時段預借（多 slot 列） |
| 狀態 | pending / borrowed / return_pending / returned / rejected / cancelled | pending / approved / cancelled / rejected |
| 驗證 | `public_token_hash` + name hash + phone | 同左 |
| 目標 | 併入單一 `hkp_reservations` | 時段衝突改唯一索引或子表 |

### 4.3 `hkp_borrow_records` vs `hkp_usage_records`

- 現況：借出成功寫 `borrow_records`，另可寫 `usage_records`；欄位模型不同。
- 目標：真正借出後只進 `usage_records`，且與 reservation 關聯；`usage_count` 僅 checkout 成功 +1 一次。

### 4.4 `hkp_inventory_audits`

- 現況：無「盤點批次」。
- 目標：`inventory_sessions` + `inventory_records`。
- 規則仍指向 `hkp_users` → 第二階段必須改 `hkp_staff_users`。

### 4.5 Views

| View | 依賴 | 建議 |
|---|---|---|
| `hkp_assets_guest` | assets | 公開目錄；Vercel API 上線後可 deprecated |
| `hkp_borrow_slots` / `hkp_borrow_verify` | borrow_requests | 隨合併調整 |
| `hkp_lock_public` / `hkp_lock_verify` | time_locks | 同上 |
| `hkp_usage_counts` | usage_records | 可 deprecated |

---

## 5. 建議保留／合併／停用／刪除對照

> 命名：共用主機建議**繼續使用 `hkp_` 前綴**；括號內為規格理想名。

| 目標（規格） | 建議線上名稱 | 來源 | 動作 |
|---|---|---|---|
| assets | `hkp_assets` | 現有 | **保留並加欄位**（`enabled`/`deleted_at`/`current_location` 等；`property_id`≡asset_no） |
| staff_users | `hkp_staff_users` | 現有 | **保留** |
| reservations | `hkp_reservations`（**新建**） | borrow_requests + time_locks | **新建→遷移→舊表 deprecated** |
| usage_records | `hkp_usage_records` | 現有 + borrow_records | **改 schema／遷移** |
| inventory_sessions | `hkp_inventory_sessions`（新建） | 無 | **新建** |
| inventory_records | `hkp_inventory_records`（新建）或演進 audits | audits | **新建或改名遷移** |
| audit_logs | `hkp_operation_logs` | 現有 | **保留並規範欄位** |
| （設定） | `hkp_system_settings` | 現有 | 保留 |

### 建議 deprecated（第一階段不刪）

| Collection | 理由 | 刪除風險 |
|---|---|---|
| `hkp_users` | 公開端免登入；後台改 staff_users | 中（4 帳號／舊規則引用） |
| `hkp_loan_records` | 0 筆；由 reservations/usage 取代 | 中（需先移除 `assets.current_loan`） |
| `hkp_borrow_requests` | 遷移後 | 高（若尚有進行中申請）—目前 0 |
| `hkp_borrow_records` | 遷移後 | 同左 |
| `hkp_time_locks` | 遷移後 | 同左 |
| `hkp_inventory_audits` | 遷移到 sessions/records 後 | 低（目前 0） |
| `hkp_location_history` | 可併 audit／盤點 | 低（0） |
| 多數 verify/slots views | API 白名單後 | 低 |
| `HKProperty`（無前綴） | 0 筆空殼 | 低；非 hkp_ 亦勿貿然刪 |

### 第一階段明確禁止刪除

- `hkp_assets` 及其 390 筆、`photo` 檔案欄位（可停用前端顯示，不刪欄位）。
- 任何仍可能被規則／程式引用且未經您確認的 Collection。

---

## 6. 資料遷移對照表（草稿）

### 6.1 財產 `hkp_assets` → 目標 assets 欄位

| 目標欄位 | 來源 | 備註 |
|---|---|---|
| asset_no | `property_id` | 保持唯一；遷移後指紋必須相同 |
| name | `name` | |
| location | `location` | 帳面位置 |
| current_location | 新建，初值=`location` | |
| status | 由 `availability_status` + `asset_status` 對應 | 需確認對照 |
| enabled | `is_active` && `is_borrowable` 策略 | 需您確認語意 |
| usage_count | `usage_count` | 遷移後不可重置 |
| deleted_at | 新建 null | 軟刪 |
| photo | **保留欄位不遷移刪除** | 前端停用 |

### 6.2 申請／預借 → `hkp_reservations`

| 目標 | 來自 borrow_requests | 來自 time_locks |
|---|---|---|
| request_no | `request_number` | `reservation_number`（多列折一） |
| verification_hash | 由新驗證碼雜湊；舊 token 可作相容期 | 同左 |
| borrower_* | 同名欄位 | 同名欄位 |
| asset | asset | asset |
| purpose | purpose | purpose |
| borrow_date / expected_return_date | requested_at / expected_return_at | start_at / end_at |
| status | 見狀態對照 | 見狀態對照 |
| handled_by / timestamps | 由 staff 操作補 | 核准時間等 |

**狀態對照（草案，待您確認）：**

| 現況 | 目標 |
|---|---|
| pending | pending |
| （time_locks）approved | approved |
| borrowed | checked_out |
| return_pending | checked_out（或加子狀態 `return_pending` 欄位） |
| returned | returned |
| rejected | rejected |
| cancelled | cancelled |
| （計算）逾期 | overdue（建議虛擬或排程標記，勿與 returned 互斥錯亂） |

### 6.3 使用紀錄

| 目標 usage_records | 來源 |
|---|---|
| asset / reservation | borrow_records.asset / borrow_request |
| borrower_* | borrow_records |
| checked_out_at / returned_at | borrowed_at / returned_at |
| condition_* | checkout_condition / return_condition |
| handled_by | processed_by / returned_by |

舊 `hkp_usage_records` 若有列（目前 0）一併映射；`loan` 關聯改指向 reservation。

### 6.4 盤點

| 目標 | 來源 |
|---|---|
| inventory_sessions | 新建；歷史 audits 可合成「歷史匯入」批次 |
| inventory_records | `hkp_inventory_audits` 逐筆 |

---

## 7. 可能遺失資料的風險

| 風險 | 等級 | 緩解 |
|---|---|---|
| 誤刪／重建 `hkp_assets` | **致命** | 禁止；遷移前後比對 390 + property_id SHA-256 |
| 清除 `usage_count` | 高 | 只複製不重算覆蓋除非對帳通過 |
| 刪 photo 欄位／檔 | 中 | 第二階段仍只停前端 |
| 合併時漏 time_locks 多 slot | 中 | 以 reservation_number 分組 |
| 改狀態詞弄丟進行中單 | 中 | 目前業務表為 0，窗口佳；上線後需凍結寫入窗 |
| 動到非 hkp_ 集合 | 高 | 腳本白名單 `^hkp_` |
| 無 SSH 卻依賴 hooks | 高 | 第二階段改 Vercel API + 收緊 PB Rules（匿名幾乎不可寫敏感集合） |

---

## 8. API Rules 現況要點

- 匿名可 **create** `hkp_borrow_requests` / `hkp_time_locks`（pending + token hash）→ 第二階段應改為 **僅 Vercel service 帳號／admin token 可寫**，或極窄 create。
- `hkp_assets_guest` 公開 list 空規則＝可匿名讀白名單欄位（符合公開目錄；勿加個資欄）。
- 多個管理集合仍允許 `hkp_users` staff → 與現行登入不一致。
- `hkp_staff_users`：admin 建 staff、禁自改 role → 方向正確，應維持並由 Vercel 再驗一次。

---

## 9. 程式引用地圖（摘要）

| 模組 | 主要 Collections |
|---|---|
| `services/publicBorrow.js` | assets_guest, borrow_*, time_locks, lock_*, usage, logs |
| `services/hkpDirect.js` | assets, loans, time_locks, audits, locations, settings, users |
| `services/reservationService.js` | time_locks |
| `services/loanService.js` | loans, settings, logs |
| `services/inventoryService.js` | assets / guest, usage_counts |
| `services/authService.js` | staff_users, users |
| `services/auditService.js` | audits, locations |
| `pb_hooks/*` | borrow_requests, time_locks, assets, staff_users |
| `api/*` | **尚無** |

---

## 10. 需要您確認的項目（第一階段出口）

請回覆確認後才進入第二階段：

1. **線上名稱是否維持 `hkp_` 前綴**（建議：是）？
2. **`hkp_borrow_requests` + `hkp_time_locks` 是否併成單一 `hkp_reservations`**？時段衝突要「一單一列」還是「子表 slots」？
3. **狀態機**是否採用規格的 `approved` / `checked_out`，並放棄 `borrowed` / `return_pending`？歸還申請是否改為同一單上的旗標？
4. **`hkp_users`（4 帳號）**：保留登入相容、匯出後停用、或刪除？
5. **`hkp_loan_records` + `current_loan`**：確認可在清關聯後 deprecated？
6. **盤點**：新建 sessions/records，舊 `inventory_audits` 僅作歷史匯入來源？
7. **公開財產列表**：第二階段是否強制只走 `/api/public/assets`（前端不再直讀 guest view）？
8. **先前已刪的 6 個空集合**：是否接受現況、不重建？
9. **Vercel 環境變數**：您是否可於 Vercel 設定 `POCKETBASE_URL` + 管理／服務憑證（無 `VITE_` 前綴）？
10. **第二階段是否允許「只新增 Collection／欄位，暫不刪舊表」**（推薦安全路徑）？

---

## 11. 產物清單

| 路徑 | 內容 |
|---|---|
| `docs/POCKETBASE_COLLECTION_AUDIT.md` | 本報告 |
| `docs/migrations/PHASE2_MIGRATION_DRAFT.md` | 遷移與回滾草稿 |
| `docs/exports/phase1-audit/collections-full-latest.json` | 完整 schema + rules |
| `docs/exports/phase1-audit/counts-latest.json` | 全站筆數 |
| `docs/exports/phase1-audit/hkp-summary-latest.csv` | hkp 摘要 |
| `docs/exports/phase1-audit/assets-fingerprint-latest.json` | 390 指紋 |
| `docs/exports/phase1-audit/assets-property-ids-latest.txt` | 財產編號清單 |
| `scripts/export-phase1-audit.mjs` | 可重跑只讀匯出 |

**第一階段在此停止。未取得您的明確確認前，不執行資料刪除、正式遷移、正式部署或合併至 main。**
