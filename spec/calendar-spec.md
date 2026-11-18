# calendar — 主規格

版本：v0.1（2026-11-16 設計定案，來源是 Jarvis 主程式 ADR 0012 和當天的討論）
狀態：v0.3 已實作（2026-11-18），依循主程式的 plugin 規格 0.4；只對假 Radicale 測過，還沒在 nas 實裝。

協定以 Jarvis repo 的 `spec/plugin-spec.md` 為準。名稱或行為和 `plugin-spec.md` 不同時，以 `plugin-spec.md` 為準，並回頭修正本文件。

## 1. 目的

- Jarvis 讀得到使用者的行事曆，也能透過 AI 操作（新增、修改、刪除）。
- Dashboard 上一眼看到今天和接下來幾天的行程；需要時展開成月曆，看得出每天有什麼、哪些狀態要注意。
- 行程放在 nas 上自架的 Radicale（CalDAV）。iPhone 內建行事曆也直接同步 Radicale，兩邊看到同一份資料。

### 非目標

- 不在 plugin 存行程副本：Radicale 是唯一來源。
- 不寄邀請、不處理與會者回覆（CalDAV scheduling／iTIP）。
- 不做 OAuth。Google 行事曆之後用「iCal 格式私人網址」唯讀讀取（§11）。
- 不做提醒或推播：提醒交給 iPhone 的原生提醒。
- 不建立、不刪除行事曆本身（collection），只動行程。
- 重複行程在 v0.x 只讀：要改請在 iPhone 上改（§8）。

## 2. 架構

```text
iPhone 行事曆 ──CalDAV（tailnet）──┐
                                   ├── Radicale（nas，~/app/radicale/，不屬於本 repo）
Jarvis 主程式 ──HTTP──> calendar plugin ──CalDAV──┘
```

- Radicale 是 nas 上的獨立服務，部署、備份由 Jarvis repo 的維運文件處理，不在本 repo。
- 本 plugin 是 CalDAV 客戶端，不存行程。`DATA_DIR` 只放 `settings.json`（§4）。
- 零 npm 依賴：Node ≥24 的 `fetch`、`Intl`、`node:test` 就夠。iCalendar 只解析和產生下面列到的欄位。

### 讀取

1. 用 `caldav_url` 做 `PROPFIND`（Depth 1）列出行事曆：取 `displayname`、`resourcetype` 含 `calendar` 的、`calendar-timezone`。`caldav_url` 可以是使用者的行事曆根目錄，或直接指向單一行事曆。
2. 每個行事曆做 `REPORT calendar-query`，帶 `time-range` 和 `<C:expand>`，請 Radicale 把重複行程展開成一筆一筆（時間會是 UTC）。plugin 不處理 RRULE。
3. 解析 `VEVENT` 的 `UID`、`RECURRENCE-ID`、`SUMMARY`、`DTSTART`、`DTEND` 或 `DURATION`、`STATUS`、`LOCATION`、`DESCRIPTION`。`DTSTART;VALUE=DATE` 是全天行程。
4. 每次讀取都直接問 Radicale；卡片的快取交給主程式的 `ttl`。

### 寫入（v0.2）

- 新增：產生一個最小的 `VCALENDAR`/`VEVENT`（新的 `UID`、`DTSTAMP`），`PUT <行事曆>/<uid>.ics`，帶 `If-None-Match: *`。非全天的時間一律寫成 UTC（`...Z`），不必附 `VTIMEZONE`。
- 找行程：用 `REPORT calendar-query` 加上 `UID` 的 `prop-filter`，在每個行事曆裡找；iPhone 建立的行程，檔名不一定是 `<uid>.ics`。
- 修改：先 `GET` 拿原始資料和 ETag，只改有傳的欄位，保留其他屬性，`PUT` 帶 `If-Match`。
- 刪除：`DELETE` 帶 `If-Match`。
- 收到 `412`（別處已經改過）：不重試，回 `notice`「行程在別處被改過，已重新載入」，並回傳最新的行程細節。
- 有 `RRULE` 或 `RECURRENCE-ID` 的行程一律不改、不刪（§8）。

### 時區

- 顯示用的時區：`settings.json` 的 `timezone`；沒設定時用第一個行事曆的 `calendar-timezone`；都沒有時用 `Europe/London`。
- 「今天」「進行中」都用這個時區判斷。主程式的表單 `date` 欄位送來的是不帶時區的本地時間（`YYYY-MM-DDTHH:MM`），也照這個時區解讀。

