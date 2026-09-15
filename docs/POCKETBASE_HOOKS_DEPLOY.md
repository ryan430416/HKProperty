# PocketBase Hooks 正式部署說明（db.keson.pro）

## 已確認的正式站版本

對 https://db.keson.pro 實測：

- `GET /api/health` → 200
- `_superusers` 可登入 → **PocketBase ≥ 0.23**
- 舊版 `POST /api/admins/auth-with-password` → **404**（0.23 起已移除）
- 目前公開 `/api/hkp/public/*` → **404**（主機尚未載入 hooks）

因此正式 hook 依 [PocketBase JSVM ≥ 0.23](https://pocketbase.io/docs/js-overview/) 撰寫：

- 檔名必須是 `*.pb.js`（共用模組用一般 `.js`）
- 路由：`routerAdd(method, path, handler, ...middlewares)`
- App API：`$app.findRecordById`、`$app.runInTransaction`、`$app.save`
- 驗證：`$apis.requireAuth('hkp_staff_users')`
- Handler 內透過 `require(__hooks + '/hkp_shared.js')` 載入共用函式（符合 JSVM isolation）

## 應放入主機的路徑

假設 PocketBase 執行檔與資料在同一根目錄（請依主機實際路徑替換 `PB_ROOT`）：

```text
$PB_ROOT/
  pocketbase                 # 執行檔
  pb_data/                   # 資料（部署腳本絕不動這裡）
  pb_hooks/
    hkp_shared.js            # 共用模組（非 hook 入口）
    public_borrow.pb.js      # 公開借用／預借／查詢／取消／歸還
    staff_borrow.pb.js       # 經辦確認借出／確認歸還／預借審核
```

| 檔案 | 主機路徑 | 用途 |
| --- | --- | --- |
| `hkp_shared.js` | `$PB_ROOT/pb_hooks/hkp_shared.js` | rate limit、雜湊、身分比對、staff 檢查 |
| `public_borrow.pb.js` | `$PB_ROOT/pb_hooks/public_borrow.pb.js` | `/api/hkp/public/*`、`/api/hkp/hooks-health` |
| `staff_borrow.pb.js` | `$PB_ROOT/pb_hooks/staff_borrow.pb.js` | `/api/hkp/staff/*`（需 staff/admin 登入） |

**不要**把 repo 裡的 `pb_hooks/main.pb.js` 部署到 db.keson.pro。  
該檔針對本機未加前綴集合（`assets`、`loan_records`…），不是正式 `hkp_*` 結構。

## 部署前請替換的變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PB_ROOT` | `/opt/pocketbase` | PocketBase 根目錄（含 `pb_hooks`、`pb_data`） |
| `PB_SERVICE` | `pocketbase` | systemd 服務名稱 |
| `SOURCE_HOOKS` | （自動偵測） | 上傳到主機的 `pb_hooks` 目錄絕對路徑 |
| `HEALTH_URL` | `http://127.0.0.1:8090/api/health` | 本機健康檢查 |
| `HOOK_HEALTH_URL` | `http://127.0.0.1:8090/api/hkp/hooks-health` | hook 是否載入 |

## 主機最終指令

1. 把本 repo 的 `pb_hooks/hkp_shared.js`、`public_borrow.pb.js`、`staff_borrow.pb.js` 與 `deploy-pocketbase-hooks.sh` 上傳到主機。
2. 在主機執行：

```bash
chmod +x deploy-pocketbase-hooks.sh

export PB_ROOT=/opt/pocketbase          # ← 改成實際路徑
export PB_SERVICE=pocketbase            # ← 改成實際 systemd 名稱
export SOURCE_HOOKS=/path/to/uploaded/pb_hooks

sudo -E ./deploy-pocketbase-hooks.sh
```

腳本會：

1. 備份現有 `$PB_ROOT/pb_hooks` → `$PB_ROOT/pb_hooks_backup_時間戳`
2. 複製三個正式檔案
3. 檢查檔案存在
4. `systemctl restart $PB_SERVICE`
5. 顯示服務狀態與最近 100 行 journal
6. 檢查 `/api/health` 與 `/api/hkp/hooks-health`
7. 失敗時自動還原備份並再次重啟

腳本**不會**刪除或修改 `pb_data`、collections、財產資料。

## 部署後快速驗證

```bash
curl -sS http://127.0.0.1:8090/api/health
curl -sS http://127.0.0.1:8090/api/hkp/hooks-health
curl -sS -X POST http://127.0.0.1:8090/api/hkp/public/lookup \
  -H 'Content-Type: application/json' \
  -d '{}'
```

預期：

- health → 200
- hooks-health → `{"ok":true,...}`
- lookup 空 body → **不是 404**（多半是 400 驗證失敗訊息）

## 安全設計摘要

- 不寫入任何管理員密碼、token、密鑰
- 日誌只記 requestNumber／assetId／staffId／HTTP status，不記姓名、電話、驗證碼
- 確認借出在 `$app.runInTransaction` 內完成：狀態 → borrow_record → asset checked_out → usage（同一 note 防重）
- 歸還確認只允許 `return_pending → returned`
- 預借審核只允許 `pending → approved|rejected`
- 公開查詢／取消／歸還有 IP 視窗 rate limit（約 10 分鐘 8 次失敗）
