# 給 Jarvis 主程式：只用介面安裝 plugin（規格 0.4 需求）

> 從 calendar plugin repo 帶過去的需求，讓 Dashboard repo 設計一套標準的安裝流程。
> 這裡只是**提案**：主程式的 ADR 和 `spec/plugin-spec.md` 定案後，以那邊為準，calendar 再跟著改。
> 用到的現有規則：`plugin-spec.md` §1（容器、權限確認、祕密）、§2（manifest 檢查）、§8（`plugin.sh`、`plugin:check`）。

## 目標

使用者在 Jarvis 的介面貼上 plugin 的 git 網址，跟著精靈一步一步做完：下載、看權限、建置、填設定、測連線、放上首頁。
整個過程**不用 SSH 到 nas，也不用碰 `scripts/plugin.sh`**。改版和移除也在介面上完成。

不在範圍：PC 開發模式。PC 照舊掃描資料夾，`npm run dev` 不變。精靈只用在 nas 的容器模式。

## 1. 使用者看到的流程

```text
① 貼網址 → ② 預檢（不執行任何 plugin 程式碼）→ ③ 確認權限與版本 → ④ 建置與啟動
→ ⑤ 填祕密 → ⑥ 測試連線 → ⑦ plugin 自己的設定（選填）→ ⑧ 放上首頁
```

| 步驟 | 畫面 | 主程式做的事 |
|---|---|---|
| ① 貼網址 | `#/dev/plugins` 的「安裝 plugin」：git 網址，加上選填的分支或 tag（預設是預設分支） | 檢查網址：只接受 `https://`，主機要在允許清單裡（§4） |
| ② 預檢 | 進度：「下載中…」 | 淺層 clone 到暫存區，記下 commit SHA。**只靜態讀** `manifest.json`、`package.json`、`Dockerfile` 和 `plugin-kit.js`，不 build，也不跑任何程式碼。用 §2 的規則檢查 manifest，`id` 不能和已裝的 plugin 重複 |
| ③ 確認 | 名稱、版本、`spec`、commit SHA（短碼，可以點開 repo）；要的權限（`network`、`wiki`、每個祕密的說明）；卡片和工具清單，工具附 `risk` | 預檢的錯誤（✗）擋住「安裝」；警告（!）照列，可以繼續。使用者按「安裝」就等於核准權限，照 §7 寫紀錄 |
| ④ 建置 | 即時顯示建置紀錄；可以取消 | `docker build`，再照 §1 的規則啟動容器（唯讀根目錄、`/data`、網路依 `network` 決定）。`/health` 沒回應就停在這一步，顯示紀錄，可以重試或放棄（放棄會清掉暫存區和映像檔） |
| ⑤ 填祕密 | 依照 manifest 自動產生表單（§2 的 `setup.secrets`）：標籤、說明、範例、欄位類型（`password` 會遮住） | 存進 DB，規則和 0.3 的祕密一樣 |
| ⑥ 測試連線 | 「測試中…」，接著顯示 ✓，或是 plugin 回的錯誤訊息和要回去改的欄位 | 帶著祕密呼叫 `/health`，看回應的 `setup`（§3）。失敗時回到 ⑤ 並標出那個欄位；也可以「先略過」，卡片會自己顯示「尚未設定」 |
| ⑦ plugin 設定 | manifest 有宣告 `setup.settings` 時才有：用對話框顯示那個工具回傳的表單 | 呼叫那個工具，參數是 `{}`；表單送出照一般工具規則（§6） |
| ⑧ 完成 | 「已安裝」，卡片用 `size.default` 放在首頁 | 清掉暫存區 |

精靈的狀態存在 DB。關掉頁面再回來，會從中斷的那一步繼續；`#/dev/plugins` 上，這個 plugin 會標「安裝未完成」。

### 改版

`#/dev/plugins` 的「檢查更新」：抓遠端最新的 commit，有新版就顯示新舊兩個版本、兩個 SHA，以及 manifest 的差異。
- 權限變多：照現在的規則重新確認（§1），新增的祕密會跳到 ⑤。
- 建置新映像檔 → 啟動 → `/health` 通過後才換掉舊容器。失敗就留著舊容器繼續跑，並顯示建置紀錄。
- 保留上一版的映像檔，提供「回到上一版」（對應 calendar spec §12 要驗證的回滾）。
- `data/` 和祕密不動。

### 移除

停止並刪除容器和映像檔，再分別問要不要刪 `data/` 和祕密（預設都保留，方便重裝）。卡片從首頁拿掉。

## 2. Manifest 新增：`setup`（選填）

