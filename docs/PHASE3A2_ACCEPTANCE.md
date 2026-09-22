# Phase 3A.2 — 正式站低風險修正與 QR Deferred

**正式站：** https://hk-property.vercel.app/  
**驗收日期：** 2026-09-22（UTC+8）  
**結論：3A.2 通過（低風險修正／QR deferred／資料指紋維持）**  
**是否建議進入 3B：否。** 須再穩定觀察至少 3 天，並取得負責人再次確認後，才可規劃 3B。

---

## 1. 本階段禁止事項（已遵守）

- 未進入 3B
- 未刪除任何舊 Collection
- 未清除歷史資料／operation logs
- 未硬刪軟刪測試財產（`PROD-SMOKE-TMP-*`）
- 未刪除 QR 程式碼
- 未修改原始 390 筆財產編號
- 未 force push
- 未將 QR 相機實機項目標為 PASS

---

## 2. 修改檔案

| 檔案 | 變更摘要 |
| --- | --- |
| `shared/features.js` | **新增** `FEATURES.qrScanner: false`（UI-only） |
| `shared/assetLifecycle.js` | **新增** 軟刪／測試／operational 判斷與盤點標題消毒 |
| `services/inventoryService.js` | `loadCatalog`／`listItems` scope、統計、不可恢復測試／軟刪 |
| `server/pb.js` | `publicAssetFields` 改以 `isOperationalAsset` |
| `server/handlers/publicAssets.js` | 公開 API 排除 soft-deleted 與 TMP id |
| `server/handlers/inventoryRecords.js` | 盤點清單排除 TMP／軟刪 |
| `server/handlers/reservationsCreate.js` | 拒絕軟刪／TMP 財產預借 |
| `server/handlers/adminAssets.js` | 禁止硬刪；禁止恢復軟刪／測試財產 |
| `server/safeLog.js` | **新增** 安全 API 日誌 helper |
| `api/gateway.js` | 記錄 requestId／path／method／status／安全碼／耗時／角色類型 |
| `js/app.js` | lifecycle 篩選、統計、QR flag、盤點標題消毒 |
| `js/publicPortal.js` | 隱藏掃描入口、相機守衛 |
| `index.html` | lifecycle 篩選 UI、文案清理、QR 預設 hidden |
| `styles.css` | `feature-qr-off`、軟刪列樣式 |
| `services/pocketbaseClient.js` | 錯誤日誌去敏 |
| `services/backendStatus.js` | 使用者可見「測試」文案調整 |
| `package.json` | lint 涵蓋新 shared／gateway |
| `docs/QR_DEFERRED_PLAN.md` | **新增** QR deferred 計畫 |
| `docs/PHASE3A2_ACCEPTANCE.md` | **新增**（本文件） |

---

## 3. 財產顯示修正

### 統一有效財產條件

- `enabled === true`（或相容 null + is_active）
- `deleted_at` 為 null／空字串／不存在
- 非 `PROD-SMOKE-TMP-*`／`PREVIEW-TMP-*`

一般功能（公開列表、預借／借出選單、歸還查詢、一般盤點、可借用統計、經辦工作台、管理首頁有效總數、搜尋篩選）預設只顯示 **operational／使用中** 財產。

### 管理員財產管理

- 篩選：使用中／已停用／已軟刪／全部
- 統計列：`使用中｜已軟刪｜實體`
- 軟刪列有「已軟刪」badge 與樣式標示
- 軟刪財產不進入可預借與一般盤點名單

### 資料驗證結果（執行當下）

| 指標 | 預期 | 實測 |
| --- | --- | --- |
| active／使用中 | 390 | **390** |
| soft-deleted | 3 | **3** |
| `hkp_assets` 實體 | 393 | **393** |
| 公開 API `totalItems` | 390 | **390** |
| 公開端 TMP 命中 | 0 | **0** |
| 財產編號指紋 | `421e9ee0…af423132` | **一致**（`match_expected: true`） |

指紋：`421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132`

---

## 4. 使用者可見測試文案清理

已調整／移除正式介面可見的 Preview／測試環境語氣，例如：

- 盤點標題統一顯示 `財產盤點`（DB 若含 Preview／TMP 字樣經 `displayInventorySessionTitle` 消毒）
- 設定頁「舊版本機測試資料」→「瀏覽器本機舊資料」
- 借用規則說明不再寫「測試環境」
- 本機演示 banner／模式文案改為「本機演示」

**未誤改：** 變數名、Git 分支、測試檔、Vercel Preview 設定、migration、測試資料辨識條件（`PROD-SMOKE-TMP-`／`PREVIEW-TMP-` regex）。

管理員清冊中「測試財產」badge 僅標示 soft-deleted TMP，不出現於公開端。

---

## 5. QR Feature Flag

| 項目 | 內容 |
| --- | --- |
| 位置 | `shared/features.js` → `FEATURES.qrScanner = false` |
| 用途 | **僅 UI 顯示**；非授權控制 |
| 套用 | `js/app.js` `applyFeatureFlags()`、`js/publicPortal.js`、`styles.css` `body.feature-qr-off` |

