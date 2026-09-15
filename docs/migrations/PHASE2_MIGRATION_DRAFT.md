# Phase 2 Migration Draft（草稿，未執行）

> 狀態：**DRAFT ONLY**  
> 分支：`rebuild-inventory-system`  
> 前置：您已確認 `docs/POCKETBASE_COLLECTION_AUDIT.md` 第 10 節問題  
> 禁止：本檔任何步驟在未獲書面確認前不得對正式庫執行

---

## A. 安全前置（每次執行）

1. 確認分支不是 `main` 的直接推送目標；PR 合併需人工。
2. 重跑只讀匯出：
   - `node scripts/export-phase1-audit.mjs`
   - `node scripts/export-assets-fingerprint.mjs`
3. 比對：
   - `hkp_assets.totalItems === 390`
   - `propertyIdSha256 === 421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132`
4. 匯出將異動集合的 **JSONL 全量備份** 到 `docs/exports/phase2-backup/<stamp>/`（含 schema）。
5. 若 PocketBase Admin 有 Backup 功能：另建一份伺服器端 backup（需您在管理介面操作；無 SSH 時以此為主）。
6. 凍結寫入窗（維護公告）：暫停公開預借與櫃台異動。

**白名單：** 腳本只允許名稱符合 `^hkp_` 的集合；拒絕觸碰其他系統資料。

---

## B. 建議遷移順序（Additive-first）

### Step 0 — 標記 deprecated（不刪）

對舊集合在文件與（可選）Admin 備註標記 `DEPRECATED_PENDING_REMOVAL`，程式改讀新集合但保留舊表。

### Step 1 — 建立新集合（空）

| 新集合 | 說明 |
|---|---|
| `hkp_reservations` | 統一預借→歸還 |
| `hkp_inventory_sessions` | 盤點批次 |
| `hkp_inventory_records` | 盤點明細 |

（若決定原地演進而非新建，Skip 並改「加欄位」方案——需您確認。）

### Step 2 — 擴充 `hkp_assets` 欄位（不刪舊欄）

新增（示例）：

- `current_location`（預設複製 `location`）
- `deleted_at`（軟刪）
- `enabled`（若與 `is_active` 合併策略確定）

**不刪：** `photo` 欄位與檔案。

### Step 3 — 資料複製（目前業務表多為 0，預期快速）

```
hkp_borrow_requests  --\ 
                        +--> hkp_reservations
hkp_time_locks       --/   (依 reservation_number / request_number 分組)

hkp_borrow_records  -------> hkp_usage_records（新欄位模型）
hkp_usage_records(舊列) ---> 同上（若有）

hkp_inventory_audits ------> 建立 session「歷史匯入」+ inventory_records
```

校驗：

- 來源 count == 目標 count（分組後 reservations 數可能 < time_locks 列數）
- 無孤兒 `asset` id
- assets 指紋不變

### Step 4 — 改 API Rules

目標：

- 匿名：**不能** list/view 含個資的 reservations／usage／staff
- 公開讀產：僅 Vercel `/api/public/assets` 或僅 guest view 白名單
- staff／admin：以 `hkp_staff_users` + `role` + `is_active`；**不信任前端 role**
- 寫入：敏感狀態轉換僅允許 Vercel 使用的服務身分（superuser 僅在 serverless，或專用 auth）

### Step 5 — 上線 Vercel Serverless

實作（新建，尚未存在）：

- `/api/public/assets`
- `/api/reservations/create|lookup|cancel`
- `/api/staff/approve|reject|checkout|return`
- `/api/inventory/*`
- `/api/admin/assets/*`
- `/api/admin/staff/*`

規則：rate limit、idempotency key（checkout）、輸入驗證、log 遮罩。

### Step 6 — 前端改接 API

公開端／經辦／管理選單依規格重整；移除圖片 UI；停止直寫 PB 狀態。

### Step 7 — 自動化測試

執行規格第十三節清單 + `npm run lint` + `npm run build` + 契約測試。

### Step 8 — 刪除舊集合（僅在您再次確認後）

條件全部滿足才執行：

1. 備份存在且可還原  
2. 程式／文件／測試不再引用  
3. 筆數對帳通過  
4. 孤兒關聯 = 0  
5. 您明文回覆「同意刪除：&lt;清單&gt;」

建議刪除順序：views → 空業務舊表 → 最後才考慮 `hkp_loan_records`（先清 `current_loan`）。

---

## C. 回滾方式

### C1. 應用層回滾（最快）

1. Vercel 部署回上一版前端（仍讀舊集合）。
2. 若 API 已切新集合：還原環境變數／feature flag `HKP_DATA_VERSION=v1`。

### C2. 資料層回滾

1. 若僅「新增集合／欄位」：刪除**新建的空／遷移目標集合**（不碰 `hkp_assets`），恢復讀舊表。
2. 若已寫入新表：用 `phase2-backup/<stamp>/*.jsonl` 以 upsert 回寫（腳本待第二階段實作）。
3. 若伺服器 backup 存在：於 PocketBase Admin **Restore**（需您操作；注意共用主機上其他系統也會還原——**極高風險**，優先避免全庫還原）。

### C3. 禁止的回滾

- `git push --force`
- 清空 `pb_data`
- 用「刪光再匯入」修復 assets

---

## D. 擬議腳本（第二階段才寫／跑）

| 腳本 | 用途 |
|---|---|
| `scripts/phase2-backup-hkp.mjs` | 匯出 schema + 全 hkp JSONL |
| `scripts/phase2-migrate-reservations.mjs` | dry-run / apply |
| `scripts/phase2-verify-counts.mjs` | 筆數與指紋 |
| `scripts/phase2-rollback-reservations.mjs` | 自 backup 回寫 |

所有腳本預設 `--dry-run`；`--apply` 需環境變數 `HKP_ALLOW_APPLY=YES`。

---

## E. 與理想 Collection 的最終對照（執行後目標態）

| 規格名 | 線上名（建議） | 狀態 |
|---|---|---|
| assets | hkp_assets | keep |
| reservations | hkp_reservations | create |
| usage_records | hkp_usage_records | evolve |
| inventory_sessions | hkp_inventory_sessions | create |
| inventory_records | hkp_inventory_records | create |
| staff_users | hkp_staff_users | keep |
| audit_logs | hkp_operation_logs | keep/rename later |

其餘 hkp_*：deprecated → 您確認後再刪。

---

**本草稿結束。等待確認。**
