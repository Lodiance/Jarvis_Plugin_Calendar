# 給 Jarvis repo：服務（service）一鍵部署需求

來源：calendar plugin repo，2026-11-19。這是需求提案，給 Jarvis repo 設計和實作用，定案後寫進 `plugin-spec.md` 和 ADR。
決策理由見 calendar repo 的 `spec/decisions/0002-services-deployed-by-jarvis.md`（它取代 0001 裡「服務由使用者自己部署」那一段）。

## 1. 問題

calendar 要先有 Radicale 才能用。照 0001 的做法，使用者得自己寫 compose、部署 Radicale、手動加入 `jarvis-services`，
再把網址、帳號、密碼抄進 `#/dev/plugins`。這樣算不上一鍵安裝。

但也**不能**讓 Radicale 跟著 plugin 一起裝、一起移除：
- 行程是使用者的資料，iPhone 也直接用 Radicale 同步。plugin 可以拆掉重裝，行程不行。照移除需求，「徹底刪除 calendar」會連行程一起刪掉。
- 一個服務可以給好幾個用戶端用：iPhone、之後的其他 plugin；Ollama 也是同樣的情況。
- plugin 容器是唯讀、拿掉所有權限、碰不到 Docker 的。如果讓 plugin 指定「順便幫我跑某個映像檔」，任何 plugin（包括之後 market 上別人寫的）都能在 nas 上跑任意容器。

## 2. 目標

- 安裝一個需要服務的 plugin 時，在同一個精靈裡就能把服務部署好、把連線祕密填好：使用者從頭到尾只要貼網址、按確認。
- 服務的生命週期和 plugin 分開：移除 plugin 不會動到服務和它的資料。
- 只有 Jarvis 內建、經過使用者審核的服務能被部署；plugin 只能說「我需要哪一種能力」，不能指定映像檔。
- 部署服務不重建、不重啟 `jarvis` 主程式容器。

非目標：
- 不做一般用途的容器管理介面，只管服務目錄裡的那幾個服務。
- 不自動改 nas 主機的設定：`tailscale serve`、整機備份 `backup.sh` 都是主機的事（§7）。

## 3. 服務目錄

- Jarvis repo 裡每個服務一個資料夾（例如 `services/radicale/`），內容是：
  - compose 範本，映像檔用 digest 釘死；
  - 一份說明檔，寫它**提供哪種能力**、資料放在哪、怎麼檢查健康狀態、怎麼建立帳號，以及部署後要手動做的事（§7）。
- 能力是 Jarvis 規格定義的名稱和輸出欄位，第一個是：
  - `caldav`：輸出 `url`、`user`、`password`。
- 第一版只有 Radicale（`caldav`）。之後的 Ollama 可以做成 `llm`。
- 目錄只隨 Jarvis 主程式改版；plugin 和 market 都不能新增服務。

## 4. plugin 怎麼宣告（manifest，選填；plugin 規格 0.5）

```json
"services": {
  "caldav": { "secrets": { "url": "caldav_url", "user": "caldav_user", "password": "caldav_password" } }
}
```

- 鍵是能力名稱；`secrets` 把能力的輸出欄位對應到這個 plugin 自己宣告的祕密名稱。
  對應到的祕密都必須已經列在 `permissions.secrets`，否則主程式只發警告，不擋啟動，`#/dev/plugins` 會顯示原因。
- 宣告了 `services` 也照樣可以手動填祕密，例如連到別台機器上的 CalDAV，或 PC 開發時直接用 tailnet 網址。
- 不認識的能力名稱只發警告，精靈會跳過服務這一步，退回手動填祕密。
- 舊的主程式會忽略這個欄位，plugin 照樣能用（手動填）。

## 5. 安裝精靈

在「審核權限」之後、「填祕密」之前，多一步 **服務**。manifest 裡的每一種能力都要選一個來源：

1. **用已經部署的服務**：例如 nas 上已經有 Radicale，直接選它。
2. **現在部署**：選了就在這一步部署服務（§6），完成後才往下走。
3. **自己填**：不用服務，下一步手動填祕密。

選 1 或 2 時，安裝器把服務的輸出照 §4 的對應填進 plugin 的祕密，「填祕密」那一步會顯示「已由 Radicale 填入」，使用者可以改。
接著照常進入「測試連線」：calendar 的 `setup(secrets)` 這時就能真的連上 Radicale。

## 6. 部署服務

- 和安裝 plugin 一樣交給 `jarvis-installer`；主程式仍然不掛 Docker socket。
- 用 `services/<name>/` 的範本寫進獨立的 `docker-compose.services.yml`，服務接上 `jarvis-services`，**不接**任何 plugin 的內部網路，也不改 `jarvis` 服務的設定。
- 資料放在 `<jarvis 目錄>/services/<name>/data/`，擁有者是 nas 的使用者（不是 root）。
- 帳號：
  - 部署時請使用者輸入帳號名稱，密碼由安裝器產生；
  - 密碼**只顯示一次**，讓使用者拿去設定 iPhone，之後存在主程式 DB，比照 plugin 祕密的規則：不送回瀏覽器、不寫進紀錄、不進模型 context。
  - Radicale 的 `htpasswd` 由安裝器寫入。
