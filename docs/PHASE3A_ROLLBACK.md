# Production 回滾備註（3A）

> 建立時機：合併 `rebuild-inventory-system` → `main` 前  
> 禁止 force push；禁止刪除舊 Collections 作為修復手段

## 上線前標記

| 項目 | 值 |
|---|---|
| Feature 分支 | `rebuild-inventory-system` |
| 上線前 Git tag | `pre-hkp-rebuild-production` |
| 合併前 Production（main）commit | `c956a91ad051fead71341178c93602f5a9a60087` |
| Production URL | https://hk-property.vercel.app/ |

## 回滾步驟（若 3A 驗收異常）

1. 立即停止後續變更與 3B。  
2. **不得**刪除舊 Collections、**不得**清空資料。  
3. 在 Vercel 將 Production 部署回滾至 commit `c956a91`（或 tag `pre-hkp-rebuild-production` 對應的合併前 main）。  
4. 記錄錯誤原因至 `docs/PHASE3A_PRODUCTION_ACCEPTANCE.md`。  
5. 修復於 feature 分支完成後再重新走 3A。

## 備註

- PocketBase 資料與 Vercel 部署分離；回滾前端／API 不會自動還原 PB schema。  
- 3A 僅 additive（新 collections／欄位／API）；舊表仍保留至明確核准的 3B。
