# 弘光財產系統 PocketBase 設定說明

本系統已改為使用 **PocketBase** 儲存財產、借用、盤點、使用紀錄與圖片。前端只需要資料庫網址，管理者帳密只留在本機匯入腳本。

## 1. 下載並啟動 PocketBase

1. 到 [PocketBase 發布頁](https://github.com/pocketbase/pocketbase/releases) 下載 Windows 版（建議 0.23 以上）。
2. 把 `pocketbase.exe` 放到本專案根目錄 `d:\HKProperty`（此檔已被 git 忽略）。
3. 在專案根目錄執行：

```powershell
.\pocketbase.exe serve --http=127.0.0.1:8090
```

第一次啟動會建立 `pb_data`。請用瀏覽器開啟 http://127.0.0.1:8090/_/ 建立 **Superuser**（後台管理者）。

專案裡的 `pb_hooks` 必須與執行檔在同一個工作目錄，借用／歸還 API 才會生效。

## 2. 本機 `.env`

複製 `.env.example` 為 `.env`：

```env
VITE_POCKETBASE_URL=http://127.0.0.1:8090

POCKETBASE_ADMIN_EMAIL=你的_superuser信箱
POCKETBASE_ADMIN_PASSWORD=你的_superuser密碼
```

`POCKETBASE_ADMIN_*` 只給本機建立資料表與匯入清冊用，不要提交、不要放到 Vercel 前端。

## 3. 建立資料表

```powershell
npm install
npm run setup:pocketbase
```

這會建立 `users` 額外欄位（角色、學號、單位）以及 `assets`、`loan_records` 等集合。

## 4. 匯入 390 筆財產

```powershell
npm run import:assets -- --dry-run
npm run import:assets
```

- 以 `property_id` 對應
- 不存在則新增
- 已存在則更新主檔欄位
- **不會**覆蓋借用狀態、使用次數、圖片

## 5. 啟動網站

```powershell
npm run dev
```

開啟終端機顯示的網址（預設 http://localhost:5173）。

在登入頁用電子郵件與密碼「註冊借用人帳號」。接著到 PocketBase 後台 → **users** → 把你的帳號 `role` 改成 `admin`。

## 6. 部署注意

- PocketBase 需要一台可長時間執行的主機（VPS、NAS、雲端 VM），不是只把前端放到 GitHub Pages。
- 前端 `VITE_POCKETBASE_URL` 請填 **公開可連到的 PocketBase 網址**（例如 `https://pb.你的網域`）。
- PocketBase 後台 **Settings → Application** 把前端網址加入允許的來源。
- Vercel / 靜態空間只放前端，**不要**把 Superuser 密碼寫進環境變數給瀏覽器。

## 7. 借用規則

管理者登入網站 → 系統設定：

| 情境 | 借用需核准 | 允許自助借還 |
| --- | --- | --- |
| 測試 | 關閉 | 開啟 |
| 正式 | 開啟 | 關閉 |

## 8. 常見錯誤

| 現象 | 處理 |
| --- | --- |
| 尚未設定 PocketBase | 檢查 `.env` 的 `VITE_POCKETBASE_URL` 後重開 `npm run dev` |
| 登入失敗 | 先註冊；密碼至少 8 碼 |
| 借出 API 404 | 確認是在專案根目錄執行 `pocketbase.exe`，`pb_hooks` 有被載入 |
| 無法載入清冊 | 先跑 `npm run setup:pocketbase` 與 `npm run import:assets` |
| 註冊後仍是借用人 | 到 PocketBase 後台把 `role` 改成 `admin` 或 `staff` |
| 圖片上傳失敗 | 僅 JPG／PNG／WebP，5MB 以內，且帳號需為 staff／admin |

舊的 `supabase/` 資料夾僅供對照，新系統不再使用。
