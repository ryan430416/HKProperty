# PocketBase（HKProperty）

此目錄放置 schema 定義與說明。實際執行時請在**專案根目錄**啟動 PocketBase：

```text
pb_hooks/          ← 自訂 API（根目錄，PB 會自動載入）
pb_migrations/     ← 遷移檔（根目錄，PB 會自動載入）
pocketbase/schema.mjs
```

## 正式站（db.keson.pro）hooks

已確認正式站為 **PocketBase ≥ 0.23**。請只部署：

- `pb_hooks/hkp_shared.js`
- `pb_hooks/public_borrow.pb.js`
- `pb_hooks/staff_borrow.pb.js`

完整步驟、systemd 變數與回滾說明：

- [docs/POCKETBASE_HOOKS_DEPLOY.md](../docs/POCKETBASE_HOOKS_DEPLOY.md)
- 根目錄腳本：`deploy-pocketbase-hooks.sh`

`pb_hooks/main.pb.js` 是本機／舊集合用，**不要**部署到 db.keson.pro。

一般設定請見根目錄 `POCKETBASE_SETUP.md` / `docs/POCKETBASE_SETUP.md`。
