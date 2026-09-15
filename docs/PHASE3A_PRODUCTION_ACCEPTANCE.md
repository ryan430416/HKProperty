# 第三階段 3A：正式部署驗收報告

> 狀態：**3A 完成**  
> 未執行 3B（舊 Collections 清理）  
> 時間：2026-09-15（UTC+8）

---

## 1. 部署識別資訊

| 項目 | 值 |
|---|---|
| Feature 分支 | `rebuild-inventory-system` |
| 合併方式 | GitHub PR #1（merge commit，無 force push） |
| 正式部署 commit（main） | `723b141` |
| 上線前 Git tag | `pre-hkp-rebuild-production` → `c956a91` |
| 合併前 Production commit | `c956a91ad051fead71341178c93602f5a9a60087` |
| Production URL | https://hk-property.vercel.app/ |
| 部署時間（約） | 2026-09-15T16:43Z（merge）／Production Ready 約 2 分鐘後 |
| 是否發生回滾 | **否** |

回滾文件：`docs/PHASE3A_ROLLBACK.md`

---

## 2. 正式部署前檢查

| 檢查 | 結果 |
|---|---|
| 分支 `rebuild-inventory-system` | 是 |
| lint | 通過 |
| build | 通過 |
| smoke 13/13 | 通過（指紋計算改為排除已軟刪） |
| Preview acceptance 45/45 | 通過（見 `docs/PREVIEW_ACCEPTANCE.md`） |
| 財產 390 + 指紋 | 通過（清理殘留 `PREVIEW-TMP-*` 後） |
| `.env.service.local` 未追蹤 | 是 |
| 無密碼／token 進 Git | 是 |
| 無 force push | 是 |

---

## 3. Production 環境變數（僅存在性）

| 名稱 | Production |
|---|---|
| `POCKETBASE_URL` | 已存在（本次補齊） |
| `POCKETBASE_SERVICE_EMAIL` | 已存在（本次補齊） |
| `POCKETBASE_SERVICE_PASSWORD` | 已存在（本次補齊） |
| `VITE_POCKETBASE_URL` | 已存在（staff／admin 登入 SDK 仍需要） |

實際值未輸出。服務帳號維持 `role=service`，非 superuser。

`VITE_POCKETBASE_URL`：公開預借已走 `/api/*`；前端保留此變數僅供 PocketBase Auth 登入，不應用於繞過 API 讀敏感 Collections。`.env.example` 僅保留名稱說明。

---

## 4. 操作紀錄 API

新增：`GET /api/admin/operation-logs`

| 驗證 | 結果 |
|---|---|
| 未登入 → 401／unauthorized | PASS |
| staff → 403 forbidden | PASS |
| admin → 200 + items | PASS |
| 分頁／action／日期篩選 | 已實作 |
| 敏感欄位 redaction | 已實作（password／token／hash／phone 等） |
| 管理端頁面改走此 API | PASS（`js/app.js` `renderLogs`） |
| 未開放 PB List Rule 給瀏覽器服務帳號 | 是 |

---

## 5. Deployment Protection 建議（已記錄）

| 環境 | 建議 |
|---|---|
| Preview | 繼續啟用 Vercel Deployment Protection |
| Production 公開端 | **不可**要求 Vercel 登入（預借人需可進） |
| `/admin`、`/staff` | 由 PocketBase Auth 保護 |
| Serverless API | token／role／驗證／rate limit |

取消 Vercel Deployment Protection ≠ 取消系統管理端登入。

---

## 6. Production smoke test 結果

腳本：`scripts/phase3a-prod-smoke.mjs`  
結果：`docs/exports/phase3a/prod-smoke-results.json`  
**23/23 通過**

### 公開端

| 項目 | 結果 |
|---|---|
| 首頁開啟 | PASS |
| 讀取 390 筆 | PASS |
| 搜尋／位置篩選 | PASS |
| 不顯示圖片／個資／內部欄位 | PASS（白名單欄位） |
| 手機橫向跑版 | **未做裝置實機截圖**；列為已知待補視覺檢查 |

### 權限

| 項目 | 結果 |
|---|---|
| 未登入 staff／admin API | PASS |
| staff 登入 | PASS |
| staff 無法新增財產／看操作紀錄 | PASS（403） |
| admin 登入 | PASS |
| admin 操作紀錄 API | PASS |

### 流程（`PROD-SMOKE-TMP-*`）

| 步驟 | 結果 |
|---|---|
| 建立預借 → 核准 → 借出 | PASS |
| usage_count +1 | PASS |
| 歸還申請／確認 | PASS |
| 財產恢復可預借 | PASS |
| 清理測試申請（保留 audit log） | PASS（軟刪臨時財產；關聯阻擋硬刪時保留 soft-delete） |

---

## 7. 財產筆數及指紋（3A 結束）

| 項目 | 值 |
|---|---|
| 公開／有效財產筆數 | **390** |
| 財產編號指紋 | `421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132` |

---

## 8. 已知問題

1. **軟刪測試財產**：`PROD-SMOKE-TMP-*`／曾用的 `PREVIEW-TMP-*` 若仍被 operation log／usage 關聯，可能無法硬刪；已軟刪並自 390／指紋計算排除。可於 3B 前再清孤立 soft-deleted 測試列。  
2. **手機版視覺跑版**：3A smoke 未做實機／瀏覽器視窗截圖驗證。  
3. **`sort=-created`**：部分 PB collections 會 400；列表 API 已避開。  
4. **操作紀錄 PB List Rule**：僅 admin；前端不得直連，已改 API。

---

## 9. 是否建議進入 3B

**建議可進入 3B 規劃，但必須等你明確同意後才執行。**

3A 正式部署與低風險 smoke 已通過，指紋與 390 筆 intact，未回滾。  
3B（刪／停用舊 Collections）仍需：完整備份、匯出、引用搜尋、Production 停用舊路徑確認、rollback migration、**你的明確同意**。

---

## 10. 停止條件（已遵守）

- 未執行 3B  
- 未刪除舊 Collections  
- 未 force push  
- 保留回滾 tag／commit
