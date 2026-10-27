# OneWord 網頁版部署：GitHub Pages ＋ GAS ＋ Drive

不用教師電腦啟動 Node.js，也不用學生連教師電腦 IP。GitHub Pages 提供網頁；GAS 接收交卷、存圖並呼叫 AI；圖片屬於部署 GAS 的教師帳號。

## 一、上傳 GitHub Pages

解壓 `oneword-github-test.zip`，把裡面的內容上傳到獨立測試儲存庫根目錄。不要只上傳 ZIP 本身。

到 **GitHub 儲存庫 → Settings → Pages → Deploy from a branch**，選發布分支（例如 main），資料夾選 **/(root)**，儲存，等待 GitHub 顯示網站網址。GitHub Free 通常須使用公開儲存庫。

也可以把內容放在目前儲存庫的 `oneword/` 下，再以儲存庫根目錄發布。相對網址支援子資料夾。若使用目前的 `qfm-11407/classboard-807`，預期路徑是 `https://qfm-11407.github.io/classboard-807/oneword/`；這是部署位置範例，不表示已發布。

## 二、建立 GAS 後端

1. 使用要保存圖片的教師 Google 帳號，前往 https://script.google.com/ 建立專案。
2. 貼上 `gas/Code.gs` 全文。
3. 新增 **HTML** 檔，名稱填 `Bridge`，貼上 `gas/Bridge.html` 全文。
4. 在專案設定顯示 appsscript.json，將 `gas/appsscript.json` 貼入。
5. 在 **專案設定 → 指令碼屬性（Script Properties）** 設定：

| 屬性 | 內容 |
|---|---|
| ALLOWED_ORIGINS | 網站來源，例如 `https://qfm-11407.github.io`，不要加儲存庫路徑；多個來源用逗號分隔 |
| TEACHER_PIN | 至少 8 字元的教師登入碼；不設定則由初始化產生 |
| DRIVE_FOLDER_ID | 選填，未公開分享的私人資料夾 ID；不設定則自動建立 |
| OPENAI_API_KEY | 選填，可稍後在教師網頁設定 |
| OPENAI_MODEL | 選填，預設 `gpt-4.1-mini`，須有帳號使用權限 |

6. 在編輯器選擇並執行 `setup_`，首次依 Google 畫面授權 Drive 與外部 API 存取。
7. 執行紀錄會顯示資料夾與教師登入碼；請勿公開到 GitHub。

不需 Google 試算表。每場以私人 JSON 保存狀態與成績，手寫圖片另存 PNG。請勿公開分享 Drive 資料夾。

## 三、部署與連線

1. **部署 → 新增部署作業 → 網頁應用程式**。
2. **執行身分：我**；**誰可以存取：任何人**，讓學生用學號加入，不必授權自己的 Drive。
3. 若校務 Workspace 沒有「任何人」選項，請學校管理員確認可用部署方式；此免登入橋接版不能假設所有網域都允許。
4. 複製正式部署網址 `https://script.google.com/macros/s/部署ID/exec`，不要用 `/dev`。
5. 填入 GitHub 的 `config.js`：

```js
export const config = {
  gasUrl: 'https://script.google.com/macros/s/部署ID/exec',
  pollMs: 3500,
};
```

或先在網頁首頁「連接教室的雲端後端」貼上並測試。教師分享連結會攜帶公開的後端網址，學生不必各自設定。GAS 網址不是 API 金鑰。

6. 網站首頁按「儲存並測試連線」，成功後進教師台輸入教師登入碼。
7. 之後修改 GAS，須到 **管理部署作業 → 編輯 → 新版本 → 更新**；只儲存程式不會更新 `/exec`。

## 四、第一場測試

1. 教師建立「流程演練」房間。**演練不辨識筆跡**：加入順序為 3 的倍數者顯示錯，其餘顯示對；所有畫面均標示演練，API 用量為 0。
2. 複製平板作答網址，學生開啟 `student.html?room=房號`，輸入學號加入。前置 0 保留；同房間防重複學號。
3. 教師開啟大螢幕頁 `screen.html?room=房號`，選題開始。
4. 學生在格內寫一個字，截止前按送出。確認 Drive 的本場／本題資料夾出現以學號命名的 PNG。
5. 截止後展示筆跡，判讀完成後統一揭曉 ✓／✗，測試排名與 CSV。
6. 演練成功後設定 AI 金鑰，再建立「AI 正式判讀」新房間；演練成績不混用。

## 五、運作與限制

- 先存圖再確認交卷；存圖失敗保留筆跡，原平板可重試。圖片摘要與身分權杖避免同一題換答案或重複建檔。
- 學生送出後會嘗試啟動自己的背景判讀；教師頁持續處理其他等待答案。最多同時 1～3 份，預設 2 份。
- **教師控制頁保持開啟，大螢幕建議另開視窗。** 瀏覽器可能暫停長時間背景分頁，影響等待佇列的處理速度。
- 約每 3.5～4.3 秒更新狀態；倒數本機顯示，截止以 GAS 時間為準。本版不是即時推播。
- 截止前不提供筆跡、正解、判定及本題得分。截止後經 GAS 取得圖片資料，不使用公開 Drive 圖片連結。
- 不確定字跡自動再判一次。服務失敗或仍無法確認者可在揭曉前重試；揭曉後顯示「無法判定」，不強行判錯。
- 揭曉、重看及重新整理不會重判已成功答案；失敗請求計費以服務商帳單為準。
- GAS 有每位使用者同時執行、單次執行時間及每日配額限制。30 人集中上傳加上判讀與輪詢可能觸及限制；有短鎖、錯開輪詢與交卷重試，但不保證 30 人無延遲，需校內分批擴測。
- GitHub Pages 與 GAS 仍受帳號方案、服務配額約束；Drive 圖片占用容量，AI API 另計費。不需要為本功能升級 Firebase Storage，但不能視為整套永遠免費。
- 金鑰留在 GAS Script Properties；學生學號、暱稱不傳 AI。學號是參賽識別，不是學籍身分驗證。
- 學生換機或清除瀏覽器資料後不能直接佔用已加入的學號；首版尚無教師換機重綁功能。
- CSV 用 Excel 匯入時，請把學號欄指定為文字，以保留前置 0。

## 六、排除問題

| 現象 | 處理 |
|---|---|
| 尚未設定後端 | 首頁設定，或填入 config.js |
| GAS 連線逾時 | 檢查 /exec 網址、部署存取權限、setup_ 與網路是否允許 Google Apps Script；可在瀏覽器正常開啟部署網址查看 Google 權限提示 |
| 網站未加入 ALLOWED_ORIGINS | 填 `https://帳號.github.io`，不帶 `/儲存庫/oneword/` |
| GAS 修改未生效 | 管理部署作業選新版本並更新 |
| 平板交卷畫面稍慢 | 等待下一次輪詢；不要連點送出 |
| 圖片保存失敗 | 保留原平板筆跡，重試送出 |
| AI 服務失敗 | 確認金鑰、額度、模型權限；揭曉前重試，不能當成答錯 |

## 官方參考

- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/html/communication
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/reference/drive/folder
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
