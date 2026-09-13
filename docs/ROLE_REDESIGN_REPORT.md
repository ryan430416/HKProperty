# 角色重構報告

日期：2026-09-13  
後端：https://db.keson.pro  
前端這次改動尚未推上 Vercel。線上 https://hk-property.vercel.app/ 仍是上一版，直到重新部署。

沒有清空或重建 `hkp_assets`。實測筆數仍是 390。沒有改回 Supabase。

## 1. 修改了哪些檔案

- `index.html`：免登入借用首頁、經辦登入、借用管理與經辦人員管理。
- `styles.css`：借用端版面。
- `js/app.js`：路由守衛、登入後依角色進入後台、經辦確認。
- `js/publicPortal.js`：預借、借用、歸還、搜尋、掃描入口。
- `services/authService.js`：改登入 `hkp_staff_users`。
- `services/privacy.js`、`services/publicBorrow.js`：驗證、遮罩、申請。
- `pocketbase/schema.mjs`、`package.json`
- `pb_hooks/public_borrow.pb.js`
- `scripts/setup-roles.mjs`、`scripts/create-first-admin.mjs`、`scripts/verify-roles.mjs`
- `docs/POCKETBASE_SETUP.md`

## 2. 新增了哪些 Collections

都用 `hkp_` 前綴，沒有刪舊表：

- `hkp_staff_users`
- `hkp_assets_guest`
- `hkp_borrow_requests`
- `hkp_reservations_v2`
- `hkp_borrow_records`
- `hkp_return_requests`
- `hkp_reservation_public`
- `hkp_borrow_slots`

`hkp_assets`、`hkp_usage_records` 與既有圖片、編號、位置、使用紀錄都保留。

## 3. 已在 PocketBase 做的設定，以及還要手動做的

已用本機管理者連線寫入規則，沒有改 390 筆內容：

- 公開只能讀 `hkp_assets_guest`。
- 匿名 List/View 借用申請回傳 0 筆或 404。
- 經辦不能建立或改財產名稱。
- 經辦只能看到自己的帳號；管理員才能列出帳號。
- 前端不能把 role 建成 admin。

還要在 PocketBase 主機手動做：

1. 把 `pb_hooks/public_borrow.pb.js` 放到伺服器 `pb_hooks/`。
2. 重啟 PocketBase。
3. 確認 `POST /api/hkp/public/borrow` 不再是 404。

沒有主機權限就不能完成第 1 步。目前實測該 Route 是 404。

## 4. 管理員如何建立第一個經辦人

第一個管理員與一個經辦帳號已用本機 `.env.local` 建立進 `hkp_staff_users`。密碼只在本機，沒有寫進程式、Git 或這份報告。

之後在管理後台「經辦人員管理」建立。畫面是「重設密碼」，會呼叫 PocketBase 寄信，不能查看明文密碼。SMTP 未在這次驗證，所以重設信是否寄出尚未測到。

## 5. 免登入如何避免外洩

- 借用人不登入，也看不到管理選單。
- 公開財產只有圖片、名稱、編號、狀態、位置。
- 申請編號不是流水號。驗證碼 128-bit，畫面只顯示一次。
- 資料庫只存 SHA-256。查詢、取消、歸還要求編號、驗證碼、姓名、電話。
- 匿名不能列出借用紀錄，也不能用已知 id 讀到電話。實測 `getOne` 為 404。
- 錯誤訊息不指出哪一欄錯。
- 電話不進網址、localStorage、Console。清單預設遮罩。查看完整電話會寫操作紀錄，且紀錄不含完整電話。
- 前端沒有 PocketBase 管理 Token。

頻率限制與伺服器端核對要等 Hook 安裝後才生效。安裝前，送出申請會走受限的 Collection create（只能 `pending`、必須有雜湊與個資勾選），查詢與歸還會提示改洽經辦，而不是在瀏覽器比對電話。

## 6. 正式模式實際測試

已執行：

```text
npm install
npm run lint
npm run build
```

結果：lint 通過，vite build 通過。

對 `db.keson.pro` 實測：

| 項目 | 結果 |
| --- | --- |
| `hkp_assets` 筆數 | 390 |
| 匿名讀完整 `hkp_assets` | 0 筆 |
| 匿名讀 `hkp_assets_guest` | 390，欄位無 price、custodian |
| 匿名列出借用申請 | 0 筆 |
| 匿名讀已知借用 id | 404 |
| 匿名只能建立 pending | 已測，測試列已刪除 |
| 經辦可讀該申請 | 已測 |
| 經辦不能新增財產、不能改名稱 | 已測，沒有財產被改名 |
| 管理員登入後角色是 admin 且可讀 390 | 已測 |
| 經辦只能看到 1 個帳號（自己） | 已測 |
| 自訂公開 Route | 404，尚未安裝 |

沒有測到、不能算成功：

- 經辦按下確認借出後使用次數 +1，以及確認歸還後恢復可借用。規則已接上，但沒有對正式財產做這次寫入，以免留下測試使用紀錄。
- 歸還身分核對、取消預借、頻率限制。Route 仍是 404。
- 重設密碼信。
- 手機相機與實機版面。

## 7. 需要手機實機的項目

尚未用實機測。需要再做：

- 360、390、430 寬度的表單、Modal、按鈕是否超出。
- iPhone Safari 與 Android Chrome 的 QR 相機、權限拒絕後改手動輸入。
- 小型螢幕上的借用卡與登入框。

## 8. Vercel 環境變數

```env
VITE_POCKETBASE_URL=https://db.keson.pro
VITE_ENABLE_TEST_MODE=false
```

不要放密碼或 Token。改完必須重新部署。這次前端尚未部署。

## 9. 遷移與回復

沒有把 390 筆抄到新表，也沒有刪舊 Collection。圖片、編號、位置、狀態、使用次數與舊使用紀錄仍在原 Collection。

回復：還原 Git 並重新部署前端。新 Collection 可留著不用。不要刪 `hkp_assets`。測試借用列已刪除。

## 10. 尚未完成的限制

- 公開查詢、取消、歸還與頻率限制要等 Hook 裝上並重啟。
- 安裝前，匿名仍可用受限 create 送出 pending，不能列出資料。
- 經辦確認借出與歸還的正式寫入尚未對線上財產跑完一輪。
- `last_login_at` 可能因更新規則寫不進去。
- 預借沒有 `reviewed_by` relation。
- 至少保留一個管理員，前端有擋；API 沒有完整 Hook。
- 舊 `hkp_users` 登入不再作為進入後台的方式。