## 3. 權限與祕密

```json
"permissions": { "network": true, "secrets": ["caldav_url", "caldav_user", "caldav_password"], "wiki": false }
```

- 祕密由使用者在 Jarvis 的 `#/dev/plugins` 填寫。主程式每次請求都帶 `x-plugin-secrets` 標頭（UTF-8 JSON 再做 base64url），由 `plugin-kit.js`（`KIT_SPEC` 0.4）解析後交給 handler。
- 只會帶已經設定的祕密。缺任何一個時，卡片顯示 `callout`（`tone: warn`）「尚未設定 Radicale 連線，到 #/dev/plugins 填寫網址、帳號和密碼」，工具回錯誤。
- 不要把標頭、祕密或完整的請求寫進日誌或錯誤訊息。
- nas 上 `caldav_url` 填 `http://radicale:5232/<user>/`：Radicale 加入共用的 `jarvis-services` Docker 網路，主程式讓 `network: true` 的 plugin 容器自動接上同一個網路（`decisions/0001-shared-services-network.md`）。PC 上直接用 tailnet 網址。
- 安裝精靈（規格 0.4，v0.3）：manifest 的 `setup` 給三個祕密加上標籤和網址範例，`settings` 指向 `calendar.settings`。`/health` 的 `setup` 由 `setup(secrets)` 回報：缺哪個祕密就指那個欄位；網址格式不對、連不到、Radicale 回非 2xx，或網址底下沒有行事曆，都指 `caldav_url`；`401` 指 `caldav_password`。只做一次 PROPFIND，錯誤訊息不帶祕密。

## 4. 設定（`DATA_DIR/settings.json`，v0.2）

| 鍵 | 預設 | 說明 |
|---|---|---|
| `timezone` | 見 §2 時區 | IANA 名稱，例如 `Asia/Taipei` |
| `days` | `3` | 卡片顯示今天起幾天（1–14） |
| `calendar` | 第一個行事曆 | 新增行程時預設寫入的行事曆（`displayname` 或路徑） |

由 `calendar.settings` 寫入。檔案壞掉或不存在時用預設值，不讓卡片失敗。

## 5. 狀態

卡片和月曆用同一套判斷，每個行程只取一個狀態，順序由上而下：

| 狀態 | 條件 | `tone` | 其他 |
|---|---|---|---|
| 已取消 | `STATUS:CANCELLED` | `muted` | `strike: true` |
| 時間衝突 | 和同一天另一個非全天、未取消的行程時間重疊 | `error` | |
| 未確認 | `STATUS:TENTATIVE` | `warn` | |
| 進行中 | 現在介於開始和結束之間 | `accent` | |
| 已結束 | 結束時間已過 | `muted` | |
| 一般 | 其他 | 不給 | |

全天行程另外標 `allday: true`（畫成底色），狀態照上表判斷，但不參與衝突判斷。

## 6. 卡片 `upcoming`

```json
{ "id": "upcoming", "title": "行事曆", "ttl": 300, "size": { "default": [4, 6], "min": [3, 4] } }
```

外層是 `adaptive`（`min_width: 560`）：

- **`narrow`（平常大小、手機）**：堆疊橫條。
  - 頂端一列：右邊一個 `button`「月曆」→ `calendar.month`（今天的月份）。
  - 從今天起 `days` 天，依日期分組，標題 `text`：「今天 · 11/16（一）」「明天 · 11/17（二）」「11/18（三）」。
  - 每組一個 `agenda`（`bars: true`）：`time` 是「10:00–11:00」或「全天」；`text` 是標題（進行中加「 · 進行中」）；`tone`、`allday`、`strike` 照 §5；`action` → `calendar.event`。
  - 最多 8 條，多的寫一行 `text`（`muted`）「還有 N 個行程，打開月曆查看」。
  - 都沒有行程：「接下來 3 天沒有行程」。
- **`wide`（卡片被拉到 560px 以上）**：和月曆對話框同一個版面（§7），但不顯示對話框的「關閉」相關元素。

主程式還是 0.2 時（沒有 `adaptive`、`bars`），用 `fallback` 畫成一般的 `agenda`。

## 7. 月曆對話框：`calendar.month`

使用者已經確認過 mockup：左邊月曆格、右邊當天清單。

