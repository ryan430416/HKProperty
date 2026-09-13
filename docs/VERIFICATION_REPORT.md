# 正式功能驗證報告

驗證時間：2026-09-13  
網站：https://hk-property.vercel.app/  
PocketBase：https://db.keson.pro  
腳本：`scripts/verify-pocketbase.mjs`（不含帳號或密碼）

這次證據來自對 `hkp_*` 的實際讀寫，不是測試模式。未加前綴的 `assets`、`usage_records`、`reservations` 回 404，沒有改去使用它們，以免看不到 390 筆。

帳號角色：借用人、經辦、管理者（`hkp_users`）。密碼只從環境變數讀入，沒有寫進腳本或這份報告。

腳本是直連 PocketBase Collection，不是在瀏覽器點按鈕。畫面上的「登記使用一次」「送出預借」沒有在這次用滑鼠送出。

測試結束後只刪除 `note` 含本次 `E2E-` 識別碼的紀錄。刪除數量：使用 2、預借 2、借出 2。`hkp_assets` 仍是 390。測過的財產位置一直是 `H11400`，最後借用狀態回到 `available`。

## 結果

| 測試項目 | 測試模式 | 正式模式 | 結果 | 證據 | 剩餘限制 |
| --- | --- | --- | --- | --- | --- |
| PocketBase 連線 | 未當成正式結果 | 通過 | 通過 | `/api/health` 200，746ms | 線上站尚未部署這次的平行檢查 |
| 正式登入 | 未使用 | 通過 | 通過 | 借用人、經辦、管理者都登入 `hkp_users` | |
| 財產讀取 | 未使用 | 通過 | 通過 | 借用人讀 `hkp_assets_public`，390 筆，有編號、名稱、位置、借用狀態 | 完整主檔只有經辦／管理者讀 `hkp_assets` |
| QR 深連結 | 未重測 | 未重測 | 未在這次重測 | 先前已能用財編開對財產；這次沒有再開瀏覽器 | |
| QR 相機 | 未測 | 未測 | 需要手機人工驗證 | 程式使用後鏡頭 `getUserMedia`，影片有 `autoplay muted playsinline` | 沒有 Android Chrome 或 iPhone Safari 實體相機測試 |
| 預借新增 | 未使用 | 通過 | 通過 | 寫入 `hkp_asset_reservations`，再讀回 `pending` | 腳本直連，不是點表單 |
| 預借衝突 | 未使用 | 部分通過 | 部分通過 | `hkp_reservation_slots` 查到該筆 `pending`，重疊判斷為真 | API Rule 擋不住繞過畫面直接 POST 第二筆 |
| 預借取消 | 未使用 | 通過 | 通過 | 同一筆再讀為 `cancelled` | 借用人只能取消自己的 `pending` |
| 預借核准 | 未使用 | 通過 | 通過 | 經辦核准為 `approved`；使用次數 2→2，沒有增加 | 借用人自行核准回 404 |
| 現場使用 | 未使用 | 通過 | 通過 | `hkp_usage_records` 建立後用 id 讀回 | 沒有點「登記使用一次」；沒有在管理者畫面點開查詢 |
| 使用次數 | 未使用 | 通過 | 通過 | 現場使用 0→1；借出 1→2；歸還仍是 2。位置與借用狀態沒被現場使用改掉 | 次數來源是 `hkp_usage_counts`，不是前端 +1 |
| 正式借出 | 未使用 | 通過 | 通過 | 狀態改為 `checked_out`，次數 +1。已借出後再開一筆回 400 | 寫完已歸還。沒有點確認借出按鈕 |
| 正式歸還 | 未使用 | 通過 | 通過 | `status=returned`，有 `returned_at`，財產回到 `available`，次數沒再加，借用紀錄還在（稍後只刪本次識別碼） | |
| 預借轉借出 | 未使用 | 通過 | 通過 | 經辦寫入 `converted` 並帶 `converted_loan`；第二筆借出被擋 | 畫面「轉為借出」沒有用瀏覽器點過 |
| 權限隔離 | 未使用 | 通過 | 通過 | 見下方 | PocketBase 無權限時 list 常回 200 空列表，不是 403 |
| 登出清理 | 未重測 | 未重測 | 未在這次重測 | 先前已改成同一個 `appMode`；這次沒有在瀏覽器登出 | 需部署後再用瀏覽器看狀態列 |
| 手機版 | 未測 | 未測 | 需要手機人工驗證 | 既有版面未改風格 | 沒有實機看溢出或 Modal 捲動 |
| Console 錯誤 | 未測 | 未測 | 未在瀏覽器執行 | | 不能報通過 |

## 權限實測

未登入：

- `hkp_users` 列表 total=0。指定一筆使用者或財產 `getOne` 回 404。
- 新增使用、預借、借出回 400 `Failed to create record.`，沒有欄位錯誤，紀錄沒有建立。
- `hkp_inventory_audits` 列表 total=0。

借用人：

- 不能把自己的預借改成 `approved`（404），紀錄仍可取消。
- 不能改 `usage_count` 或位置（404），位置仍是 `H11400`。
- 這次沒有另建別人的借用單來對照列表，只確認規則與自己的寫入。

經辦：

- 可以核准預借。
- 改系統設定回 404。
- 改管理者角色回 404。

管理者：

- 可讀 `hkp_assets` 390 筆，也可讀 `hkp_operation_logs`。
- 這次腳本直連 Collection，沒有產生新的操作紀錄（清理時 logs=0）。程式在預借、借出、現場使用成功後會寫 `hkp_operation_logs`，但這次沒有走畫面路徑，不能算已看到新稽核列。

## 健康檢查速度

同一輪實測：

- health：746ms
- 四個 Collection 依序查：2200ms
- 四個 Collection `Promise.allSettled`：1079ms

`services/backendStatus.js` 已改成先確認 health，再平行檢查必要 Collection。10 秒內不重複打 health。這不是 React StrictMode。這次修改還沒部署，線上站的 5～9 秒還沒被這次改動影響。

## 這次因失敗而改的程式

- 已借出後再開一筆借出，API 原本會成功。已收緊 `hkp_loan_records` create：財產必須是 `available`。再測第二筆回 400。
- 預借轉借出原本沒有寫入路徑。已在 `hkpDirect` 加上 checkout，成功後狀態改 `converted`，並避免同一筆再轉一次。
- 寫入按鈕補上停用與「處理中」。沒有用瀏覽器點擊確認。

## 需要手機人工驗證

- Android Chrome 與 iPhone Safari 相機掃描。
- 拒絕相機權限後改手動輸入。
- 掃描成功、關閉視窗、換頁時相機是否停止。
- 手機版是否水平溢出，Modal 能否捲完。
