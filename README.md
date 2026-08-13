# 807 班級看板（Firebase 版）

本專案使用 Firebase Hosting 發布網站、Cloud Firestore 保存班級資料，並以 Firebase Authentication 保護教師管理頁。

## 網頁

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

學生端資料為公開可讀。聯絡簿繳交與課程完成小卡可公開登記，但規則僅容許建立限定欄位的紀錄；班級名單、座位、課表、午餐、打掃、值日生與任務設定均只能由教師帳號修改。

## 舊 Netlify 資料

Netlify 與 Firebase 是不同資料庫。首次切換時，請先保留舊網站資料，並在 Firebase 教師端逐項儲存名單與設定；Firebase 不會自動讀取 Netlify Blobs 中的既有資料。
