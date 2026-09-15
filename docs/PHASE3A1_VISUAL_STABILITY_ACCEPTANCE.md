# Phase 3A.1 — Production 視覺、實機與穩定性驗收

**正式站：** https://hk-property.vercel.app/  
**驗收日期：** 2026-09-16（UTC+8）  
**結論：3A.1 條件性通過（視覺／權限／軟刪／API 煙測通過；相機實機與 ≥3 天穩定觀察仍待人工）**  
**是否建議進入 3B：否。** 須再穩定觀察至少 3 天，並取得負責人再次確認後，才可開始舊 Collections 清理。

---

## 1. 本階段禁止事項（已遵守）

- 未刪除任何舊 Collection  
- 未清除歷史資料／operation logs  
- 未解除關聯以硬刪測試財產  
- 未修改原始 390 筆財產編號  
- 未 force push  
- 未大幅重寫已通過後端流程（僅修正前端 boot 用的 PB sort，以及 CSS）

---

## 2. 關鍵缺陷與修正（Production 已部署）

| 問題 | 影響 | 修正 | PR |
| --- | --- | --- | --- |
| `pocketbase/schema.mjs` 僅 re-export `RESERVATION_STATUSES`，`COLLECTIONS` 引用未綁定 | **整站前端模組載入失敗**，公開按鈕無反應 | 改為本地 import + export | [#3](https://github.com/ryan430416/HKProperty/pull/3) |
| 多個 `sort=-created`（timeLocks／settings／locations／staffUsers 等）在共享 PB 回 400 | 經辦／管理員登入後 **loadError「資料格式錯誤」**，後台空白 | 移除失效 sort | [#4](https://github.com/ryan430416/HKProperty/pull/4) |
| 手機 topbar `flex-wrap: nowrap` + 過多控件 | 標題寬度被壓成 0、文字擠壓；body 水平溢出 | topbar wrap、標題 ellipsis、隱藏 `.user-meta`、輸入 16px | [#4](https://github.com/ryan430416/HKProperty/pull/4) |

修正檔案：

- `pocketbase/schema.mjs`
- `services/reservationService.js`
- `services/loanService.js`
- `services/auditService.js`
- `services/authService.js`
- `services/hkpDirect.js`
- `services/publicBorrow.js`
- `styles.css`

---

## 3. 各尺寸視覺結果

測試方式：Cursor 內建瀏覽器 + CDP `Emulation.setDeviceMetricsOverride`，對公開頁與登入後後台做 overflow 量測（非僅靠 `overflow-x: hidden` 掩蓋）。

| 尺寸 | 公開首頁 | 搜尋／預借 | 掃描 | 查詢／取消 | 經辦後台（抽樣） | body 水平溢出 |
| --- | --- | --- | --- | --- | --- | --- |
| 375 × 667 | PASS | PASS | PASS | PASS | PASS（修正後） | 無 |
| 390 × 844 | PASS | （同公開流程） | — | — | — | 無 |
| 412 × 915 | PASS | — | — | — | — | 無 |
| 768 × 1024 | PASS | — | — | — | — | 無 |
| 1366 × 768 | 部分（CDP 切換不穩；桌面 CSS 已涵蓋） | — | — | — | — | 預期無 |

### 375 後台頁面（管理員登入後量測）

| 頁面 | 結果 |
| --- | --- |
| 系統總覽 | PASS（無 loadError） |
| 經辦工作台／預借確認 | PASS |
| 盤點 | PASS |
| 財產管理 | PASS（手機改卡片列表） |
| 操作紀錄 | PASS |
| 經辦人員管理 | PASS |
| 資料匯出／設定 | PASS |

公開可點流程（修正後）：首頁 → 預借列表（共 390 筆）→ 預借表單 → 掃描（含手動輸入）→ 查詢／取消 → 登入 dialog。

---

## 4. 截圖路徑

目錄：`docs/exports/phase3a1/screenshots/`

代表性檔案：

- `375x667-01-public-home.png` — 公開首頁  
- `375x667-05-scan-or-manage.png` — 登入 dialog／管理步驟  
- `page-2026-09-15T17-29-19-193Z.png` — 財產搜尋載入／骨架  
- `page-2026-09-15T17-31-35-501Z.png` — **修正前** 管理員 topbar 崩潰（對照）  
- `page-2026-09-15T17-38-45-673Z.png` — **修正後** 管理員系統總覽  
- `page-2026-09-15T17-42-19-709Z.png` — 經辦工作台（角色受限導覽）  
- `page-2026-09-15T17-45-44-546Z.png` — 390 寬公開首頁  
- `page-2026-09-15T17-46-31-339Z.png` — 768 寬公開首頁  

完整清單以該目錄為準（含 CDP 過程截圖）。

---

## 5. 發現的跑版／問題

1. **P0（已修）：** Production JS `RESERVATION_STATUSES is not defined` → 前端未初始化。  
2. **P0（已修）：** 管理員／經辦 boot 因 `-created` sort 400 → 無法載入清冊。  
3. **P1（已修）：** 手機 topbar 擠壓／水平溢出。  
4. **P2（觀察，未阻斷 3A.1）：** 後台 `loadCatalog` 仍會載入軟刪列，toast／清冊可能顯示 392–393；**公開 API 與指紋仍為 390**。建議後續讓後台統計區分 active／soft-deleted，但不得為此硬刪。  
5. **盤點 UI 文案**仍可見「Preview管理盤點」字樣（文案殘留，非功能阻斷）。

---

## 6. QR Code

| 項目 | 結果 |
| --- | --- |
| 僅使用者點「開啟相機掃描」才請求權限 | 程式碼確認 PASS（`portalStartCamera`） |
| 拒絕權限清楚提示 | 程式碼確認 PASS；**實機：需人工手機測試** |
| 可手動輸入財產編號 | PASS（自動化） |
| 關閉掃描介面停止 camera stream | 程式碼確認 PASS（`stopPortalCamera`／dialog close）；**實機：需人工** |
| HTTPS Production 可要權限 | **需人工手機測試** |
| 掃描後僅公開財產資料 | 公開 API whitelist 煙測 PASS |
| QR 內容不含姓名／電話／驗證碼／token／服務帳號 | PASS（`buildAssetQrUrl` 僅 `action` + `propertyId`） |

**標記：相機相關項目 = 需人工手機測試（不得虛報 PASS）。**

---

## 7. 介面角色

### 預借人（未登入公開端）

可見：預借器材、掃描 QR、查詢／取消預借。  
不可見：盤點、新增／刪除財產、使用者管理、全部借用人資料。  
**PASS**

### 經辦人（Production 實登）

導覽僅：`經辦工作台`、`財產盤點`。  
不可見：系統總覽、財產管理、操作紀錄、經辦人員管理、資料匯出／設定。  
**PASS**

### 管理人（Production 實登）

可見：經辦功能 + 系統總覽、財產管理、操作紀錄、經辦人員管理、資料匯出／設定。  
**PASS**

### API 權限（`scripts/phase3a-prod-smoke.mjs`）

- 未授權 staff／admin → 擋下  
- staff 不可 create asset、不可讀 admin operation-logs（403）  
- admin 可讀 operation-logs  
**23/23 PASS**

---

## 8. 測試軟刪財產統計

資料來源：`docs/exports/phase3a1/soft-delete-audit.json`（煙測後重跑）

### 總覽

| 指標 | 數值 |
| --- | --- |
| assets 實體總筆數 | **393** |
| active（未軟刪） | **390** |
| soft-deleted | **3** |
| `PREVIEW-TMP-*` | **0**（先前已清理） |
| 公開 API `TMP` 命中 | **0** |
| 計入有效 390／指紋 | **否（已排除）** |

### `PROD-SMOKE-TMP-*` 明細

| property_id | enabled | deleted_at | usage | reservation | operation log | 公開 API | 計入 390 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PROD-SMOKE-TMP-90736450 | false | 有 | 1 | 0 | 1 | 否 | 否 |
| PROD-SMOKE-TMP-90948691 | false | 有 | 1 | 1 | 1 | 否 | 否 |
| PROD-SMOKE-TMP-93871461 | false | 有 | 1 | 1 | 1 | 否 | 否 |

處理原則：已軟刪且不出現在公開端 → **保留**；不得刪 log／解除有效關聯／恢復為可預借。

### 財產編號指紋

- **條件：** active（`deleted_at` 空或 null）之 `property_id`，升冪排序後以 `\n` 連接，SHA-256  
- **值：** `421e9ee0b22544a47ecf3ec0be3beeb7d0b73f97accf026e3f5e8c14af423132`  
- **與預期相符：** 是  

---

## 9. Production log 摘要

- `vercel logs` 對正式部署多為「waiting for new logs…」／近 48h 無穩定可匯出 runtime 串流（與先前 3A 觀察一致）。  
- 煙測期間未再現 gateway 5xx；公開／權限路徑行為正常。  
- **未在報告輸出**密碼、token、完整電話、驗證碼、服務帳號內容。  
- 未發現個資外洩證據；若後續觀察到 5xx／資料錯亂／外洩風險，**立即停止，不得進入 3B**。

---

## 10. 重測結果

| 項目 | 結果 |
| --- | --- |
| lint | PASS |
| build | PASS（bundle 無 bare `RESERVATION_STATUSES`） |
| Production smoke | **23/23 PASS** |
| 權限測試 | PASS（含於 smoke） |
| 公開 390 + 指紋 | PASS |

---

## 11. 手機人工測試待辦

1. iPhone Safari：相機權限允許／拒絕、關閉掃描後鏡頭指示燈熄滅。  
2. Android Chrome：同上。  
3. 鍵盤彈起後預借表單仍可捲動並送出。  
4. safe-area（瀏海／底部 Home 指示條）與 sticky 送出鈕。  
5. 長財產名稱／長位置於實機卡片與 modal。  
6. 連續使用 3 天：登入過期提示、偶發 4xx／5xx、rate limit 是否誤擋。  

---

## 12. 是否建議進入 3B

**否。**

理由：

1. 負責人已明示不同意立即刪舊 Collections。  
2. 剛修復兩項 Production P0，需至少 **穩定觀察 3 天**。  
3. 軟刪 TMP 因關聯仍保留（符合原則），不應為「清乾淨」而硬刪或拆 log。  
4. 相機實機項目尚未人工簽核。  

取得再次確認後，再另開 3B 清理計畫。
