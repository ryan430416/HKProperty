# QR Code 掃描功能 — Deferred 計畫

**狀態：`deferred`（暫緩）**  
**正式站：https://hk-property.vercel.app/**  
**日期：2026-09-22**

本文件記錄 QR 相機掃描暫緩原因、程式碼保留位置、feature flag，以及未來重新啟用與驗收清單。  
相機尚未實機測試的項目一律標記 **`DEFERRED／未驗證`**，不得標為 PASS。

---

## 1. 目前狀態

| 項目 | 狀態 |
| --- | --- |
| Feature flag `FEATURES.qrScanner` | `false` |
| 正式站相機掃描入口 | 隱藏（不請求相機權限） |
| 手動輸入財產編號 | 維持可用 |
| QR 程式碼／路由／解析 | **保留，未刪除** |
| 手機相機實機驗收 | **未執行** |

---

## 2. 延後原因

1. Phase 3A.2 優先完成低風險修正（財產軟刪顯示、文案清理、安全日誌）。
2. 相機權限在 iPhone Safari／Android Chrome 需實機驗收，暫不納入本階段範圍。
3. 主要預借、確認、借出、歸還、盤點流程可完全以搜尋／手動輸入財產編號完成，不依賴 QR。

---

## 3. Feature flag 位置

```js
// shared/features.js
export const FEATURES = Object.freeze({
  qrScanner: false
});
```

**注意：** 此 flag **只控制 UI 顯示**，不得作為安全權限控制。即使前端重新顯示 QR 按鈕，也不能因此取得管理權限。  
不得為此新增包含秘密資訊的公開環境變數。

相關套用：

- `js/app.js` → `applyFeatureFlags()`、`openScan()`、`cameraScanBtn` 守衛
- `js/publicPortal.js` → 隱藏 `portalScanBtn`、守衛 `startPortalCamera`
- `styles.css` → `body.feature-qr-off` 隱藏掃描入口，避免空白間距

---

## 4. 保留的 QR 程式碼位置

| 功能 | 位置 |
| --- | --- |
| 掃描元件／相機 | `js/scanner.js`（`startCameraScan`、`stopCameraScan`、`parseScanPayload`、`buildAssetQrUrl`、`readAssetDeepLink`） |
| 公開入口 | `js/publicPortal.js`（`startPortalCamera`、`stopPortalCamera`、手動輸入表單） |
| 經辦掃描 dialog | `js/app.js`（`openScan`、`lookupScan`、`cameraScanBtn`） |
| HTML 結構 | `index.html`（`#portalScanBtn`、`#scanDialog`、`#portalCamera*`、手動輸入） |
| Feature flag | `shared/features.js` |
| 既有 QR 相關測試 | 專案既有 smoke／腳本（未刪除） |

---

## 5. 正式站被隱藏的入口

- 公開首頁「掃描 QR Code」按鈕（`#portalScanBtn`）
- 側欄／行動頂欄掃描按鈕（`#scanBtn`、`#scanBtnMobile`）
- 掃描 dialog 內「啟用相機掃描」（`#cameraScanBtn`）
- 公開掃描步驟「開啟相機掃描」（`#portalStartCamera`）

隱藏後版面應維持兩欄預借／查詢按鈕，不留下空白卡片或不自然間距。

---

## 6. 暫緩期間替代流程

使用者仍可：

- 搜尋財產編號／名稱
- 查看可預借狀態
- 手動選擇財產並提交預借
- 查詢／取消預借

經辦／管理人仍可手動輸入財產編號進行借出、歸還、盤點。

---

## 7. 未來重新啟用方式

1. 將 `shared/features.js` 的 `qrScanner` 改為 `true`。
2. 部署後確認公開／經辦入口重新顯示。
3. 依下方驗收清單完成手機實機測試後，才可將項目改為 PASS。
4. **不要**用公開環境變數存放秘密；flag 維持原始碼常數或伺服器端非密設定即可。

---

## 8. 驗收清單（相機相關）

| 項目 | 狀態 |
| --- | --- |
| iPhone Safari 相機測試 | DEFERRED／未驗證 |
| Android Chrome 相機測試 | DEFERRED／未驗證 |
| 允許相機權限 | DEFERRED／未驗證 |
| 拒絕相機權限（應可改手動輸入） | DEFERRED／未驗證 |
| 關閉 modal 後停止 camera stream | DEFERRED／未驗證 |
| HTTPS 相機權限 | DEFERRED／未驗證 |
| 鏡頭切換（後鏡頭優先） | DEFERRED／未驗證 |
| QR 無法辨識的替代流程（手動輸入） | 程式保留；相機路徑 DEFERRED／未驗證 |
| QR 內容安全性（僅解析 propertyId／深連結） | 程式保留；實機 DEFERRED／未驗證 |
| 掃描後導向財產 | 程式保留；實機 DEFERRED／未驗證 |
| 長時間掃描的資源釋放 | DEFERRED／未驗證 |
| 手機 safe-area 與鍵盤測試（掃描 UI） | DEFERRED／未驗證 |

---

## 9. 明確禁止

- 不得刪除 QR 掃描元件與相關 helper
- 不得將未實機項目標為 PASS
- 不得以 QR flag 作為授權依據
- 不得在本階段進入 3B 或刪除歷史資料
