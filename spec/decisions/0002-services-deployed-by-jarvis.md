# 0002 — Radicale 這類服務由 Jarvis 的服務目錄一鍵部署，生命週期和 plugin 分開

日期：2026-11-19　狀態：提案（等 Jarvis 定案，需求文件已移到 Jarvis repo）
取代：0001 裡「使用者在服務自己的 compose 加入 `jarvis-services`」那一段。0001 其餘部分（共用網路 `jarvis-services`、`network: true` 自動接上）照舊。

## 問題

照 0001，裝 calendar 之前，使用者要自己部署 Radicale、手動加入網路，再把網址、帳號、密碼抄進 `#/dev/plugins`。
這不是一鍵安裝。2026-11-18 第一次在 nas 用精靈裝 calendar 時，才發現 nas 上根本還沒有 Radicale。

## 決定

- Jarvis 內建一份**服務目錄**（先只有 Radicale），每個服務是 Jarvis repo 裡固定的範本，映像檔用 digest 釘死。
- plugin 在 manifest 宣告需要的**能力**（`services.caldav`），並把能力的輸出（`url`、`user`、`password`）對應到自己的祕密名稱；不指定映像檔。
- 安裝精靈多一步「服務」：用已經部署的服務、現在部署，或自己填。前兩種由安裝器把祕密填好。
- 服務有自己的頁面和生命週期：移除 plugin 不會動到服務；還有 plugin 在用時，服務不能移除。

## 不採用

- **Radicale 跟著 calendar 一起裝、一起移除**：行程是使用者的資料，iPhone 也直接用它；徹底刪除 plugin 會連行程一起刪掉。服務也可能有好幾個用戶端。
- **plugin 在 manifest 裡附上自己的 compose 或映像檔**：任何 plugin（包括之後 market 上別人寫的）都能在 nas 上跑任意容器，等於繞過 plugin 容器的唯讀、拿掉權限、不能碰 Docker 這些限制。
- **維持 0001（使用者自己部署）**：能用，但不是一鍵；每加一個需要服務的 plugin，使用者都要自己會寫 compose。

## 代價

- 主程式要多管一類東西（服務），還要多一個頁面、多幾張資料表；plugin 規格升 0.5（manifest 多一個選填欄位）。
- 服務目錄要跟著 Jarvis 改版維護（映像檔更新）。
- `tailscale serve` 和整機備份還是要使用者在 nas 主機上手動做：安裝器在容器裡，碰不到也不該碰主機設定。
- 為了給 iPhone 用，服務要在 nas 的 loopback 開一個端口，和 0001「服務不需要開端口到 nas 本機」不同。plugin 仍然走 `jarvis-services`。
