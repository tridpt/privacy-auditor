# Tài liệu kiến trúc — Privacy Auditor

> Tài liệu kỹ thuật mô tả cách extension được tổ chức, luồng dữ liệu, và các quyết định thiết kế quan trọng. Dành cho người muốn đọc hiểu hoặc đóng góp code.

## 1. Tổng quan

Privacy Auditor là một Chrome Extension (Manifest V3) phân tích quyền riêng tư của website theo thời gian thực: phát hiện tracker, fingerprinting, chấm điểm CSP, kiểm tra cookie, và cho phép chặn request theo dõi.

Toàn bộ viết bằng **vanilla JavaScript**, không framework, không bước build (trừ script đóng gói `.zip`). Logic thuần được tách ra module dùng chung và kiểm thử bằng Node.

## 2. Bốn ngữ cảnh thực thi

Extension chạy trong 4 môi trường JavaScript tách biệt, mỗi cái có quyền và vòng đời khác nhau. Hiểu ranh giới này là chìa khóa để hiểu cả dự án.

| Ngữ cảnh | File | Quyền | Vòng đời |
|---|---|---|---|
| **Service worker** | `background.js` | Toàn bộ `chrome.*` API | Bị kill sau ~30s nhàn rỗi |
| **MAIN world** | `injected.js` | Như trang web, **không** có `chrome.*` | Theo vòng đời trang |
| **Isolated world** | `content.js` | `chrome.runtime` hạn chế | Theo vòng đời trang |
| **Popup / Options** | `popup.js`, `options.js` | Hầu hết `chrome.*` | Chỉ khi UI mở |

### Vì sao cần cả MAIN world lẫn isolated world?

Các API fingerprinting (Canvas, WebGL, AudioContext...) chỉ có thể hook được nếu code chạy **trong cùng world với trang** (MAIN world). Nhưng MAIN world không truy cập được `chrome.runtime` để gửi tín hiệu về service worker.

Giải pháp: hai content script phối hợp.
- `injected.js` (MAIN world) patch các prototype API, khi bị gọi thì phát `window.postMessage`.
- `content.js` (isolated world) lắng nghe `postMessage`, lọc, rồi chuyển tiếp qua `chrome.runtime.sendMessage`.

Dùng `world: "MAIN"` khai báo trong manifest thay vì chèn `<script>` động — cách này **không bị CSP của trang chặn**, vì script được Chrome nạp ở tầng trình duyệt chứ không qua DOM.

## 3. Luồng dữ liệu

```
Trang web tải
  │
  ├── injected.js (MAIN)     → hook Canvas/WebGL/Audio/Font/Battery/Navigator
  │      │ window.postMessage({__PA__, type:'fp', api})
  │      ▼
  ├── content.js (isolated)  → lọc trùng, quét DOM (script src, cookie, storage)
  │      │ chrome.runtime.sendMessage('FINGERPRINT_DETECTED' | 'PAGE_SCAN')
  │      ▼
  └── background.js (worker)
         ├── webRequest.onBeforeRequest   → đếm request, match tracker, log waterfall (≤250)
         ├── webRequest.onHeadersReceived → bắt CSP + Referrer-Policy vào cache riêng
         ├── tabs.onUpdated               → khởi tạo tabData, cập nhật badge
         └── declarativeNetRequest        → chặn request theo rule
         │
         │  (snapshot debounce → chrome.storage.session)
         ▼
   Người dùng mở popup
         │ sendMessage('GET_DATA', 'GET_CSP', 'GET_REQUEST_LOG', ...)
         ▼
   popup.js → tính điểm, render 8 tab (waterfall render lazy khi đổi tab)
```

## 4. Tổ chức source

```
PrivacyAuditor/
├── manifest.json          # MV3: quyền, content scripts, world declaration
├── background.js          # Service worker — điều phối, lưu trữ, chặn, badge
├── injected.js            # MAIN world — hook fingerprint API
├── content.js             # Isolated world — quét DOM, relay tín hiệu
├── popup.html/js/css      # UI chính 8 tab
├── options.html/js/css    # Trang cài đặt
├── lib/
│   ├── scoring.js         # ❶ Logic thuần: TRACKERS, tính điểm, match domain
│   └── headers.js         # ❷ Logic thuần: phân tích CSP, referrer policy
├── tests/
│   ├── scoring.test.js    # 25 test cho lib/scoring.js
│   └── headers.test.js    # 20 test cho lib/headers.js
├── docs/                  # Tài liệu + hướng dẫn chụp ảnh
└── build-zip.mjs          # Đóng gói .zip cho Web Store
```