```json
"setup": {
  "notes": "Radicale 要先加入 `jarvis-services` 網路，網址才填得到 `http://radicale:5232/<帳號>/`。",
  "secrets": {
    "caldav_url":      { "label": "Radicale 網址", "type": "url", "example": "http://radicale:5232/jordan/", "hint": "結尾要有 /" },
    "caldav_user":     { "label": "帳號", "type": "text" },
    "caldav_password": { "label": "密碼", "type": "password" }
  },
  "settings": "calendar.settings"
}
```

- `permissions.secrets` 仍然是名稱陣列，也仍然是權限確認的依據。`setup.secrets` 只給精靈產生表單用，沒寫說明的祕密用名稱當標籤，類型是 `text`。
- `type` 是 `text`、`url` 或 `password`。主程式只用它決定輸入框的樣子；欄位是不是必填、格式對不對，都由 plugin 在 §3 回報。
- `notes`：顯示在 ③ 和 ⑤ 的 markdown，視為不可信資料，處理方式和 `description` 一樣，連結也不自動打開。
- `settings`：一個 `read` 或 `internal` 工具的名稱，用 `{}` 呼叫時要回傳設定表單。要經過 §2 的檢查：工具存在，而且以 `<id>.` 開頭。
- 舊的主程式會忽略 `setup`；沒有 `setup` 的 plugin，精靈就用名稱當標籤，並跳過 ⑦。

## 3. `/health` 回報設定狀態（選填）

`/health` 本來就會帶 `x-plugin-secrets`（§1）。在回應加一個選填的 `setup`：

```json
{ "ok": true, "version": "0.3.0", "setup": { "ok": false, "error": "Radicale 帳號或密碼錯誤", "field": "caldav_password" } }
```

- `setup.ok: true` 代表祕密齊全，而且真的連得上外部服務。沒有 `setup` 欄位就當成通過，舊的 plugin 不受影響。
- `field` 選填，指出是哪個祕密的問題，精靈會把焦點移到那個欄位。
- `ok`（程序是否活著）和 `setup.ok` 分開：沒設定好的 plugin 仍然算啟動成功，不能因此被重啟。
- 這次呼叫可以比較慢，因為要連外部服務。精靈用一般的 8 秒逾時；開機時的 5 秒啟動檢查只看 `ok`。
- plugin kit 0.4：`servePlugin({ manifest, cards, tools, setup })`，`setup(secrets)` 回傳 `{ ok, error?, field? }`。kit 把它放進 `/health` 的回應；拋錯就當成 `{ ok: false, error }`。沒給 `setup` 時行為和 0.3 一樣。

## 4. 安全（要寫成 ADR）

讓 Jarvis 自己 build 和跑容器，等於讓它從網路上抓程式碼，在 nas 上用 Docker 執行。

- **不要把 docker socket 掛進 Jarvis 主程式的容器**：那等於給主程式 nas 的 root 權限，主程式（或模型呼叫的工具）一旦被攻破，整台 nas 就沒了。
  建議另外跑一個很小的「安裝器」容器，只有它掛 socket。它只接受主程式送來的固定幾種命令：`fetch`、`build`、`start`、`stop`、`remove` 和 `rollback`，參數只有 `id`、網址和 SHA。
  這其實就是把現在的 `plugin.sh` 包成服務，而且只監聽一個主程式專用的內部網路。
- **網址允許清單**：只接受 `https://`，主機要在清單裡（預設 `github.com`），可以再限定擁有者（例如 `github.com/Lodiance/*`）。清單由使用者在設定頁維護，不是 plugin 能改的。
- **固定在 SHA**：③ 顯示的 SHA 就是要 build 的版本；從預檢到建置之間，遠端如果被 force-push，以使用者看到的那個 SHA 為準。
- **核准前不執行任何東西**：`Dockerfile` 的 `RUN` 就是在執行程式碼，所以 build 一定排在 ③ 之後。② 只能做靜態讀取。
- **建置的資源上限**：限制逾時、映像檔大小和建置時的記憶體。建置紀錄可能含有 plugin 印出的任何東西，只顯示，不送進模型。
- 祕密在 ⑤ 之前都不存在，所以 build 階段拿不到；容器啟動時也只有 §1 的那些環境變數。

## 5. 主程式要做的事（給 Dashboard repo 拆工作）

1. 決定安裝器的架構和網址允許清單，寫成 ADR，把 §4 的問題定案。
2. 安裝器服務，取代 nas 上手動執行的 `plugin.sh`。`plugin.sh` 可以保留，當救援用的命令列工具。
3. `#/dev/plugins`：安裝精靈（§1 的 ①–⑧）、檢查更新、回到上一版、移除；精靈狀態存在 DB。
4. Manifest 檢查加上 `setup`（§2）；`plugin:check` 也要檢查它，並顯示 `/health` 回的 `setup`。
5. Plugin kit 0.4：`setup` 回呼（§3），`KIT_SPEC` 改成 0.4。
6. 更新 `plugin-spec.md` 和範本（`plugin:new` 產生的範本附上 `setup` 範例）。

## 6. calendar 會配合的事（主程式 0.4 定案後在 calendar repo 做）

- manifest 加上 §2 的 `setup` 區塊，`settings` 指向 `calendar.settings`（已經有了）。
- `setup(secrets)`：祕密不齊時回 `{ ok: false, error: "尚未設定…", field: <第一個缺的> }`；有填的話就 `PROPFIND` 一次，`401` 時 `field` 指向 `caldav_password`，連不上時指向 `caldav_url`。
- 驗收：在 nas 上從一個全新的狀態，只用介面裝好 calendar，看到近三天的行程；再用介面改版一次、回到上一版一次，`data/settings.json` 都還在。
