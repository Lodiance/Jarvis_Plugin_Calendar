# HANDOFF — calendar

> 這份檔案只描述「當下狀態」,每次 /handoff 覆寫。已完成的事看 git log,
> 未來規劃看 spec,設計決策看 spec/decisions/。

## 狀態：進行中（等 Jarvis 主程式）
calendar v0.3（plugin 規格 0.4）已完成並 push，測試全過。在 nas 上試裝過一次，之後已經完整移除，nas 現在是乾淨的。
接下來卡在 Jarvis：三份需求文件都已經同步過去，由使用者帶到 Jarvis repo 處理：安裝精靈的問題、移除機制、服務一鍵部署（plugin 規格 0.5）。

## 改到哪
- 程式碼沒有進行到一半的改動，工作區乾淨。
- vault 的 spec 副本還沒同步（`/wiki-sync-check`，使用者手動複製）；Wiki 的 Jarvis 頁面也還停在 0.3。

## 刻意留的洞（不是 bug,別急著修）
- manifest 還沒有 `services.caldav`：要等 Jarvis 的 0.5 定案（`decisions/0002`），不要先照提案寫。
- 0.3 新元件（`adaptive`、`agenda.bars/allday/strike`、`calendar.items/selected`、`grid` 比例、`dialog: "wide"`）還沒用。
- `calendar.create` 不附 `examples`（spec §10），否則 check 會真的新增行程。
- 不能把行程搬到別的行事曆；重複行程只讀。

## 當前假設（未驗證）
- 畫面沒在主程式驗證過；Radicale 的 `UID` `prop-filter`、iPhone 對 UTC 時間的顯示只對假伺服器測過。
- nas 上 `network: true` 的容器能透過 `jarvis-services` 連到 Radicale（nas 上還沒有 Radicale）。

## 下次第一件事
等 Jarvis 那邊修好安裝精靈、做完移除機制和規格 0.5 的服務部署之後：
1. 照 Jarvis 的 `plugin-spec.md` 0.5，在 manifest 加上 `services.caldav`，`spec` 升到 0.5，並重新複製 kit。
2. 在 nas 用精靈從零安裝 calendar，在「服務」那一步部署 Radicale，照 Jarvis 那三份文件的驗收步驟，以及 calendar-spec §12 的 v0.3 項目測試。
