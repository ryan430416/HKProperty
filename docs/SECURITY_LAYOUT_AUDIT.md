# 安全與排版稽核報告

日期：2026-09-15  
網站：https://hk-property.vercel.app/  
PocketBase：https://db.keson.pro  
財產筆數：稽核前後皆為 **390**（未刪除、未覆寫）

## 問題｜嚴重度｜重現方式｜修正方式｜測試結果｜修改檔案

| 問題 | 嚴重度 | 重現方式 | 修正方式 | 測試結果 | 修改檔案 |
| --- | --- | --- | --- | --- | --- |
| 前端仍顯示／上傳財產圖片 | 中 | 清冊、卡片、詳情、公開搜尋、自助列表會請求或顯示 `photo`／placeholder | 全面停用讀寫；改內建 SVG 類別圖示；移除上傳對話框 | 本機 build 無 `placeholder.svg`、無上傳 UI。正式站需部署後再確認網路請求 | `js/app.js` `js/publicPortal.js` `js/selfService.js` `services/inventoryService.js` `services/publicBorrow.js` `services/storageService.js` `services/demoStore.js` `js/format.js` `index.html` `styles.css` |
| 公開 guest 視圖仍可帶出 `photo` 檔名 | 低 | 匿名查 `hkp_assets_guest` 可見 `photo` | 更新 viewQuery，不再 SELECT photo；**未刪** `hkp_assets.photo` 與既有檔案 | 實測 guest keys 無 photo；assets=390 | PocketBase view + `scripts/hide-guest-photo.mjs` |
| Hook 未安裝時舊預借集合可寫入重疊 | 高 | 匿名直接 POST `hkp_reservations_v2` | 前端已改 `hkp_time_locks` 後，關閉匿名 create | 實測匿名建立回失敗；assets=390 | `scripts/close-reservation-bypass.mjs`（已執行） |
| 已借出財產仍可送 pending 借用 | 高 | 把資產改 checked_out 後匿名 create borrow | createRule 要求 `availability_status = available` | 實測 400；恢復後仍 available | PocketBase rule（先前已上） |
| 取消預借只驗證 token | 高 | 錯誤電話仍可取消 | updateRule 加上 name hash + phone | 實測錯誤電話 404 | PocketBase `hkp_time_locks` |
| 公開端圖片文案與 QR／搜尋層級不清 | 中 | 首頁文案提圖片；QR 非主入口 | 四主按鈕 + 搜尋列；登入右上角；文案改無圖片 | 本機 HTML／CSS 已改。正式站未部署本輪前仍舊版 | `index.html` `styles.css` `js/publicPortal.js` |
| 表單僅靠 toast／原生驗證 | 中 | 空白單位／姓名／電話送出 | `novalidate` + 欄位下方錯誤 + 聚焦第一錯欄 + 防連點 | 本機程式已改。實機鍵盤未測 | `js/publicPortal.js` `index.html` |
| CSV 公式注入 | 低 | 匯出欄位以 `=` 開頭 | 匯出前加前導 `'` | 單元邏輯已改。未對正式檔案做 Excel 開啟測試 | `services/loanService.js` |
| 手機清冊仍用桌機表格 | 中 | ≤860px 看清冊 | 既有卡片模式保留；移除圖片欄後重排名稱／財編 | CSS 既有斷點仍生效。360/390/430 **未用實機量測** | `styles.css` `js/app.js` |
| 公開自訂 Route／頻率限制缺失 | 高（殘留） | `POST /api/hkp/public/*` | 無法從此環境安裝 Hook | 實測仍 404。需主機手動安裝 | `pb_hooks/public_borrow.pb.js`（僅 repo） |

## 實際找到的漏洞（摘要）

1. **高**：舊預借 API 通道在新前端上線後仍開著 → 已關閉匿名 `hkp_reservations_v2` create。  
2. **高**：已借出仍可申請／取消只驗 token → 先前與本次規則已補，並再測通過。  
3. **中**：前端圖片讀寫與公開文案 → 本次前端已停用。  
4. **低**：guest 視圖暴露 photo 檔名 → 已從 view 拿掉；底層欄位與檔案保留。  
5. **殘留高**：伺服器頻率限制與自訂 Route 仍缺 Hook。

## 財產圖片狀態

- 前端：**已停止**顯示、上傳、預覽、壓縮、placeholder。  
- 類別圖示：僅內建 SVG（`categoryIcon`）。  
- PocketBase：`hkp_assets.photo` **未刪**；公開 view **不再回傳** photo。  
- 本機 production bundle：未發現 `placeholder.svg` 或上傳 UI 字串。  
- `/api/files/` 字串僅來自 PocketBase JS SDK 內建 files token API，不是財產圖片網址。  
- **正式站尚未部署本輪前**，線上仍可能是舊 bundle；部署後需再抓 Network 確認無 `/api/files/hkp_assets/...`。

## 修改檔案

- `index.html` `styles.css`
- `js/app.js` `js/publicPortal.js` `js/selfService.js` `js/format.js`
- `services/inventoryService.js` `services/publicBorrow.js` `services/storageService.js` `services/demoStore.js` `services/privacy.js` `services/loanService.js`
- `pb_hooks/public_borrow.pb.js`
- `scripts/close-reservation-bypass.mjs` `scripts/hide-guest-photo.mjs` `scripts/security-layout-audit.mjs`
- `docs/SECURITY_LAYOUT_AUDIT.md`

## PocketBase 需手動處理（此環境做不到）

1. 把 `pb_hooks/public_borrow.pb.js` 放到主機 `pb_hooks/` 並重啟 PocketBase（頻率限制與自訂 Route）。  
2. 系統穩定後，若要永久移除圖片欄位：先備份 → 確認無前端／腳本依賴 → 再從 `hkp_assets` 移除 `photo`／`image` 欄位與檔案（**本次未做**）。

## 已在正式 PocketBase 驗證

- 匿名 list 敏感集合為 0 筆（list 規則拒絕常回 200 + 0，不是 403）。  
- 經辦不可建財產、改名、自升 admin。  
- 匿名不可把借用建成 `borrowed`；checked_out 不可再 pending。  
- 舊 `hkp_reservations_v2` 匿名 create 已關閉。  
- 時段鎖重疊拒絕。  
- guest 無 price／custodian／photo。  
- assets = 390。

## 需要手機／瀏覽器實機驗證（未測）

- 360×800、390×844、430×932 無水平溢出  
- Modal + 鍵盤不遮住輸入與底部按鈕  
- 相機 QR  
- 部署後 Console 無未處理錯誤  
- 部署後 Network 無財產圖片請求  

## 日後安全移除圖片欄位（建議步驟）

1. 確認正式前端已上線且 Network 無 `/api/files/hkp_assets/`。  
2. 備份 PocketBase `pb_data`。  
3. Admin UI 或 migration 移除 `hkp_assets` 的 `photo`／`image` 欄位。  
4. 確認 `hkp_assets_guest` view 不引用該欄。  
5. 再跑 `scripts/security-layout-audit.mjs` 與清冊抽樣。
