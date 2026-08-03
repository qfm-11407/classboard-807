# 807 班級看板

這是一套供 807 班使用的班級資訊系統，包含學生端看板與教師管理後台。

## 正式網址

- 學生端：<https://classboard-807.qfm1410700.workers.dev/>
- 教師後台：<https://classboard-807.qfm1410700.workers.dev/teacher.html>
- 資料 API：<https://classboard-807-api.qfm1410700.workers.dev/api/classroom>

## 目前架構

| 元件 | 名稱 | 用途 |
| --- | --- | --- |
| 網站 Worker | `classboard-807` | 提供學生端、教師端與聯絡簿畫面。 |
| 資料 API Worker | `classboard-807-api` | 處理教師登入、任務、繳交紀錄與資料同步。 |
| D1 資料庫 | `classboard-807` | 保存名單、座位、課表、午餐、任務、段考與繳交紀錄。 |
| GitHub repository | `qfm-11407/classboard-807` | 保存程式碼並觸發自動部署。 |

## 日常更新方式

將本專案的更新推送到 GitHub 的 `main` 分支後，Cloudflare 會自動部署新版網站。可在 Cloudflare 的 `classboard-807` → **Deployments** 查看進度。

## 第一次設定 Cloudflare

### 1. 建立資料表

在 D1 資料庫 `classboard-807` 的 **Console** 執行：

```sql
CREATE TABLE IF NOT EXISTS classroom_state (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

完整 SQL 位於 `cloudflare/schema.sql`。

### 2. 部署資料 API Worker

將 `cloudflare/worker.js` 的內容部署到 `classboard-807-api`，並於 **Settings → Bindings** 建立 D1 binding：

- Variable name：`DB`
- D1 database：`classboard-807`

### 3. 設定 API 變數與密碼

在 `classboard-807-api` 的 **Settings → Variables and Secrets** 新增：

| 名稱 | 類型 | 用途 |
| --- | --- | --- |
| `ADMIN_USERNAME` | Variable | 教師後台帳號。 |
| `ADMIN_PASSWORD` | Secret | 教師後台密碼。 |
| `SUBMIT_PASSWORD` | Secret | 新增明日事項與科目任務時使用的密碼。 |
| `ALLOWED_ORIGIN` | Variable | `https://classboard-807.qfm1410700.workers.dev` |

請勿將密碼、Token 或任何 Secret 寫入 GitHub。

### 4. 部署網站 Worker

`wrangler.jsonc` 與 `.assetsignore` 已設定為 Cloudflare Workers Static Assets。推送到 GitHub 後，`classboard-807` 會自動部署網站檔案。

若尚未有網站網址，至 `classboard-807` 的 **Domains**（或 **Settings → Domains & Routes**）啟用 `workers.dev`。

## 資料保存與使用方式

- 教師端首次登入後，輸入教師帳號密碼即可管理資料並同步至 D1。
- 學生端可查看課表、座位、午餐、任務與段考資訊。
- 聯絡簿、課程任務與明日事項的資料會儲存在 D1，可跨裝置同步。
- 每日任務會依台北時區於隔日自動處理：明日事項移入今日任務，原今日任務保留於歷史紀錄。

## 專案檔案

| 檔案 | 用途 |
| --- | --- |
| `board.html` | 學生端班級看板。 |
| `teacher.html` | 教師管理後台。 |
| `book.html` | 聯絡簿繳交登記介面。 |
| `cloud-config.js` | 指定學生端與教師端使用的資料 API 網址。 |
| `cloudflare/worker.js` | Cloudflare 資料 API Worker。 |
| `cloudflare/schema.sql` | D1 資料表建立 SQL。 |
| `wrangler.jsonc` | 網站 Worker 的部署與靜態檔案設定。 |

## 舊版 Netlify 檔案

`netlify/`、`netlify.toml` 與 `package.json` 僅保留作為舊版資料與程式參考；正式網站已改用 Cloudflare Workers + D1，不再使用 Netlify 部署或 Netlify Blobs。