**❶❷ Hai file `lib/` là trái tim của thiết kế "testable core".** Xem mục 6.

## 5. Các quyết định thiết kế quan trọng

### 5.1. Sống sót khi service worker bị kill (MV3)

**Vấn đề:** MV3 không có background page thường trú. Chrome kill service worker sau ~30s nhàn rỗi, xóa sạch mọi biến trong RAM (`tabData`, `cspCache`, `refPolCache`). Khi worker thức dậy do một sự kiện mới, dữ liệu scan của các tab đang mở đã mất → popup hiện trắng.

**Giải pháp:** Mirror state vào `chrome.storage.session` (kho in-memory sống sót qua worker restart, tự xóa khi đóng browser).
- `scheduleSnapshot()` — ghi có debounce, tối đa 1 lần/giây, tránh thrash khi `onBeforeRequest` bắn liên tục.
- `serializeTab()` / `deserializeTab()` — chuyển Map/Set ↔ array vì storage chỉ giữ JSON.
- `restoreState()` chạy ngay khi worker khởi động.
- **Chống race:** các handler đọc dữ liệu (`GET_DATA`, `GET_CSP`, `GET_REQUEST_LOG`, `GET_REFERRER_POLICY`) đều `await restoreState()` trước khi trả lời, để không trả `null` khi worker vừa thức mà restore chưa xong.

### 5.2. Race condition khi bắt header

**Vấn đề:** `onHeadersReceived` (bắt được CSP) và `tabs.onUpdated(status:'loading')` (gọi `initTabData` reset dữ liệu) chạy không xác định thứ tự. Có lúc `onUpdated` reset `tabData.csp` **sau khi** `onHeadersReceived` đã ghi → mất CSP.

**Giải pháp:** CSP và Referrer-Policy lưu vào `cspCache` / `refPolCache` — hai Map **tách biệt** khỏi `tabData`, nên đường reset của `initTabData` không đụng tới chúng.

### 5.3. Bộ đếm "lifetime blocked" chạy được cả khi publish

**Vấn đề:** API `declarativeNetRequest.onRuleMatchedDebug` (báo mỗi khi một rule chặn khớp) chỉ hoạt động với extension **unpacked (dev mode)**. Trên bản publish từ Web Store, nó im lặng → bộ đếm đứng yên.

**Giải pháp:** Phát hiện API có khả dụng không (`useDebugCounter`). Khi không có, fallback sang ước lượng trong `onBeforeRequest`: hàm `wouldBeBlocked(reqDomain, pageDomain)` kiểm tra request có khớp block list / custom rule / global protection không (có tính tới family exclusion và whitelist). Cờ `useDebugCounter` đảm bảo không đếm trùng giữa hai đường.

### 5.4. Nhận biết "gia đình doanh nghiệp" để tránh false positive

Request từ `fbcdn.net` khi đang ở `facebook.com` **không phải** tracker bên thứ ba — đó là CDN cùng công ty. `DOMAIN_FAMILIES` nhóm các domain cùng tổ chức (Meta, Google, Microsoft...). `isSameFamily()` so khớp để loại các trường hợp này khỏi "external request" và khỏi global blocking.

### 5.5. Phạt first-party cho chính các nền tảng thu thập dữ liệu

Ngược lại với 5.4: khi bạn *đang ở trên* `facebook.com` / `tiktok.com`, chính trang đó là kẻ thu thập dữ liệu. `FIRST_PARTY_PENALTY` áp hình phạt cố định vào điểm số dù không có tracker bên thứ ba nào.

## 6. "Testable core, untestable shell"

Đây là quyết định kiến trúc đáng chú ý nhất về mặt khả năng kiểm thử.

**Vấn đề:** Logic chấm điểm, match tracker, chấm CSP đều nằm trong `background.js` / `popup.js` — vốn phụ thuộc `chrome.*` API và DOM, không chạy được dưới Node để test.

**Giải pháp:** Tách toàn bộ logic **thuần** (không side effect, không `chrome.*`, không DOM) ra hai module:
- `lib/scoring.js` — `TRACKERS`, `calculateScore`, `matchTracker`, `isSameFamily`, `getDomain`, `scoreToColor`, `getFirstPartyPenalty`.
- `lib/headers.js` — `parseCsp`, `analyzeCsp`, `CSP_CHECKS`, `RP_DB`, `normalizePolicy`, `referrerPolicyInfo`.

