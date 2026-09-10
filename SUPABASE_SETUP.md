# 弘光財產系統 Supabase 設定說明

本系統已改為使用 Supabase 同步財產、借用、盤點與圖片。前端只使用 **anon／publishable key**，`service_role` 只能留在本機匯入腳本。

## 1. 建立 Supabase 專案

1. 前往 [https://supabase.com](https://supabase.com) 登入並建立專案。
2. 區域可選靠近台灣的節點。
3. 記下專案名稱，稍後在 SQL Editor 執行 migration。

## 2. 取得 Project URL 與 anon key

1. 開啟專案 → **Project Settings** → **API**。
2. 複製 **Project URL**。
3. 複製 **anon** 或 **publishable** key。
4. **不要複製 service_role**，也不可貼到 GitHub、Vercel 前端或任何公開程式碼。

## 3. 執行 migration

在 Supabase **SQL Editor** 依序執行：

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_rls_policies.sql`
3. `supabase/migrations/003_database_functions.sql`
4. `supabase/migrations/004_seed_settings.sql`

建議每次執行一個檔案，確認沒有錯誤再執行下一個。

選用：`supabase/tests/rls.sql` 可檢查 RLS 是否已啟用。

若使用 Supabase CLI：

```bash
npx supabase db push
```

## 4. 設定 Storage

migration `002` 會嘗試建立公開 bucket `asset-images`（JPG／PNG／WebP，單檔 5MB）。

若 SQL 無法寫入 `storage.buckets`，請手動：

1. Storage → New bucket → 名稱 `asset-images`
2. 設為 **Public**
3. File size limit：`5242880`
4. Allowed MIME：`image/jpeg, image/png, image/webp`
5. 再執行 `002_rls_policies.sql` 中 Storage 政策段落

路徑格式：`assets/{asset_id}/{uuid}.jpg`

上傳僅允許 staff、admin。同名不會覆蓋（`upsert: false`）。

## 5. 本機 `.env`

1. 複製 `.env.example` 為 `.env`（此檔已被 `.gitignore` 忽略）。
2. 填入：

```env
VITE_SUPABASE_URL=你的_Project_URL
VITE_SUPABASE_ANON_KEY=你的_anon_key
```

3. 匯入清冊時另加（只留本機）：

```env
SUPABASE_URL=你的_Project_URL
SUPABASE_SERVICE_ROLE_KEY=你的_service_role_key
```

4. 安裝套件並啟動：

```bash
npm install
npm run dev
```

瀏覽器開啟終端機顯示的本機網址（預設 `http://localhost:5173`）。

若缺少環境變數，頁面會顯示設定錯誤，不會一直轉圈。

## 6. Vercel Environment Variables

1. 匯入 GitHub 專案到 Vercel。
2. Framework 會使用 `vite`，輸出目錄 `dist`。
3. 在 **Settings → Environment Variables** 新增：

| 名稱 | 值 | 環境 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Project URL | Production / Preview / Development |
| `VITE_SUPABASE_ANON_KEY` | anon key | Production / Preview / Development |

4. **不要** 新增 `SUPABASE_SERVICE_ROLE_KEY`。
5. 儲存後重新 **Deploy**。環境變數只在建置時寫進前端 bundle 的 anon 值。

## 7. 匯入 390 筆財產

本機執行（需要 service role，不可在瀏覽器執行）：

```bash
npm run import:assets -- --dry-run
npm run import:assets
```

規則：

- 以 `property_id` 對應
- 不存在則新增
- 已存在則更新主檔欄位
- **不會**覆蓋借用狀態、使用次數、圖片與歷史
- **不會**刪除資料庫既有、但 Excel／JSON 沒有的財產

## 8. 建立第一位 admin

1. 先用網站登入一次（會自動建立 `profiles`，角色為 `borrower`）。
2. 在 Supabase **Authentication** 複製該使用者 UUID。
3. SQL Editor 執行（請自行替換 UUID）：

```sql
update public.profiles
set role = 'admin', is_active = true
where id = '00000000-0000-0000-0000-000000000000';
```

之後即可在「使用者管理」調整其他人角色。請勿把真實姓名或學號寫進程式或 GitHub。

## 9. 測試登入

1. 開啟網站，輸入電子郵件。
2. 按「寄送登入連結」。
3. 到信箱點連結，或把一次性密碼貼回登入頁。
4. Supabase Authentication → Providers 需啟用 Email。
5. 開發時可在 Authentication → Providers → Email 關閉「Confirm email」以利測試，正式環境請再開啟。

新註冊帳號一定是 `borrower`，前端無法自行指定 staff／admin。

## 10. 切換審核與自助借出

管理者登入 → 系統設定 → 借用規則：

| 情境 | 借用需核准 | 允許自助借還 |
| --- | --- | --- |
| 測試 | 關閉 | 開啟 |
| 正式 | 開啟 | 關閉 |

對應欄位：`require_loan_approval`、`allow_self_checkout`。

## 11. 備份資料

1. Supabase → Project Settings → Database → **Backups**（依方案）。
2. 或 Table Editor 匯出 CSV。
3. SQL：

```sql
copy public.assets to stdout with csv header;
```

圖片在 Storage bucket `asset-images`，需一併備份。

## 12. 常見錯誤

| 現象 | 處理 |
| --- | --- |
| 頁面顯示尚未設定雲端資料庫 | 檢查 `.env` 或 Vercel 環境變數名稱是否為 `VITE_` 開頭，並重新建置 |
| `Invalid API key` | 用 anon key，不要用 service_role |
| 登入信沒寄出 | 確認 Email provider、垃圾郵件匣，開發可用 Inbucket／Log |
| 借用人看不到財產 | 先匯入清冊；borrower 讀的是 `assets_basic` |
| 無法上傳圖片 | 確認 bucket 名稱 `asset-images` 與 Storage 政策 |
| 重複借出 | 資料庫有部分唯一索引，同一件財產只能有一筆進行中借用 |
| `relation does not exist` | migration 未依序執行 |
| RLS 拒絕 | 用對應角色測試；borrower 不能改角色或財產狀態 |
| GitHub Pages 仍是舊靜態站 | 請改用 Vercel 建置 `npm run build` |

完成後請用兩個帳號測試：借用人只能看到自己的借用紀錄；管理者可核准、借出、歸還與調整角色。
