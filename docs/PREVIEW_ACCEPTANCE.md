# Preview 驗收報告（第二階段）

> 分支：`rebuild-inventory-system`  
> 狀態：**僅 Preview，未合併 main、未部署 Production、未刪舊 Collections**  
> 時間：2026-09-15  
> 建議進入第三階段：**是（API／流程驗收 45/45 通過）**

---

## 1. 部署前檢查

| 項目 | 結果 |
|---|---|
| 目前分支 | `rebuild-inventory-system` |
| `.env.service.local` 已由 `.gitignore` 排除 | 是（規則：`.env.*.local`） |
| Git 未追蹤密碼／token／`.env.service.local` | 是（僅追蹤 `.env.example`） |
| 專案內無真實服務帳號密碼硬編碼 | 是（憑證僅本機 ignored 檔） |
| lint | 通過（`npm run lint`） |
| typecheck | 專案無 `typecheck` script（略） |
| build | 通過（`npm run build`） |
| smoke | 通過（`npm run test:phase2` → 13/13） |
| push 目標 | 僅 `origin/rebuild-inventory-system` |
| 未 push／合併 main | 是 |
| 未部署 Production | 是 |

### Preview 環境變數（僅確認「存在」，不輸出值）

| 名稱 | Preview |
|---|---|
| `VITE_POCKETBASE_URL` | 存在 |
| `POCKETBASE_URL` | 存在 |
| `POCKETBASE_SERVICE_EMAIL` | 存在 |
| `POCKETBASE_SERVICE_PASSWORD` | 存在 |

---

## 2. Preview 網址與部署 log

| 項目 | 內容 |
|---|---|
| 最新 Ready Preview | https://hk-property-mw6kksk2b-ryan-s-projectsaa.vercel.app |
| 分支別名 | https://hk-property-git-rebuild-inventory-system-ryan-s-projectsaa.vercel.app |
| 部署狀態 | Ready（成功） |
| 部署 log 錯誤 | 早期多次在「Deploying outputs…」失敗（nested `/api/**` serverless 包裝）；改為單一 `api/gateway.js` + rewrite 後成功。成功部署 log **無**應用錯誤；**未**在 log／回覆中輸出環境變數值 |
| Deployment Protection | 已啟用；驗收以 `vercel curl`（官方 bypass）執行 API 測試 |

---

## 3. 各項測試結果

驗收腳本：`scripts/preview-acceptance.mjs`  
結果檔：`docs/exports/phase2/preview-acceptance-results.json`  
**通過 45／失敗 0**

### 公開端

| 測試 | 結果 |
|---|---|
| 財產總數 390 | PASS |
| 搜尋財編／名稱 | PASS |
| 位置篩選 | PASS |
| 預借表單必填驗證 | PASS（`unit_required` 等） |
| 成功建立 pending 預借 | PASS |
| 查詢自己的預借 | PASS |
| 錯誤驗證碼不能取得資料 | PASS（`not_found`） |
| 尚未核准前可以取消 | PASS |
| 不顯示財產圖片 | PASS（公開白名單無 photo） |
| 不洩漏姓名、電話、驗證碼或內部欄位 | PASS |

### 經辦端

| 測試 | 結果 |
|---|---|
| staff 可以登入 | PASS |
| 核准／拒絕預借 | PASS |
| 確認借出 | PASS |
| 借出時 usage 僅 +1（`usage_count`） | PASS |
| 申請及確認歸還 | PASS |
| 建立盤點批次及盤點財產 | PASS |
| 不可新增財產 | PASS（`forbidden`） |
| 不可管理帳號 | PASS（admin API → `forbidden`） |

### 管理端

| 測試 | 結果 |
|---|---|
| admin 可以登入 | PASS |
| 新增／編輯／停用測試財產 | PASS |
| 管理經辦人（列表） | PASS |
| 盤點 | PASS |
| 操作紀錄 | PASS（經新增財產 side-effect；直接 list 受 PB 規則限制） |
| 刪除需二次確認（reason） | PASS（無 reason → `reason_required`） |
| 測試資料安全清理且不動原 390 筆 | PASS |

### 安全測試

| 測試 | 結果 |
|---|---|
| 未登入無法呼叫 staff／admin API | PASS |
| staff 呼叫 admin API → 403 | PASS |
| Network／回覆不出現服務帳號密碼 | PASS（未輸出） |
| 前端 bundle 不含服務帳號憑證 | PASS |
| API 錯誤不顯示 stack trace | PASS |
| 重複點擊借出只產生一次紀錄 | PASS（idempotent + usage_count 不變） |
| 同一財產不能同時借給兩人 | PASS（`asset_unavailable`） |

---

## 4. 失敗項目

無（本輪 45/45）。

---

## 5. 新增的測試資料（已清理）

| 類型 | 說明 |
|---|---|
| 預借 | 約 3 筆 Preview 測試 reservation（主流程／取消／拒絕／衝突等） |
| 盤點 | 測試 session／record |
| 財產 | `PREVIEW-TMP-*` 臨時財產（軟刪後硬刪清理） |

清理：驗收腳本以服務帳號刪除測試 reservation／inventory／`PREVIEW-TMP-*` 財產，並將受測資產可用性恢復。

---

## 6. 財產筆數及指紋（清理後）

| 項目 | 值 |
|---|---|
| 財產筆數 | **390** |
| 財產編號指紋 SHA-256 | `421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132` |

---

## 7. Preview 期間修復（摘要）

1. 將 nested serverless handlers 收斂為單一 `api/gateway.js`，解決 Deploying outputs 失敗。  
2. 補齊 Preview Runtime：`POCKETBASE_URL`／服務帳號 Email／Password。  
3. Phase-2 `enabled` 欄位預設 false → 以 `scripts/phase2-repair-enabled.mjs` 將既有 active 財產設回 `enabled=true`（不改 `property_id`）。  
4. `deleted_at == ""` 誤判為已刪除 → 修正 `publicAssetFields`。  
5. 公開 `available=1` filter 括號修正。  
6. staff／admin 列表避免 `sort=-created`（此 PB 集合會 400）。

---

## 8. 是否建議進入第三階段

**建議進入第三階段。**

條件已滿足：Preview Ready、公開／經辦／管理／安全主流程通過、390 筆與指紋不變、測試資料已清理。  
第三階段前請再確認：Production 環境變數、Deployment Protection 策略、以及操作紀錄 collection 的 list 規則是否要對 admin 開放（目前 create side-effect 正常）。

---

## 9. 停止條件（已遵守）

- 未刪除舊 Collections  
- 未合併 main  
- 未部署 Production  