**Một nguồn sự thật, hai cách nạp:**
- Service worker nạp qua `importScripts('lib/scoring.js')` → các khai báo trở thành global của worker.
- Popup nạp qua `<script src="lib/headers.js">` đặt **trước** `popup.js` → chia sẻ global lexical scope.
- Node test nạp qua `require('../lib/scoring.js')` → đọc `module.exports`.

Mẹo tương thích cả ba: cuối mỗi file có
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```
Trong worker/browser, `module` không tồn tại → `typeof` trả `'undefined'`, khối bị bỏ qua, không lỗi. Trong Node → export bình thường.

**Kết quả:** 45 unit test chạy bằng `node --test` (test runner built-in, **không cần cài dependency**), bao phủ logic dễ sai nhất mà không cần Chrome.

## 7. Mô hình message (popup ↔ service worker)

Mọi giao tiếp qua `chrome.runtime.sendMessage`. Các message chính:

| Message | Hướng | Tác dụng |
|---|---|---|
| `FINGERPRINT_DETECTED` | content → bg | Ghi nhận một API fingerprint bị gọi |
| `PAGE_SCAN` | content → bg | Gửi script src, cookie count, storage count |
| `GET_DATA` | popup → bg | Lấy điểm + toàn bộ dữ liệu scan của tab |
| `GET_CSP` / `GET_REFERRER_POLICY` | popup → bg | Lấy header đã bắt |
| `GET_REQUEST_LOG` | popup → bg | Lấy log waterfall (lazy, khi mở tab Network) |
| `BLOCK_DOMAIN` / `UNBLOCK_DOMAIN` | popup → bg | Chặn/bỏ chặn một domain |
| `BLOCK_ALL` / `UNBLOCK_ALL` | popup → bg | Chặn/bỏ tất cả tracker của tab |
| `ENABLE/DISABLE_GLOBAL_PROTECTION` | popup → bg | Bật/tắt chặn toàn cục |
| `ADD/REMOVE_TO_WHITELIST` | popup → bg | Quản lý whitelist |
| `ADD/REMOVE_CUSTOM_RULE` | options → bg | Quản lý rule chặn tùy chỉnh |
| `GET_TRACKER_DB` | options → bg | Lấy toàn bộ DB tracker để hiển thị |

**Lưu ý kỹ thuật:** handler nào trả lời bất đồng bộ phải `return true` để giữ message port mở, nếu không `sendResponse` sẽ bị bỏ.

## 8. Phân tầng rule chặn (declarativeNetRequest)

ID rule được chia khoảng để tránh đụng nhau:

| Khoảng ID | Mục đích |
|---|---|
| `1 – 999` | Global protection (chặn mọi tracker đã biết trên mọi trang) |
| `1000 – 1999` | Custom rule người dùng tự thêm |
| `2000+` | Chặn theo từng domain (Block / Block All) |

Global protection dùng `excludedInitiatorDomains` để loại family domain và whitelist khỏi việc chặn.

## 9. Chấm điểm Privacy (tóm tắt)

Bắt đầu từ 100, trừ dần:

| Điều kiện | Trừ |
|---|---|
| Mỗi tracker (tối đa) | −5 (cap −35) |
| Có session recorder | −20 |
| Tracker high-risk | −2 mỗi cái (cap −10) |
| Là nền tảng thu thập first-party | cố định 15–30 |
| Fingerprinting | −5 mỗi kỹ thuật (cap −15) |
| External request | phân bậc, tối đa −28 |
| Cookie nhiều | phân bậc, tối đa −10 |

Chi tiết và cap đầy đủ xem `lib/scoring.js → calculateScore()`.

## 10. Chạy & kiểm thử

```bash
npm test            # 45 unit test (Node built-in runner)
npm run build       # đóng gói dist/privacy-auditor-<version>.zip
```

Load thủ công: `chrome://extensions` → Developer mode → Load unpacked → chọn thư mục gốc. Reload tab mục tiêu sau khi cài để network listener bắt đủ request từ đầu.

## 11. Hạn chế đã biết

- **Nhánh fallback của bộ đếm blocked** (mục 5.3) chỉ được verify bằng đọc logic + test đơn vị, chưa test live trên bản packed thật.
- **DB tracker là tĩnh** — cần cập nhật thủ công khi có tracker mới.
- **`storage.session` có giới hạn dung lượng** — với rất nhiều tab cùng lúc, snapshot có thể chạm trần (hiện chấp nhận được vì requestLog đã cap 250/tab).