- 回應帶 `dialog: "wide"`。
- **頂列**（`row`，`align: between`）：「‹」→ 上個月、「2026 年 11 月」、「›」→ 下個月、「今天」→ 今天；右邊「＋ 新增」→ `calendar.form`（`date` 是選中的日子）、「設定」→ `calendar.settings`（沒有參數，回傳設定表單）。
- **主體**（`grid`，`columns: [3, 1]`；窄的時候用 `adaptive` 改成上下排）：
  - 左：`calendar`，`month`、`selected`。`days[].items[]` 是當天全部行程（最多 20），每項帶 `text`、`tone`、`allday`、`strike`，`action` → `calendar.event`。`days[].action` → `calendar.month { month, date }`（換選中的日子）。格子裡顯示幾項、「+N」、窄的時候改畫色點，都由主程式決定。
  - 右：標題「11 月 16 日（一）」，下面是那天的 `agenda`（`bars: true`），`action` → `calendar.event`；沒有行程時「沒有行程」。
- **圖例**（底部 `row`）：`badge` 進行中（`accent`）、未確認（`warn`）、時間衝突（`error`）、已取消（`muted`），再加一句「底色＝全天」。
- 換月份、換日子都是重新呼叫 `calendar.month`，主程式會換掉同一個對話框的內容。

## 8. 行程細節：`calendar.event`

- `fields`：時間、地點、行事曆、狀態；備註用 `text`（`pre: true`）。
- 按鈕（v0.2）：「編輯」→ `calendar.form { uid }`；「刪除」→ `calendar.delete { uid }`，`style: danger`，`confirm`「刪除「標題」？」；「回到月曆」→ `calendar.month { date }`。
- 重複行程只顯示 `callout`（`muted`）「這是重複行程，請在 iPhone 修改」，沒有編輯和刪除。

## 9. 新增／編輯表單：`calendar.form`（v0.2）

在對話框裡顯示 `form`（打字時卡片重新整理不會影響它）：

| 欄位 | 元件 | 必填 |
|---|---|---|
| `title` | `input` | 是 |
| `allday` | `checkbox` | |
| `start` | `date`（`datetime`；全天時只取日期） | 是 |
| `end` | `date`（`datetime`；沒填就是開始後 1 小時，全天則為同一天） | |
| `location` | `input` | |
| `notes` | `input`（`multiline`） | |
| `calendar` | `select`（只有一個行事曆時不顯示） | |

送出：新增 → `calendar.create`；編輯 → `calendar.update`，`submit.input` 帶 `uid`。成功後回到那天的月曆（回傳 `calendar.month` 的 `view`）並附 `notice`。

## 10. 工具

時間參數：`YYYY-MM-DDTHH:MM`（本地時間）或 `YYYY-MM-DD`（全天）。全天行程的 `end`，進出都是最後一天（包含）。`description` 給模型看，寫清楚格式。

`calendar.create` 以外的工具都要附 `examples`，`npm run plugin:check` 會呼叫它們。`create` 不附，因為 check 拿到祕密時會真的新增一筆行程。`update`、`delete` 的範例用不存在的 `uid`，只會回「找不到」。

| 工具 | `risk` | `input` | 說明 | 版本 |
|---|---|---|---|---|
| `calendar.list` | `read` | `from`、`to`（`string`） | 給 AI：區間內的行程，`result` 是 `[{uid, start, end, allday, title, status, location, calendar, recurring}]`；區間最多 62 天 | v0.1 |
| `calendar.month` | `read` | `month`、`date`（`string`，都可省略） | 月曆對話框（§7） | v0.1 |
| `calendar.event` | `read` | `uid`、`start`（`string`；重複行程用 `start` 指定哪一次） | 行程細節（§8） | v0.1 |
| `calendar.form` | `read` | `date`、`uid`（`string`，都可省略） | 新增或編輯表單（§9） | v0.2 |
| `calendar.create` | `internal` | `title`、`start`、`end`、`location`、`notes`、`calendar`（`string`）、`allday`（`boolean`） | 新增行程 | v0.2 |
| `calendar.update` | `internal` | `uid` 加上和 `create` 相同的欄位（`calendar` 除外，不能換行事曆），只改有傳的 | 修改行程；重複行程拒絕 | v0.2 |
| `calendar.delete` | `internal` | `uid` | 刪除行程；重複行程拒絕 | v0.2 |
| `calendar.settings` | `internal` | `timezone`、`calendar`（`string`）、`days`（`number`） | 改 §4 的設定；沒有參數時回傳設定表單 | v0.2 |

