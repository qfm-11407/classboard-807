# OneWord 單字擂台｜網頁測試版 v2

**學生開網頁 → 輸入學號 → 手寫一個字 → GAS 存入教師 Drive → AI 背景判讀 → 大螢幕統一揭曉 ✓／✗。** 保留原始筆跡，不顯示 AI 辨識文字或解說。

| 畫面 | 檔案 |
|---|---|
| 首頁、後端連線設定 | index.html |
| 教師出題、控場、計分 | teacher.html |
| 學生學號加入、手寫、送出 | student.html |
| 大螢幕答案牆、排行榜 | screen.html |

採相對網址，可放在 GitHub Pages 根目錄或 `oneword/` 子資料夾，不需 Node.js 常駐，也不用教師電腦 IP。

**先看 [DEPLOY_GAS.md](DEPLOY_GAS.md)**：GAS 必須先部署，並設定 `/exec` 後端網址，才能多人同步與保存圖片。只上傳 GitHub 不會自動建立後端或 AI 額度。

## 最快測試

1. 解壓 `oneword-github-test.zip`，上傳內容到測試儲存庫，啟用 GitHub Pages。
2. 依部署說明建立 GAS，貼上 gas/ 下的三個檔案，執行 setup_、設定 ALLOWED_ORIGINS 並部署。
3. 在 config.js 填入 GAS 網址，或在網站首頁設定連線。
4. 教師以登入碼進入，建立「流程演練」，分享學生網址，測試 Drive 圖片、答案牆、揭曉及計分。
5. 設定自己的 API 金鑰，另建「AI 正式判讀」房間，開始真正筆跡測試。

演練明確標示為模擬，不辨識實際筆跡，不呼叫 AI。真正判讀需自備金鑰與額度，仍可能誤判細微缺筆或潦草字形。

## 資料與測試

圖片保存在教師私人 Drive，API 金鑰保存在 GAS Script Properties；兩者不放在 GitHub。教師頁需保持開啟以處理等待中的判讀。GAS 配額與瀏覽器背景節流會影響即時性，正式使用前需校內實測。

在上層既有專案執行 `npm run test:oneword` 測試，`npm run package:oneword` 產生乾淨上傳包，不需新套件。GAS 與頁面測試使用服務／DOM／訊息替身，不消耗真實 API；不等同於已部署至 Google 或實測平板。

`public/`、server.mjs、ai.mjs、START.cmd 與 tests/ 是上一版本機程式供參考，**不是 GitHub Pages 入口**。scripts/prepare-web.mjs 可從保留介面來源產生雲端頁面，修改時需同步調整產生器。

`github-upload/` 與 ZIP 已排除 `.local/` 本機比賽資料、舊伺服器與測試檔。請勿把本機 `.local/` 上傳公開儲存庫。
