# 弘光財產系統 PocketBase 設定說明

前端部署在 [https://hk-property.vercel.app/](https://hk-property.vercel.app/)，PocketBase 必須部署在**獨立且具持久化硬碟**的伺服器（不可放在 Vercel Serverless）。

## 重要安全原則

- 前端只使用 `VITE_POCKETBASE_URL`，**不可**寫入 Superuser 帳密或 Token。
- 本機 `.env` 的 `POCKETBASE_ADMIN_*` 僅供匯入腳本，不可提交 GitHub。
- `pb_data/` 不可提交；`pb_migrations/` 與 `pb_hooks/` 必須提交。
- 前端一律以一般使用者身分操作；寫入借用／預借／使用次數走自訂 Route。

## 1. Windows 本機啟動

1. 下載 [PocketBase](https://github.com/pocketbase/pocketbase/releases)（建議 0.23+）。
2. 將 `pocketbase.exe` 放在專案根目錄（已 gitignore）。
3. 在專案根目錄執行：

```powershell
.\pocketbase.exe serve --http=127.0.0.1:8090
```

開啟 http://127.0.0.1:8090/_/ 建立第一個 Superuser。

`pb_hooks` 與 `pb_migrations` 會從此工作目錄載入。

## 2. 環境變數

複製 `.env.example` 為 `.env`：

```env
VITE_POCKETBASE_URL=http://127.0.0.1:8090

POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_ADMIN_EMAIL=你的_superuser信箱
POCKETBASE_ADMIN_PASSWORD=你的_superuser密碼
```

正式環境前端改為：

```env
VITE_POCKETBASE_URL=https://你的-pocketbase網域
```

## 3. 建立資料表

本機／自架：啟動 PocketBase 後會套用 `pb_migrations`。亦可：

```powershell
npm install
npm run setup:pocketbase
```

會建立／更新：`users`、`assets`、`loan_records`、`asset_reservations`、`usage_records`、`inventory_audits`、`location_history`、`operation_logs`、`system_settings`。

**警告：** 不可在已有其他系統 `users` 的共用 PocketBase 上執行（例如先前多專案共用庫）。請使用**專用實例**。

## 4. 匯入 390 筆財產

```powershell
npm run import:assets -- --dry-run
npm run import:assets
```

- 以 `property_id` 對應
- 不存在則新增；已存在則更新主檔
- **不**覆蓋借用狀態、使用次數、圖片、歷史

## 5. 啟動前端

```powershell
npm run dev
```

註冊後預設為借用人；到 PocketBase 後台把角色改成 `admin` 或 `staff`。

測試入口仍可用（假帳號，資料在瀏覽器）。

## 6. Vercel

1. 專案環境變數設定 `VITE_POCKETBASE_URL=https://你的-PB-HTTPS網域`
2. 重新 Deploy（Vite 會把變數編譯進前端）
3. 網站：https://hk-property.vercel.app/

## 7. CORS

PocketBase **Settings → Application → Allowed origins** 加入：

```text
https://hk-property.vercel.app
http://localhost:5173
```

正式環境勿設為 `*`。

## 8. QR Code

內容格式：

```text
https://hk-property.vercel.app/?action=asset&propertyId=財產編號
```

掃描後開啟網站 → 登入（若需要）→ 顯示該財產。掃描本身不計使用次數。

## 9. 持久化與備份

- 將 `pb_data` 放在持久化磁碟／Volume。
- 備份：停止服務後複製整個 `pb_data` 資料夾。
- 還原：換回 `pb_data` 後再啟動。
- **升級 PocketBase 前務必先備份。**
- 不可把 `pb_data` 提交 GitHub。

## 10. 自訂 API

Hooks：`pb_hooks/main.pb.js`

| Route | 用途 |
| --- | --- |
| `POST /api/hkproperty/loans/checkout` | 立即借用（transaction） |
| `POST /api/hkproperty/loans/return` | 歸還 |
| `POST /api/hkproperty/reservations` | 預借 |
| `POST /api/hkproperty/reservations/:id/checkout` | 預借轉借出 |
| `POST /api/hkproperty/usage` | 使用登記（idempotency） |
| `GET /api/hkproperty/dashboard` | 總覽 |

相容舊路徑 `/api/hkp/*` 仍可用。

## 11. 常見問題

| 現象 | 處理 |
| --- | --- |
| 尚未設定 PocketBase | 檢查 `.env` 的 `VITE_POCKETBASE_URL` 後重開 `npm run dev` |
| CORS 錯誤 | 後台允許 Vercel 網域 |
| 借出 API 404 | 確認以專案根目錄啟動 PocketBase，hooks 有載入 |
| 共用庫 users 衝突 | 改用獨立 PocketBase 實例 |
| 圖片上傳失敗 | JPG/PNG/WebP、≤5MB，且為 staff/admin |

舊的 `supabase/` 目錄僅供對照，系統不再使用。