- 部署進度和安裝 plugin 一樣記在 DB，每一步做完就更新、每一步都可以重做；重新整理頁面能接回進度。
- 部署完成後，健康檢查要通過（Radicale：帶帳密做一次 `PROPFIND` 回 207），才算成功。

## 7. 部署後要使用者手動做的事

這些是 nas 主機的設定，容器裡的安裝器碰不到，也不該碰。部署完成的畫面要列出來，附上可以直接複製的指令：

- **讓 iPhone 連得到**：`tailscale serve` 把 Radicale 開到 tailnet，例如 `sudo tailscale serve --bg --https=5232 http://127.0.0.1:<port>`。
  - 為此服務要把端口綁在 nas 的 loopback；端口號由範本決定，部署時檢查有沒有衝突。
  - 這和 0001「服務不需要開端口到 nas 本機」不一樣：plugin 走 `jarvis-services`，iPhone 走 loopback 加上 `tailscale serve`，兩條路各自獨立。
- **整機備份**：把 `services/radicale/data/` 納入 nas 的 `backup.sh`。說明檔要附上一段可以照抄的設定。
- iPhone 上新增 CalDAV 帳號時要填的伺服器、帳號、密碼。

## 8. 服務頁（`#/dev/services`）

- 列出目錄裡的服務：沒部署、執行中、停止、失敗，以及**哪些 plugin 在用它**。
- 可以部署、重新啟動、停止、更新（Jarvis 改版帶來新的映像檔 digest 時）、重設密碼、移除。
- **重設密碼**：產生新密碼、顯示一次，並同步更新所有對應到它的 plugin 祕密（依 §4 記下的對應關係）。
- **移除**：比照 plugin 的移除需求，分「移除」和「徹底刪除」兩段：
  - 還有 plugin 在用時不能移除，要先移除那些 plugin，或把它們改成手動填祕密；
  - 「移除」保留 `data/`；「徹底刪除」才刪資料，要輸入服務名稱確認，並提醒「iPhone 同步的行程也會一起刪掉」。

## 9. 資料表（建議）

- `services`：名稱、狀態、映像檔 digest、部署時間。
- 服務祕密：比照 `plugin_secrets`。
- `service_links`：哪個 plugin 的哪個祕密，對應到哪個服務的哪個輸出。重設密碼和移除前的檢查都靠它。

## 10. 對 calendar 的影響

- manifest 加上 §4 的 `services.caldav`，`spec` 升到 0.5。程式碼不用改：祕密怎麼來的，plugin 看不出差別。
- `setup.notes` 改成：「沒有 Radicale 的話，精靈可以幫你部署；已經有的話，選它或自己填」。
- 這些等 Jarvis 的 0.5 定案再改，不要先照提案寫。

## 11. 驗收

在 nas 上測，起點是沒有 Radicale、也沒有 calendar：
1. 用精靈安裝 calendar，在「服務」那一步選「現在部署 Radicale」：
   - 部署成功；密碼顯示一次；
   - 祕密自動填好；「測試連線」通過；
   - `jarvis` 的 `StartedAt` 沒有變。
2. 照完成畫面的指令設定 `tailscale serve`，用 iPhone 新增 CalDAV 帳號，在 iPhone 新增一筆行程，calendar 卡片上看得到。
3. 徹底刪除 calendar：Radicale 還在跑，iPhone 的行程都在；`#/dev/services` 顯示「沒有 plugin 在用」。
4. 重新安裝 calendar，選「用已經部署的 Radicale」：不用再部署，祕密自動填好。
5. calendar 還裝著的時候，Radicale 不能移除；在服務頁重設密碼後，calendar 卡片照常運作（祕密已經同步更新）。
6. 選「自己填」：流程和現在一樣，可以連到別台機器上的 CalDAV。

## 12. 決定

- Q1（已定）：第一版不做「接管」使用者自己部署的服務。理由：目前 nas 上沒有東西需要接管；各種自訂 compose 和搬資料很難做得可靠；這種情況用「自己填」就能處理。
- Q2（已定）：`tailscale serve` 不自動化，維持 §7 的做法，在部署完成的畫面顯示可以直接複製的指令。理由：自動化要把 tailscaled 的 socket 掛進安裝器，等於讓它能把 nas 上任何東西開放到 tailnet，權限擴大太多；這件事每個服務只需要做一次。
- Q3（已定）：第一版一種能力在 nas 上只能有一個服務；精靈的「用已經部署的服務」因此不用選。
- Q4（已定）：plugin 不另開帳號，直接用服務部署時建立的使用者帳號；calendar 本來就是要讀寫使用者自己的行事曆。