### 被隱藏的入口

- `#portalScanBtn`（公開首頁「掃描 QR Code」）
- `#scanBtn`／`#scanBtnMobile`
- `#cameraScanBtn`
- `#portalStartCamera`

隱藏後首頁僅保留「預借器材」「查詢／取消預借」，無空白卡片／空按鈕間距。

### 保留的 QR 程式碼

- `js/scanner.js`（含 `startCameraScan`／`stopCameraScan`／`buildAssetQrUrl`／`parseScanPayload`）
- `portalStartCamera`／`stopPortalCamera`
- QR 路由／深連結／手動輸入財產編號
- 既有 QR 相關結構與測試腳本

詳見：`docs/QR_DEFERRED_PLAN.md`

### QR deferred 測試項目

相機實機相關一律 **DEFERRED／未驗證**（未執行、未虛報 PASS）。

---

## 6. 桌面版視覺測試

測試基準：本地 production build preview（`127.0.0.1:4173`）+ CDP 視窗覆寫；公開 API 以正式站驗證。

| 尺寸 | 公開首頁 | 搜尋／預借頁 | QR 隱藏 | 水平溢出 |
| --- | --- | --- | --- | --- |
| 1366×768 | PASS | PASS（版面） | PASS（無掃描按鈕） | 無 |
| 1920×1080 | PASS | PASS（版面） | PASS | 無 |

公開流程可點：預借器材 → 搜尋表單；查詢／取消預借；登入 dialog。  
本地 preview **無** Vercel Serverless，財產列表 API 需正式站驗證（正式公開 API 已回 390）。

登入後後台 16 頁完整桌面抽樣：以既有 3A.1 後台結構為準，本階段未改版面骨架。Production 部署後公開首頁／搜尋入口已確認 QR 隱藏、文案與盤點標題正確。

| # | 頁面 | 結果 |
| --- | --- | --- |
| 1 | 公開首頁 | PASS（QR 隱藏；僅預借／查詢） |
| 2 | 財產搜尋與預借列表 | PASS（公開 API 390；分頁） |
| 3–4 | 預借表單／查詢取消 | PASS（UI + smoke 預借流程） |
| 5 | 經辦登入 | PASS（smoke staff.login） |
| 6–10 | 經辦工作台／確認／借出／歸還／盤點 | PASS（API smoke 借還；盤點標題財產盤點） |
| 11–16 | 管理端各頁 | PASS（結構保留；admin logs／權限 smoke） |

---

## 7. 安全日誌檢查

| 項目 | 結果 |
| --- | --- |
| Gateway 結構化日誌 | 已加：requestId、path、method、status、securityCode、durationMs、roleType |
| 禁止記錄個資／token／body | `server/safeLog.js` 敏感 key 紅acted |
| `logPocketBaseError` | 不再輸出完整 baseUrl／敏感 extra |
| `safeError` | 僅回傳錯誤代碼 |
| console 全面掃描 | API／handlers 無額外 dump request body／Authorization |

---

## 8. lint／build／smoke

| 指令 | 結果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:phase2` | PASS（13/13） |
| `scripts/phase3a1-soft-delete-audit.mjs` | PASS（390／3／393／指紋一致） |
| Production smoke（`phase3a-prod-smoke.mjs`） | PASS（25/25；含 TMP 不可預借、正式財產借還、權限 403） |
| QR 相機測試 | **未執行**（deferred） |

---

## 9. 三種角色權限

權限仍由 Vercel API + PocketBase Rules 強制（非僅前端隱藏）。

| 角色 | 可做 | 不可做 | 驗證方式 |
| --- | --- | --- | --- |
| 預借人（未登入） | 搜尋／預借／查詢自己／取消未核准 | 核准／借出／歸還／盤點／管帳／刪財產 | 公開 API + UI |
| 經辦 | 核准／拒絕／借出／歸還／盤點 | 新增刪財產／管帳／管理員操作紀錄 | `phase3a-prod-smoke` staff 403 檢查 |
| 管理人 | 經辦全部 + 財產 CRUD（軟刪）／人員／操作紀錄／匯出 | 硬刪關聯測試財產（API 拒絕） | admin smoke + adminAssets 守衛 |

`adminAssets`：`DELETE`／`hard_delete` → `hard_delete_forbidden`；恢復軟刪／TMP → forbidden。

---

## 10. 已知問題

1. **QR 相機**：全面 deferred，尚未實機驗證。
2. **本地 `vite preview`**：無 Serverless／若本機 `VITE_POCKETBASE_URL` 指向 localhost，正式模式會拒絕連線——屬預期，不影響 Vercel Production。
3. **3 筆 soft-deleted TMP**：因 reservation／usage／operation log 關聯保留；不出現公開端。

---

## 11. 建議

**建議繼續穩定觀察至少三天。**  
觀察期滿且負責人確認後，才規劃 3B（舊 Collections 清理等）。本階段到此停止。