全部是 `internal`：Radicale 不會寄出任何東西。主程式在 `internal` 工具成功後會自動重新抓卡片。

AI：plugin 只負責工具和給模型看的 `description`、`examples`，寫到小模型（例如 nas 上的 Ollama）也看得懂。用哪個模型、允不允許 AI 呼叫本 plugin 的工具，都由主程式決定（plugin 分不出呼叫者是人還是 AI），本 plugin 不做模型設定。

## 11. 錯誤與斷線

- 連不到 Radicale（逾時 6 秒，主程式的上限是 8 秒）：卡片回非 2xx 和 `{error}`，主程式會顯示上次的快照加「無法連線」。
- Radicale 回 `401`：卡片顯示 `callout`（`error`）「Radicale 帳號或密碼錯誤，到 #/dev/plugins 更新」。
- nas 關機時整個 Jarvis 都不在，plugin 不用處理；也不要假設有背景工作會持續跑。

## 12. 版本與驗證

| 版本 | 內容 | 要驗證的事（主程式 ADR 0008） |
|---|---|---|
| v0.1 | 只讀：`upcoming` 卡片、`calendar.list`、`calendar.month`、`calendar.event` | 不改主程式就能裝上；`network`、`secrets` 要使用者確認才會啟動 |
| v0.2 | 寫入工具、表單、設定 | 更新後 `data/` 和卡片排版都在；新增的工具主程式正確處理 |
| 回滾 | 換回 v0.1 的映像檔 | 舊版照常運作（v0.2 新增的 `settings.json` 舊版要能忽略） |
| v0.3 | 配合主程式 0.4 的介面安裝：manifest 加 `setup`、kit 的 `setup(secrets)` 測連線（§3） | nas 上從零只用介面裝好、改版、回滾，`data/` 都在；只用介面移除後不留任何東西，可以馬上重裝（Jarvis repo 的移除需求 §8） |
| 之後 | 讀 Google 的 iCal 私人網址（新增 secret `google_ical_url`，唯讀） | 新增權限時，主程式要求重新確認，不會直接放寬 |

## 13. 開發

- 先決條件：主程式的 plugin 規格 0.3（secrets、`adaptive`、`agenda` 的 `bars`、`calendar` 的 `items`、`grid` 比例、`dialog: "wide"`）。完成前可以先寫 CalDAV 和 iCalendar 的部分和測試。
- nas 正式安裝另外需要：主程式讓 `network: true` 的 plugin 容器接上 `jarvis-services` 網路（`decisions/0001`），以及 Radicale 加入這個網路。
- 可以讀的文件：Jarvis repo 的 `spec/plugin-spec.md`，以及 `npm run dev` 之後的 `http://127.0.0.1:3000/#/dev/components`。Jarvis repo 的其他檔案（ADR、HANDOFF、主 spec、程式碼）不讀；文件不夠用時，把缺什麼寫進本 repo 的 HANDOFF，回 Jarvis repo 處理。
- 在 Jarvis repo 跑主程式並載入本 plugin：`JARVIS_PLUGINS=../Plugins npm run dev`（指向 plugin 資料夾的上一層，會取代預設的 plugin 資料夾）。
- 檢查：在 Jarvis repo `npm run plugin:check ../Plugins/calendar`。
- 測試：`npm test`。CalDAV 用 `node:http` 架一個假伺服器回固定的 XML，不依賴真的 Radicale。至少要涵蓋：全天和跨日行程、重複行程展開後的多筆、§5 每一種狀態、時區換算、`412` 衝突、祕密缺漏。
- 手動測：PC 上可以直接連 nas 的 Radicale（PC 在 tailnet 上）；用一個測試用的行事曆，不要動真的行程。
- 發佈：推到 GitHub，在 nas 用 Jarvis 的 `scripts/plugin.sh install calendar <git 網址>`，改版用 `update`。主程式 0.4 之後改成在 `#/dev/plugins` 的安裝精靈貼網址安裝，`plugin.sh` 留著當救援用。安裝精靈只支援公開 repo（clone 時不帶帳號）；本 repo 目前維持私人，所以還不能用精靈裝。

## 14. 待決

- 重複行程要不要支援「只改這一次」或「改整個系列」（v0.x 先不支援）。
- Google iCal 私人網址那一版的時程。
