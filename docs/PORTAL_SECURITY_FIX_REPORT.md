# 公開端介面與安全修正報告

日期：2026-09-15  
財產筆數：390（未刪除、未改財編）

## 介面修正

1. 「我要預借」進入選財產頁，標題為「選擇要預借的財產」，卡片只顯示「預借」。
2. 「我要借用」進入選財產頁，標題為「選擇要借用的財產」，卡片只顯示「借用」。
3. 首頁底部大型「取消預借」表單已移除。
4. 首頁新增次要按鈕「查詢／取消申請」，獨立頁面處理查詢與取消。
5. 財產列表有 skeleton／「財產資料載入中」、失敗時錯誤訊息與「重新載入」、無資料才顯示空狀態。
6. 篩選：名稱／財編、位置、可借用狀態、結果總數、分頁、清除篩選。
7. QR 改為獨立頁：按按鈕才開相機、可關閉相機、可手動輸入財編。
8. 歸還／預借／借用表單皆要求單位、姓名、電話。

## 發現並修正的安全問題

| 問題 | 嚴重度 | 處理 |
| --- | --- | --- |
| staff 可把 `returned` 改回 `return_pending` | 高 | 收緊 `hkp_borrow_requests` updateRule 狀態轉換 |
| 公開取消表單一直掛在首頁 | 中 | 移到獨立查詢頁 |
| 預借／借用按鈕混在同一列表 | 中 | 依入口模式只顯示對應按鈕 |
| 伺服器 Hook／rate limit 仍缺失 | 高（殘留） | 前端查詢／取消加入 10 分鐘內 8 次失敗暫緩；正式限流仍需主機 Hook |

## 修改檔案

- `index.html` `styles.css` `js/publicPortal.js`
- `services/publicBorrow.js`
- `scripts/fix-borrow-transitions.mjs` `scripts/verify-portal-permissions.mjs` `scripts/verify-guest-list.mjs` `scripts/dump-api-rules.mjs`
- `docs/POCKETBASE_API_RULES.json` `docs/PORTAL_SECURITY_FIX_REPORT.md`

## PocketBase API Rules

完整快照見 `docs/POCKETBASE_API_RULES.json`。重點：

- `hkp_assets_guest`：公開只讀白名單欄位（無 photo、price、custodian、個資）。
- `hkp_borrow_requests`：匿名只能 create `pending` 且資產須 `available`；update 僅允許合法狀態轉換或驗證碼身份操作。
- `hkp_time_locks`：唯一時段鎖；取消需 token+姓名雜湊+電話。
- `hkp_staff_users`：僅 admin 可建 staff；不可自改 role／自停用。
- `hkp_reservations_v2`：匿名 create 已關閉。

## 測試結果（正式 db.keson.pro）

- `npm run lint`：通過
- `npm run build`：通過
- guest 列表：390 筆、無 photo／price、分頁正常
- 匿名無法讀完整資產／帳號／使用紀錄
- staff 無法建財產、無法建帳號
- 已借出不可再 pending
- 已 returned 不可再開成 return_pending（404）
- assets 維持 390

## 尚未能自動完成（需人工）

1. 將 `pb_hooks/public_borrow.pb.js` 放到 PocketBase 主機並重啟（伺服器 rate limit 與自訂 Route）。
2. 手機實機：360／390／430 橫向溢出、相機權限、鍵盤遮擋。
3. 部署本輪前端到 Vercel 後再查 Network／Console。
4. 日後若要永久刪除 `hkp_assets.photo` 欄位與檔案，需先備份再手動移除（本次未刪）。
