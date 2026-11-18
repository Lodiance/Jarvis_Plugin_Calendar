# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中
calendar v0.3 已升到 plugin 規格 0.4（kit 0.4、manifest 加 `setup`、`setup(secrets)` 測連線），31 個測試和 `plugin:check` 都通過（0 錯誤）。**還沒 commit**，也還沒在 nas 用安裝精靈實裝。

## 改到哪
- 程式碼沒有進行到一半的改動；未 commit 的是整批 0.4 升級。
- vault 的 spec 副本還沒同步（`/wiki-sync-check`，使用者手動複製）。Wiki 的 Jarvis 頁面也還停在 0.3。

## 刻意留的洞（不是 bug,別急著修）
- 0.3 新元件（`adaptive`、`agenda.bars/allday/strike`、`calendar.items/selected`、`grid` 比例、`dialog: "wide"`）還沒用。
- `calendar.create` 不附 `examples`（spec §10），否則 check 會真的新增行程。
- 不能把行程搬到別的行事曆；重複行程只讀。

## 真的壞掉的（是 bug）
- Jarvis 的 `plugin:check` 在 Windows 結束時印出 libuv 的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`。檢查結果正常，問題在主程式那邊。

## 當前假設（未驗證）
- 主程式的 kit 和 checker 已經是 0.4，但 `plugin:check` 說「主程式只支援到 0.3」：推測主程式宣告支援的版本還沒改，安裝精靈也未必已經部署到 nas。
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale。

## 要回 Jarvis repo 處理
- 主程式支援的 spec 版本還是 0.3（見上一段），和 `plugin-spec.md` 0.4 對不上。
- 上面那個 `plugin:check` 的 libuv 斷言。

## 下次第一件事
1. Commit 並 push 這批 0.4 升級。
2. 確認 nas 上的主程式已經有安裝精靈和 `jarvis-installer`。有的話，在 `#/dev/plugins` 貼 repo 網址，從零裝起，測「測試連線」的欄位提示，以及新增、修改、刪除和 `412`。沒有的話，先回 Jarvis repo 處理。
