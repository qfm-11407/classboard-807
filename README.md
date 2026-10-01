# 807 班級看板（Firebase 版）

本專案使用 Firebase Hosting 發布網站、Cloud Firestore 保存班級資料，並以 Firebase Authentication 保護教師管理頁。

## 網頁

主要網址：https://qfmclass-807.web.app/

教師端：https://qfmclass-807.web.app/teacher.html

原網址 https://colabprogram-c8014.web.app/ 保留；兩個網址沿用同一個 Firebase 專案、資料庫與教師帳號，不需搬移資料。新網址首次使用需重新登入，手機桌面捷徑也可從新網址重新加入。

- `board.html`：學生端班級看板。
- `teacher.html`：教師管理後台。
- `book.html`：聯絡簿繳交登記。

## 教師登入

教師端只需輸入校內帳號前段與密碼，系統會自動補上 `@qfm.kh.edu.tw`。資料庫規則僅允許此網域的已登入帳號修改班級設定、建立課程任務與新增明日事項。

## Firebase 發布前設定

1. 在 Firebase 專案 `colabprogram-c8014` 啟用 **Authentication → 電子郵件／密碼**。
2. 建立教師帳號，例如 `teacher807@qfm.kh.edu.tw`。
3. 在 **Firestore Database → Rules** 貼上 `firestore.rules` 的內容並發布。
4. 使用 Firebase Hosting 發布此資料夾；`firebase.json` 已指定根目錄與 Firestore 規則。

`.firebaserc` 定義 `classboard`（新網址）與 `legacy`（原網址）兩個發布目標；一般 `firebase deploy --only hosting` 會同步發布兩站。若修改資料庫規則，使用 `firebase deploy --only hosting,firestore:rules`。兩站應保持相同網頁內容，避免舊網址留在較舊版本。

學生端資料為公開可讀。聯絡簿繳交與課程完成小卡可公開登記，但規則僅容許建立限定欄位的紀錄；班級名單、座位、課表、午餐、打掃、值日生與任務設定均只能由教師帳號修改。

## 教師資料還原點

登入教師端後，右上角「還原點」（手機為 ↶）可查看備份、手動命名建立或還原。

- 啟用後第一次登入建立初始還原點；每次成功修改雲端設定前自動備份，合計保留最近 30 個，超過時取代最舊備份。
- 可選「事項與請假紀錄」或「全部教師設定」。還原前會再備份目前資料，因此可還原回去。
- 還原時清除座位表的暫時缺席旗標，避免歷史旗標重新計入今日請假；歷史請假紀錄仍依選定範圍還原。
- 學生留言、個別繳交／完成紀錄、舊學生端登記事項及帳號密碼另行保存，不在此備份範圍內。
- 備份從啟用後開始累積，無法補回啟用前已遺失的資料。

儲存時只合併有修改的設定，並在交易中核對最新雲端內容。同一份資料若被其他電腦修改，會停止儲存並保留本機草稿；請先「下載本機資料」再「重新載入雲端」。本機下載檔含班級個資，請妥善保管。新規則會阻擋舊版頁面的覆寫，所有教師裝置發布後需重新開啟頁面。

測試：`node scripts/test-restore-points.mjs`。發布需同步部署 Hosting 與 Firestore 規則。

## 舊 Netlify 資料

Netlify 與 Firebase 是不同資料庫。首次切換時，請先保留舊網站資料，並在 Firebase 教師端逐項儲存名單與設定；Firebase 不會自動讀取 Netlify Blobs 中的既有資料。
