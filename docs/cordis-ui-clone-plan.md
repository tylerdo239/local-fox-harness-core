# Cordis UI clone plan — login + example-2 visual design

**Trạng thái: cả 8 phase (A-H) đã xong** — build sạch (`tsc --noEmit` + `next build`) và test
thật qua HTTP/boot ở mỗi phase, chi tiết ghi ở từng mục bên dưới. Còn lại: xác nhận bằng mắt
trong trình duyệt thật (màu sắc/bo góc/resize responsive/click thử từng luồng) — việc Claude
Code không tự làm được, ghi rõ ở cuối mỗi phase.

Kế hoạch riêng (không nhập vào `cordis-agent-implementation-plan.md` vì đây là một hạng
mục UI/UX mới, không phải một trong 8 phase gốc đã xong). Đọc
`cordis-agent-implementation-plan.md` trước nếu chưa quen quy ước dự án (path tĩnh cho
route, `serveStatic()` không fallback, TanStack Query + Zustand, v.v.) — tài liệu này không
lặp lại các quyết định nền đó.

**Nguồn tham khảo:** `example-2/apps/web` (Vite + React 18, không Tailwind — CSS tay
`theme.css`+`style.css`, ~2500 dòng, class `fh-*`). Dự án đó là multi-tenant SaaS thật
(đăng ký/đăng nhập bằng email, Postgres, WebSocket riêng) — ta chỉ lấy **thiết kế hình ảnh
và bố cục**, không lấy kiến trúc multi-tenant/WebSocket của họ.

**Quyết định đã chốt với người dùng (2026-09-15):**
1. Style: build lại bằng Tailwind (không copy nguyên CSS tay của example-2) — dịch design
   token (màu, spacing, typography trong `theme.css`) sang Tailwind, không port class `fh-*`
   nguyên văn.
2. Đồng ý nới cổng bảo mật: SPA shell (`index.html`) tải công khai (không cần cookie), chỉ
   `/api/v1/*` vẫn khoá như cũ — mô hình chuẩn của mọi SPA thật (shell public, data protected).
3. Có thêm i18n đa ngôn ngữ VÀ SkillsDialog, ngoài 6 phase lõi.

---

## 0. Vấn đề kỹ thuật cốt lõi: cầu nối auth (đọc trước khi làm bất kỳ phase nào)

dsh's auth thật (`@deepseek-ai/dsh-client-connection`, xác nhận qua đọc type declaration
thật, không đoán) **không có khái niệm username/password hay logout**:

- Mỗi process boot sinh **một** "launch token" ngẫu nhiên (biến private, không lộ ra
  `ctx.<key>` nào để đọc trực tiếp).
- `ctx.connection.authorizeIndex(req, res)` (đang dùng trong `ui.ts` hiện tại): token đúng
  trên `GET /` → ký cookie + redirect về `/` sạch; cookie đúng → cho phép serve index; mọi
  trường hợp khác → 401 rỗng, **không có gì để hiển thị**.
- **Không có API logout phía server** — README ghi rõ "There is no logout operation";
  cách duy nhất "đăng xuất" là xoá cookie phía trình duyệt (cookie hết hạn sau
  `cookieMaxAgeDays`, mặc định 30 ngày).

**Cầu nối tìm được, đã xác nhận qua type declaration thật
(`node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc-host.d.ts`):**

```ts
class HostConnectionService {
  authorizeIndex(request, response): boolean
  authenticatedUrl(baseUrl: string): string   // <-- đây
}
```

`ctx.connection.authenticatedUrl(baseUrl)` là hàm **public**, sinh URL kèm token hợp lệ
ngay lúc gọi, hoàn toàn phía server, không cần biết token thật là gì. Thiết kế:

1. Route `POST /api/v1/auth/login` — **PHẢI** đăng ký qua `ctx.webServer.register()` (route
   thô, tự lo auth — giống hệt cách `n8n.ts`'s webhook route đã làm), **KHÔNG** qua
   `ctx.connection.fetch.register()` (route đó tự động đòi cookie trước khi vào tới handler
   — vòng luẩn quẩn: chưa login thì không gọi được API login).
2. Handler tự check `{username, password}` so với `"admin"` cố định + password lưu trong
   `ctx.credentials` (ref `ADMIN_PASSWORD`, seed mặc định `"12345678"` lúc boot lần đầu nếu
   chưa có — tái dùng NGUYÊN route `/api/v1/credentials` đã có ở Phase 4 để đổi mật khẩu
   sau này, không cần route riêng).
3. Đúng → gọi `ctx.connection.authenticatedUrl(baseUrl)`, trả `{redirectUrl}` cho FE.
4. FE nhận `redirectUrl`, làm `window.location.href = redirectUrl` — browser tự hoàn tất
   đổi cookie qua đúng cơ chế gốc của dsh, không đụng gì vào phần lõi.
5. `GET /api/v1/auth/status` — route THƯỜNG qua `ctx.connection.fetch.register()` (như mọi
   route khác), tự nhiên 401 khi chưa có cookie, 200 khi có — FE dùng để biết trạng thái
   đăng nhập, không cần đoán.
6. SPA shell: sửa `ui.ts` để **luôn** serve `index.html` (bỏ gate `authorizeIndex` khỏi
   việc serve HTML) — chỉ API vẫn khoá. Đây là thay đổi tư thế bảo mật đã được xác nhận ở
   trên, không phải chi tiết ngầm.
7. Logout: route nhỏ set cookie hết hạn ngay (ghi đè cùng tên cookie với `Max-Age=0`) — cần
   xác nhận thật tên cookie chính xác lúc code (README: "host-only... bind the normalized
   hostname plus port in both their deterministic name and signed payload" — tên cookie phụ
   thuộc host:port, phải đọc từ 1 lần boot thật, không đoán).

---

## Phase A — Auth bridge (backend, chưa có UI) — ĐÃ XONG, test thật

**File mới:** `packages/bundle-core/src/auth.ts` — `inject: ['webServer', 'connection',
'credentials']`. Không cần `Config` schema — username cố định `"admin"`, không có field
config nào (không lặp lại bug thiếu schema đã dính ở Phase 7's `audit.ts`, vì ở đây đơn
giản là không có config nào để khai báo).

**Việc đã làm:**
1. `apply(ctx)` (async): seed `ADMIN_PASSWORD` = `"12345678"` qua `ctx.credentials` nếu
   `describe()` báo chưa cấu hình — `await` trước khi đăng ký route, đảm bảo route login
   không bao giờ chạy trước khi password mặc định tồn tại.
2. `POST /api/v1/auth/login` qua `ctx.webServer.register()` (route thô — **bắt buộc**,
   không thể qua `ctx.connection.fetch.register()` vì route đó tự đòi cookie trước khi vào
   handler, gây vòng luẩn quẩn "chưa login thì không gọi được API login"). Check
   username/password bằng `timingSafeEqual` (đồng nhất với `n8n.ts`), đúng thì gọi
   `ctx.connection.authenticatedUrl(`http://${req.headers.host}`)` — dùng `req.headers.host`
   thật, không hardcode, vì cookie bind theo đúng authority browser đang dùng (xác nhận qua
   giải mã payload cookie thật: `{"authority":"127.0.0.1:3099",...}`).
3. `POST /api/v1/auth/logout` qua `ctx.webServer.register()` — đọc cookie tên
   `dsh-auth-*` (prefix xác nhận thật từ header `Set-Cookie` thật, không đoán) từ chính
   request, echo lại với `Max-Age=0` để hết hạn — không cần biết thuật toán hash tên cookie
   của dsh.
4. `GET /api/v1/auth/status` qua `ctx.connection.fetch.register()` bình thường — vào được
   tới handler nghĩa là cookie đã hợp lệ, trả `{ok: true}`.
5. Sửa `ui.ts`: route serve `index.html` chỉ gọi `authorizeIndex` khi URL có `?token=`
   (giữ nguyên hành vi mint-cookie-redirect cho đường token thật); mọi request khác — kể cả
   không cookie, cookie hết hạn — được serve `index.html` thẳng, không 401 nữa. Lý do kỹ
   thuật: `authorizeIndex` tự ghi `res` toàn bộ ngay khi trả `false` (401 hoặc redirect),
   không có cách nào "bỏ qua false rồi serve tiếp" mà không ghi đè `res` hai lần — nên phải
   tránh gọi nó hoàn toàn ở nhánh không-token thay vì cố đọc kết quả của nó.

**Test thật đã chạy (boot thật, không giả lập):**
- Root `/` không cookie/token → `200` + HTML thật (trước đây `401`) — SPA shell công khai
  đúng như quyết định.
- `/api/v1/model` không cookie → vẫn `401` — API vẫn khoá đúng, không bị ảnh hưởng bởi thay
  đổi ở `ui.ts`.
- Login sai mật khẩu → `401` rõ ràng; login đúng mật khẩu mặc định `12345678` (fresh boot,
  chưa từng set) → `200` + `redirectUrl` chứa ĐÚNG token thật đang in trong boot log.
- Theo `redirectUrl` bằng curl thật → `303`, cookie thật được set; `GET
  /api/v1/auth/status` sau đó → `200`; `GET /api/v1/model` sau đó → `200` (không còn 401).
- Đổi `ADMIN_PASSWORD` qua route `/api/v1/credentials` **có sẵn từ Phase 4** (không viết
  route riêng) → login bằng mật khẩu cũ fail đúng, mật khẩu mới work đúng; xác nhận
  `ADMIN_PASSWORD` KHÔNG lộ trong `GET /api/v1/credentials` (route đó chỉ liệt kê 4 ref cố
  định của Phase 4, không phải toàn bộ credential store — đúng ý muốn, tránh hiện nhầm
  trong bảng "Model & credentials").
- Logout → cookie bị xoá khỏi cookie jar thật (`Max-Age=0` có hiệu lực), gọi API sau đó
  → `401` lại.
- **Restart thật** sau khi đã đổi mật khẩu → seed KHÔNG ghi đè mật khẩu đã đổi (login bằng
  mật khẩu mới vẫn work sau restart) — xác nhận seed chỉ chạy khi thật sự chưa cấu hình.

**Definition of Done — đạt:** toàn bộ luồng login/status/logout/đổi-mật-khẩu/restart đã
chạy thật qua curl, không phải suy luận từ code.

---

## Phase B — Design tokens & primitives (Tailwind) — ĐÃ XONG, build sạch + test thật

**Việc đã làm:**
1. Đọc thật `theme.css` (174 dòng, biến `--fh-*`) + lướt `style.css` (2373 dòng, chỉ lấy
   giá trị pixel/token của button/input/auth-card, không port nguyên class) — cả 2 file
   đọc trực tiếp, không đoán.
2. `apps/web/app/globals.css`: định nghĩa toàn bộ token màu/shadow/radius/font bằng CSS
   custom property thật (giá trị y hệt bản gốc, chỉ gộp 2 tầng `--fh-*`→`--color-*` alias
   của họ thành 1 tầng vì lý do fallback của họ — theme.css từng là plugin tải riêng, có
   thể load fail — không áp dụng ở đây, file compile thẳng vào bundle), rồi `@theme inline`
   để Tailwind sinh class thật tham chiếu biến CSS (không tĩnh hoá giá trị lúc build) — xác
   nhận qua chính CSS xuất ra: `.bg-accent{background-color:var(--color-accent)}`, đúng ý
   để light/dark đổi được lúc runtime.
3. Viết lại 5 primitive (`button.tsx`, `input.tsx`, `icon-button.tsx`, `menu-item.tsx`,
   `selectable-card.tsx`) bằng Tailwind, khớp đúng pixel/radius/padding thật đọc từ
   `style.css` (ví dụ: `.fh-btn-raised` cao 38px bo tròn 999px → `h-[38px] rounded-full`).
   Thêm `lucide-react` vào `apps/web/package.json` (đúng version example-2 dùng).
4. Port `useTheme.ts` gần như nguyên văn — một chỗ đổi thật cần thiết: khởi tạo
   `systemDark` qua `useEffect` thay vì lazy `useState` initializer, vì app này là Next.js
   static export (prerender lúc `next build` chạy trước khi có `window`, gọi
   `matchMedia` ngay trong initializer sẽ throw) — khác biệt kỹ thuật thật, không phải
   tuỳ tiện đổi.

**Test thật:** `next build` sạch (xác nhận cách sửa SSR-safety ở trên đúng — nếu sai sẽ
fail ngay lúc prerender); kiểm tra trực tiếp file CSS xuất ra có đúng class Tailwind tham
chiếu biến runtime như mong đợi.

---

## Phase C — Màn login — ĐÃ XONG, build sạch + test thật đầy đủ

**Việc đã làm:**
1. `components/login-form.tsx` dựa theo `ConnectForm.tsx` — bỏ hẳn email/register, chỉ còn
   username/password, kèm `ThemeToggle` góc phải trên (giống bố cục
   `.fh-auth-screen-controls` gốc).
2. Thêm `getAuthStatus`/`login`/`logout` vào `lib/api.ts`.
3. `page.tsx`'s `Home()`: gọi CẢ HAI hook (`useQuery` auth-status, `useSearchParams`)
   KHÔNG ĐIỀU KIỆN trước mọi nhánh `return` — tránh đúng lỗi rules-of-hooks (số hook gọi
   phải giống nhau mọi lần render của cùng 1 instance; nếu early-return trước
   `useSearchParams()` chỉ trong nhánh loading/lỗi, số hook sẽ đổi khi query chuyển trạng
   thái). `isLoading` → `LoadingScreen` (spinner nhỏ, tránh flash form login — đúng lý do
   example-2 tự sửa qua `authCheckPending`); `isError` (401) → `LoginForm`; ngược lại → app
   như cũ theo đúng `?view=`/`?session=` hiện có trên URL (không mất context vì phải login,
   giống hành vi gốc).
4. Thêm nút "Log out" trong `SessionPicker`'s header (gọi `logout()` rồi reload `/`).

**Test thật đã chạy (`pnpm run dev` thật, không giả lập, curl xác nhận):**
- Root `/` không auth gì → `200` + HTML chứa đúng file CSS mới build.
- `POST /api/v1/auth/login` với mật khẩu mặc định `12345678` (seed tự động) → `200` +
  `redirectUrl` chứa đúng token thật đang chạy.
- Dừng server cũ (còn sót từ phiên trước, chiếm cổng 3080) trước khi chạy bản mới — xác
  nhận không có xung đột cổng sau khi dọn.

**Definition of Done — đạt:** toàn bộ chuỗi build (Tailwind token → primitive → login form
→ auth gate trong `page.tsx`) chạy sạch và phục vụ được qua HTTP thật. Còn lại: xác nhận
bằng mắt thật trong trình duyệt (màu sắc/bo góc/spacing đúng ý) — cần người dùng tự mở
`pnpm run dev` và nhìn, không có cách nào Claude Code tự chụp màn hình để so sánh.

---

## Phase D — Sidebar & layout khung — ĐÃ XONG, build sạch + boot thật

**Giảm phạm vi so với bản gốc (ghi rõ, không giấu):**
- Danh sách session KHÔNG có search/rename/xoá/gom-nhóm-theo-ngày như
  `HistoryChat.tsx` thật — những tính năng đó cần route backend mới
  (`PATCH`/`DELETE /api/v1/sessions`) chưa tồn tại; danh sách hiện tại chỉ dùng lại
  `GET /api/v1/sessions` sẵn có (chỉ session **live**, giới hạn cũ từ Phase 2, chưa đổi).
- CHƯA có mục "Skills" trong sidebar — để dành cho Phase H khi có `SkillsDialog` +
  route backend thật đi kèm, tránh 1 nút chết không làm gì.
- Bỏ hẳn `onOpenDataAnalysis`/`ProjectHub` (đã ghi trong "Ngoài phạm vi" từ đầu).

**Việc đã làm:**
1. `lib/use-layout-columns.ts` — port thuật toán 2-cột + hằng số breakpoint/rail-width/
   expanded-width từ `App.tsx` nguyên giá trị (1024px/56px/280px).
2. `components/sidebar.tsx` — brand row, nút "+ New chat", danh sách session (dùng lại
   `listSessions()` có sẵn), toggle collapse-to-rail, footer `AccountMenu`.
3. `components/account-menu.tsx` — port từ `AccountMenu.tsx`, bỏ email (chỉ còn "Admin"
   cứng), giữ nguyên kỹ thuật portal-to-body (tránh `overflow:hidden` của sidebar cắt popup)
   — **phát hiện thật cần sửa thêm**: `createPortal(..., document.body)` cũng cần guard
   `mounted` (chỉ render sau khi client mount) vì `document.body` không tồn tại lúc Next.js
   prerender lúc `next build` — cùng loại lỗi SSR-safety đã gặp ở `useTheme.ts` (Phase B),
   không phải lỗi mới lạ.
4. Tái cấu trúc `page.tsx`: `SessionPicker` cũ (trang riêng) bị thay bằng `AppFrame` —
   sidebar giờ LUÔN hiển thị (kể cả lúc xem Settings/Automations, chúng render trong CHÍNH
   cột giữa của khung thay vì thay thế toàn trang) — giống đúng bố cục app chat thật, khác
   với cách cũ (mỗi `?view=` là 1 trang riêng biệt không sidebar).

**Test thật đã chạy:** `next build` sạch (xác nhận prerender không vỡ vì
`document.body`/`localStorage`); boot thật qua `pnpm run dev`, login thật, xác nhận HTML
trả về đúng cấu trúc mới.

**Còn cần xác nhận bằng mắt (Claude Code không tự làm được):** thật sự resize browser qua
1024px xem sidebar tự thu/phóng đúng, và click thử "+ New chat"/chuyển session/mở Settings
từ sidebar mới.

---

## Phase E — Settings dialog — ĐÃ XONG, build sạch + boot thật + test API thật

**Khác với dự kiến ban đầu (ghi rõ):** dự kiến chỉ 2 khu vực (model/credentials +
"đổi mật khẩu"); thực tế làm 3 tab rõ ràng (giống cấu trúc nav-rail thật của
`SettingsDialog.tsx`) — **General** (theme light/dark, dùng lại `useTheme()` từ Phase B qua
`SelectableCard`), **Model & credentials** (nhúng nguyên `SettingsModels` không đổi logic),
**Account** (mục mới — đổi mật khẩu admin + nút Log out). Không có tab "Profile"/email như
bản gốc — đúng quyết định đã chốt (không có identity theo user, chỉ 1 admin cứng).

**Việc đã làm:**
1. `components/settings-models.tsx` — bỏ wrapper trang cũ (`mx-auto max-w-lg p-8` + tiêu đề
   H1 + link "← back to chat", vốn dành cho route `?view=settings` riêng biệt của Phase D)
   để component này nhúng được thẳng vào bất kỳ container nào; xác nhận lại bằng mắt số
   lượng thẻ `<div>` mở/đóng sau khi sửa — cân bằng đúng (1 `<div>` bọc ngoài ở dòng đầu
   `return`, đóng ở dòng cuối, 2 `<section>` con giữ nguyên) — không có lỗi JSX lệch thẻ như
   nghi ngờ ban đầu.
2. `components/settings-dialog.tsx` (mới) — mask + panel căn giữa màn hình
   (`min(720px,92vw)` × `min(520px,80vh)`, bo góc 24px, `shadow-fh-lv3`), nav rail 180px bên
   trái dùng `MenuItem variant="nav"`, 3 tab như trên. Kích thước/bo góc/shadow lấy đúng giá
   trị thật từ `.fh-settings-*` trong `style.css` (đã đọc ở đầu phase này).
3. "Đổi mật khẩu admin" gọi thẳng `setCredential('ADMIN_PASSWORD', newPassword)` — hàm có
   sẵn từ Phase 4, không cần route backend mới; xác nhận qua `gateway.ts`'s
   `POST /api/v1/credentials` chấp nhận MỌI ref hợp lệ POSIX (không giới hạn ở
   `KNOWN_CREDENTIAL_REFS`, danh sách đó chỉ giới hạn những gì `GET` trả về không cần query),
   nên `ADMIN_PASSWORD` ghi được dù không nằm trong danh sách hiển thị ở tab Model.
4. `page.tsx`: bỏ nhánh `view === 'settings'` render `SettingsModels` trực tiếp trong cột
   giữa (thiết kế cũ của Phase D); thay bằng `<SettingsDialog open={view === 'settings'} ...>`
   render đè lên toàn khung (`fixed inset-0`) — cột giữa quay lại hiển thị
   session/EmptyState/Automations như bình thường phía sau lớp mask. Đóng dialog điều hướng
   về `/?session=<id>` (nếu đang có session) hoặc `/`.

**Test thật đã chạy (không chỉ `tsc`/`next build`):**
- `pnpm --dir apps/web run typecheck` sạch, `next build` sạch (prerender không vỡ).
- Dừng server cũ chiếm cổng 3080, boot lại bằng `pnpm run dev` (phát hiện thêm: máy có
  nhiều bản Node qua `nvm`, bản mặc định trên PATH là v21 — dưới ngưỡng 22 script tự kiểm
  tra — phải `nvm use 22` trước khi chạy; không phải lỗi code, chỉ là môi trường shell).
- `curl` toàn bộ chuỗi auth thật qua HTTP: `/` public 200 không cần cookie; login sai mật
  khẩu → 401; login đúng (`admin`/`12345678`) → nhận `redirectUrl`; đổi lấy cookie thật qua
  `GET /?token=...` (303, `Set-Cookie: dsh-auth-...`); `GET /api/v1/auth/status` có cookie →
  200, không cookie → 401.
- Test đúng luồng UI mới của tab Account: `POST /api/v1/credentials` với cookie đổi
  `ADMIN_PASSWORD` sang giá trị mới → mật khẩu cũ (`12345678`) bị từ chối, mật khẩu mới đăng
  nhập được → đổi lại về `12345678` (giữ đúng mặc định đã tài liệu hoá trong README) →
  `POST /api/v1/auth/logout` xoá đúng cookie (`Max-Age=0`) → `status` sau đó trả 401.
- `curl` index.html + toàn bộ chunk JS `/_next/static/...` mà nó tham chiếu — tất cả 200.

**Còn cần xác nhận bằng mắt (Claude Code không tự làm được):** mở dialog thật trong trình
duyệt, chuyển 3 tab, xem theme picker đổi sáng/tối đúng ngay lập tức, resize modal ở màn
hình hẹp (≤400px) xem có tràn ngang không.

---

## Phase F — Automations restyle — ĐÃ XONG, build sạch

Chỉ đổi className, không đụng logic/route backend (`listAutomations`,
`listAutomationExecutions` giữ nguyên 100%). Áp đúng token đã lập ở Phase B thay cho
`neutral-*`/`blue-*`/`green-*`/`red-*` mặc định của Tailwind: `border-border`, `bg-surface`,
`text-fg`/`text-muted`, `text-status-success`/`text-error`, `bg-bg-hover`. Đồng thời bỏ luôn
header "← back to chat" (cùng lý do đã ghi ở Phase E: sidebar giờ là khung cố định, trang
này giờ render thẳng trong cột giữa của `AppFrame`, không còn là route riêng nữa).

**Test thật đã chạy:** `pnpm --dir apps/web run typecheck` + `next build` sạch.

---

## Phase G — i18n đa ngôn ngữ — ĐÃ XONG, build sạch + boot thật

**Phạm vi ngôn ngữ:** Việt + Anh (giữ đúng mức tối thiểu đã ghi — không hỏi lại người dùng vì
đang ở chế độ "tiếp tục hết đi", chọn mặc định hợp lý và ghi lại quyết định ở đây thay vì
dừng hỏi).

**Việc đã làm:**
1. Đọc thật `i18n/locale.tsx` (89 dòng) + `translations.ts` (413 dòng) của example-2 trước
   khi port (chưa từng đọc trước phase này) — xác nhận cơ chế: 1 `LocaleContext` dùng chung
   (KHÔNG phải hook độc lập như `useTheme.ts`, vì text phải đổi đồng thời ở nhiều component
   đang mount cùng lúc), mặc định luôn `'vi'` bất kể ngôn ngữ trình duyệt (quyết định sản
   phẩm rõ ràng của bản gốc, giữ nguyên).
2. `lib/i18n/translations.ts` (mới) — bảng dịch RIÊNG cho app này, viết lại từ đầu theo đúng
   chuỗi thật đang có trong code (không copy nguyên text tiếng Việt/Anh của example-2 — app
   khác, string khác, họ có register/email/projects/data-analysis/skill-menu mà app này
   không có). `en` gõ kiểu `Record<TranslationKey, string>` — thiếu 1 key ở `en` là
   `tsc` báo lỗi ngay, đã thật sự dùng thuộc tính này của TypeScript (không chỉ quy ước).
3. `lib/i18n/locale.tsx` (mới) — port `LocaleProvider`/`useLocale()`/`t()` gần như nguyên
   bản, 1 khác biệt SSR-safety: state mặc định `'vi'` được set NGAY trong `useState`, đọc
   `localStorage` chỉ trong `useEffect` sau mount (không phải trong initializer như bản gốc
   — bản gốc là Vite SPA, không có prerender; app này export tĩnh, `LocaleProvider` nằm ở
   gốc cây và bị Next chạy trong lúc `next build` không có `localStorage` thật) — cùng lớp
   lỗi SSR-safety đã gặp ở `useTheme.ts` (Phase B) và `AccountMenu.tsx` (Phase D). **Đã cân
   nhắc và bỏ** một thiết kế "chặn render tới khi hydrate xong" (trả `null` khi chưa đọc xong
   localStorage) vì `LocaleProvider` bọc toàn bộ app trong `layout.tsx` — làm vậy sẽ làm
   trắng cả trang, không chỉ 1 dòng chữ, tới khi effect chạy xong; chấp nhận độ trễ 'vi' ->
   giá trị đã lưu y hệt cách `useTheme.ts` đã chấp nhận cho `systemDark`.
4. `components/language-select.tsx` (mới) — dropdown thật 2 lựa chọn (không phải nút toggle
   — chọn đúng ngôn ngữ đang dùng phải là no-op, không phải lật ngược, giống lý do thật của
   bản gốc).
5. Wire `useLocale()`/`t()` vào TẤT CẢ component có text hiện có: `login-form.tsx`,
   `theme-toggle.tsx`, `sidebar.tsx`, `account-menu.tsx`, `settings-dialog.tsx` (cả 3 tab),
   `settings-models.tsx`, `automations.tsx`, `conversation.tsx`, `composer.tsx`,
   `approvals.tsx`, `page.tsx`'s `EmptyState`. `LanguageSelect` đặt cạnh `ThemeToggle` ở màn
   login, và trong tab General của Settings (đúng vị trí bản gốc đặt nó).
6. `layout.tsx` — bọc `<LocaleProvider>` quanh `<QueryProvider>` ở gốc cây.

**Lỗi thật gặp và đã sửa khi build:** mọi import `../lib/i18n/locale` ban đầu viết có đuôi
`.tsx`/`.ts` (theo thói quen từ `packages/bundle-core` — package đó chạy bằng Node's
`--experimental-strip-types`, BẮT BUỘC có đuôi) — `apps/web`'s `tsconfig` (bundler resolution
chuẩn của Next.js) thì NGƯỢC LẠI, cấm đuôi `.tsx`/`.ts` trong import path
(`TS5097`) — đã bỏ đuôi ở toàn bộ 14 file bị ảnh hưởng, `tsc --noEmit` sạch sau đó. Đây là
khác biệt cấu hình giữa 2 package trong cùng repo, không phải lỗi logic.

**Test thật đã chạy:** `pnpm --dir apps/web run typecheck` + `next build` sạch (xác nhận
`LocaleProvider`'s SSR-safety fix hoạt động, không vỡ prerender); dừng server cũ, boot lại
bằng `pnpm run dev`, `curl` lại toàn bộ chuỗi login (`admin`/`12345678` → `redirectUrl` →
200) để xác nhận đổi `page.tsx`/`layout.tsx` không làm hỏng luồng auth đã xác nhận ở Phase
A/C/E.

**Còn cần xác nhận bằng mắt:** mở trình duyệt thật, đổi ngôn ngữ ở màn login và trong
Settings > General, xác nhận toàn bộ UI đổi chữ đồng thời (không có chỗ nào còn tiếng Anh
cứng bị bỏ sót).

---

## Phase H — SkillsDialog — ĐÃ XONG, build sạch + boot thật + route thật đã test

**Việc đã làm:**
1. Đọc type declaration thật của `@deepseek-ai/dsh-skill@0.1.5-rc.2` (đã resolve sẵn trong
   `node_modules` — kiểm tra thật trước khi pin, đúng bài học "peer dependency version" đã
   dính ở Phase 6) — xác nhận `SkillRegistry.list(options?: SkillViewOptions):
   Promise<SkillSummary[]>`, `SkillSummary` gồm `name`/`description`/`whenToUse?`/
   `invocation: {modelInvocable, userInvocable}`/`source`/`provider` — KHÔNG có `content`
   (đó là `SkillDefinition`, chỉ trả về từ `ctx.skills.get(name)`, không expose route nào cho
   nó vì dialog này chỉ xem, không sửa).
2. Thêm `@deepseek-ai/dsh-skill: 0.1.5-rc.2` vào `dependencies` gốc — đúng version thật đã
   resolve, không phải `0.1.5-rc.1` (dùng cho các package CLI khai báo trực tiếp).
3. `gateway.ts` — thêm `'skills'` vào `inject`, thêm route `GET /api/v1/skills` trả
   `{ skills: await ctx.skills.list() }` — qua đúng `ctx.connection.fetch.register()` như mọi
   route khác (cần cookie thật, không phải route public).
4. `lib/api.ts` — thêm `SkillSummary`/`SkillInvocationPolicy` type + `listSkills()`.
5. `components/skills-dialog.tsx` (mới) — CÙNG vỏ dialog với `SettingsDialog` (mask+panel
   720×520, nav rail 180px) nhưng ĐƠN GIẢN HƠN bản gốc `SkillsDialog.tsx` của example-2 (134
   dòng, có form tạo/sửa/xoá skill riêng của user qua `skillsApi.ts` CRUD đầy đủ) — bản của
   ta CHỈ XEM: rail liệt kê tên skill, panel bên phải hiện chi tiết
   (description/whenToUse/source/provider/2 cờ invocation) đọc thẳng từ `SkillSummary`, không
   có ô nhập liệu nào — đúng phạm vi đã chốt ("model tự dùng qua tool call `skill`, dialog chỉ
   hiển thị thông tin").
6. `sidebar.tsx` — thêm mục "Skills" (icon `Sparkles`) giữa danh sách session và
   `AccountMenu`, mở qua `?view=skills` (cùng cơ chế `?view=` với Settings).
7. `page.tsx` — gộp `closeSettings` thành `closeOverlay` dùng chung cho cả `SettingsDialog`
   và `SkillsDialog` (cả 2 đều đóng về lại session hiện tại hoặc `/`).
8. i18n: thêm đủ khoá `skills.*`/`sidebar.skills` vào `translations.ts` (Phase G's bảng dịch),
   dialog dùng `useLocale()` như mọi component khác.

**Test thật đã chạy (xác nhận dữ liệu thật trước khi thiết kế UI, đúng yêu cầu ban đầu của
phase này):** `curl` `GET /api/v1/skills` sau khi login → trả `{"skills":[]}` — **danh sách
rỗng thật**, vì composition hiện tại (`cordis.patch.yml`) chỉ mount `cordis-ui`/`cordis-auth`/
`cordis-gateway`/`cordis-audit`, không có provider skill nào (`dsh-skill-filesystem`) được
đăng ký — không phải lỗi, là trạng thái thật của deployment này. UI đã thiết kế xử lý đúng
case này (`skills.empty` hiển thị khi rỗng) thay vì giả định luôn có dữ liệu mẫu.
Route cũng xác nhận đúng gate qua cookie thật: không cookie → 401, có cookie → 200.
`pnpm install` (thêm dependency mới) + `pnpm --dir packages/bundle-core exec tsc --noEmit` +
`pnpm run build` (cả 2 package) sạch; dừng server cũ, boot lại bằng `pnpm run dev` — **boot
thành công với `inject: [...,'skills']` mới** (không có lỗi "waiting for service: skills"),
xác nhận `@deepseek-ai/dsh-skill` thật sự cấp `ctx.skills` cho composition này dù không
provider nào đăng ký catalog.

**Còn cần xác nhận bằng mắt:** mở dialog Skills thật trong trình duyệt xem empty-state hiển
thị đúng; nếu sau này có provider skill được mount (vd. thêm `dsh-skill-filesystem` vào
`cordis.patch.yml`), xác nhận panel chi tiết hiển thị đúng khi danh sách không rỗng — chưa
test được case này vì môi trường hiện tại không có skill nào để chọn.

---

## Ngoài phạm vi (multi-tenant-only của example-2, KHÔNG port)

- `ProjectHub`/data-analysis flow (`packages/flow/data-analysis`, gắn với hệ project của
  họ, không liên quan single-user).
- `AccountMenu.tsx` multi-account switcher (chỉ có 1 admin, không cần).
- Toàn bộ chế độ **register** (đã chốt: không có register).
- WebSocket transport (`packages/transport`) — giữ nguyên SSE + REST đã có, đã kiểm chứng
  hoạt động tốt, đơn giản hơn.

---

## Định nghĩa hoàn thành tổng thể

Mỗi phase test thật riêng (như đã ghi ở từng phase) theo đúng convention của
`cordis-agent-implementation-plan.md` (boot thật, curl/click thật, không chỉ build sạch).
Phase A là nền — không phase B-H nào nên bắt đầu trước khi Phase A test thật xong (mọi màn
UI sau đó đều cần route login/status hoạt động để dev/test được).

**Cả 8 phase đã hoàn thành** (2026-09-16). Tổng kết những gì CHƯA làm/còn giới hạn, để
không ai hiểu nhầm đây là sản phẩm multi-tenant đầy đủ như example-2:
- Danh sách session: không search/rename/xoá/gom nhóm theo ngày (Phase D) — cần route
  `PATCH`/`DELETE /api/v1/sessions` mới.
- SkillsDialog: chỉ xem, không tạo/sửa/xoá skill của user (Phase H) — và ở deployment hiện
  tại, danh sách skill đang RỖNG THẬT vì chưa mount provider nào (`dsh-skill-filesystem`)
  trong `cordis.patch.yml`.
- Không có `ProjectHub`/data-analysis, không có multi-account, không có register — đều là
  quyết định phạm vi đã chốt từ đầu, xem "Ngoài phạm vi" ở trên.
- Xác nhận bằng mắt trong trình duyệt thật (resize, click từng luồng, theme/ngôn ngữ đổi
  đồng thời) chưa làm được — Claude Code không có cách tự chụp màn hình so sánh; cần người
  dùng tự mở `pnpm run dev` và kiểm tra.

---

# Đợt 2 (2026-09-16) — Khung chat tổng, vị trí Skills trong sidebar, giống hoàn toàn hơn

Yêu cầu: "Check lại UI UX cho khung chat tổng và sidebar về skill cũng như các UI chat lên
plan update cho giống hoàn toàn đi". Đã đọc lại TOÀN BỘ file thật của example-2 chưa từng
đọc kỹ trước đây — `Sidebar.tsx` (183 dòng), `AccountMenu.tsx` (111 dòng), `HistoryChat.tsx`
(448 dòng), `Conversation.tsx` (781 dòng) — cùng phần CSS thật tương ứng trong
`style.css`. Kết quả: nhiều khác biệt thật, một số chỉ là restyle, một số cần khả năng
backend MỚI (đã tìm và xác nhận tồn tại thật trong `node_modules`, chưa mount).

## Phát hiện quan trọng nhất: `@deepseek-ai/dsh-session-title` đã có sẵn, chưa dùng

`core/`'s `node_modules` đã resolve sẵn (transitive, kiểm tra thật bằng
`pnpm-lock.yaml`/`node_modules`) 3 package: `dsh-session-title` (0.1.5-rc.2),
`dsh-session-title-llm`, `dsh-session-title-first-prompt-llm`. Đọc type declaration thật xác
nhận:
- `ctx.sessionTitle.get(session)` — đọc title hiện tại (fold từ log, không cần DB riêng).
- `ctx.sessionTitle.rename(session, title)` — **API rename THẬT**, throw
  `SessionTitleInvalidError` nếu title rỗng sau khi chuẩn hoá — append một event log-only
  `session/title` với `source: 'user'`, PIN title (tự động sinh dừng lại sau đó).
- `ctx.sessionTitle.refresh(session, signal?)` — sinh lại title (fallback nếu không có
  provider, hoặc gọi provider đã đăng ký).
- Cơ chế tự động: fallback (vài từ đầu tin nhắn user đầu tiên, giống hệt
  `historyChat.untitled`/logic "first words" của example-2) LUÔN chạy; nếu mount thêm
  `dsh-session-title-first-prompt-llm` (hoặc `-llm`), model tự đặt title hay hơn sau đó — Y
  HỆT cơ chế 2 tầng "fallback rồi provider" mà `HistoryChat.tsx`'s comment mô tả
  (`source: 'fallback' | 'provider'`).

**Điều này đổi hẳn đánh giá khả thi của "rename" trong "Ngoài phạm vi" cũ ở trên** — rename
KHÔNG cần tự chế cơ chế lưu trữ mới, chỉ cần mount plugin có sẵn + 1 route mới.

**Xoá session (`DELETE`) — ĐÃ ĐIỀU TRA THÊM, kết luận: KHÔNG có API xoá thật.** Đọc toàn bộ
type declaration công khai của `@deepseek-ai/dsh-session-persistence` (service trừu tượng,
`ctx.sessionPersistence`) VÀ backend cụ thể `@deepseek-ai/dsh-session-persistence-jsonl`
(`JsonlSessionPersistence`, lưu file JSONL trên đĩa — chính là backend thật đang dùng cho
`DSH_HOME`) — cả 2 chỉ có đúng 5 method public: `create`, `open`, `flush`, `stat`, `list`.
**Không có `delete`/`remove`/`unlink` ở bất kỳ đâu** — bản thân thiết kế là "append-only,
never rewritten" (ghi rõ trong chính doc-comment của package), xoá không nằm trong hợp đồng
của service này theo THIẾT KẾ, không phải thiếu sót tạm thời. `ctx.sessions` (live-only,
`SessionStore`) cũng chỉ có `list()`/`get()`, không có xoá.

Lựa chọn duy nhất còn lại để "xoá" thật sự file JSONL là tự ý `fs.unlink()` trực tiếp vào file
mà `dsh-session-persistence-jsonl` quản lý, BỎ QUA hoàn toàn service — vi phạm write-lease/
tracking nội bộ của nó (rủi ro làm hỏng state khác đang chạy, không có cách an toàn để biết
file đó có đang bị 1 write-lease nào giữ hay không từ bên ngoài service). Đây là loại "backend
hack không được hỗ trợ" nên KHÔNG tự làm mà không hỏi lại người dùng trước.

**Streaming thời gian thực — CÓ khả năng thật, chưa dùng:** `dsh-agent`'s
`'agent/assistant-stream'` event (kiểu `AssistantStreamFrame`: `start`/`chunk`/`end`, cùng
`StreamChunk` shape với `dsh-llm`) là "process-local live assistant streaming publication" —
tách biệt hoàn toàn với log bền (`SessionEventMap` của `dsh-session` KHÔNG có
`assistant/chunk` — khác hẳn wire protocol tự chế của example-2). Hiện `gateway.ts`'s
`/session-stream` chỉ forward `ctx.on('session/event', ...)` (log đã commit) — CHƯA subscribe
`agent/assistant-stream`, nên chat của ta hiện KHÔNG stream từng token, chỉ hiện tin nhắn khi
đã hoàn tất cả turn.

## Phase I — Sidebar: đúng vị trí Skills + search + rename thật + xoá thật — ĐÃ XONG

**Việc đã làm (backend, `gateway.ts`):**
1. Xác nhận thật `session-title`/`session-title-llm` ĐÃ được mount sẵn (kế thừa từ
   `dsh-base` qua `dsh-web-app`, không package nào trong đó bị patch của ta đụng tới) bằng
   `dsh --profile cordis-app --dump-config` thật — KHÔNG cần thêm dependency hay row patch
   nào cho auto-title, chỉ cần thêm `'sessionTitle'` vào `inject` để dùng `ctx.sessionTitle`.
2. `GET /api/v1/sessions` — thêm `createdAt` (từ `session.header.createdAt`) và `title`
   (từ `ctx.sessionTitle.get(session)?.title`, fold trong bộ nhớ, không I/O thêm).
3. `POST /api/v1/session-rename` (mới) — `{sessionId, title}` → `ctx.sessionTitle.rename()`.
   **Route đặt tên theo hậu tố động từ** (`/session-rename`, `/session-delete`), KHÔNG phải
   `PATCH`/`DELETE` như dự kiến ban đầu — phát hiện thật lúc code:
   `ctx.connection.fetch.register()`'s `ConnectionFetchMethod` CHỈ nhận `'GET' | 'HEAD' |
   'POST'` (đọc từ `dsh-client-connection`'s `rpc.d.ts`), không có PATCH/DELETE — đúng quy
   ước sẵn có của `/session-interrupt`/`/session-fork`, không phải REST thuần.
4. `POST /api/v1/session-delete` (mới) — điều tra thêm theo yêu cầu đã chốt, xác nhận
   `dsh-session-persistence`/`-jsonl` KHÔNG có API xoá (chỉ `create`/`open`/`flush`/`stat`/
   `list`) → thực hiện `fs.rm()` trực tiếp vào layout thật đã soi trên đĩa
   (`sessions/<cwd-bucket>/<sessionId>/` + `storages/session_projcache/sessions/
   <sessionId>.json`), tìm thư mục theo ĐÚNG TÊN session id (không tự dựng lại thuật toán
   escape cwd của dsh — undocumented, có thể đổi). Từ chối xoá session còn LIVE (409) vì
   `Agent.dispose()` cần `AgentHandle` gốc mà gateway không giữ lại — chỉ session đã idle
   (dsh tự hibernate) mới xoá được.

**Việc đã làm (frontend):**
5. `lib/api.ts` — `SessionSummary` thêm `createdAt`/`title`; thêm `renameSession()`/
   `deleteSession()`.
6. `components/history-chat.tsx` (mới) — port từ `HistoryChat.tsx` thật: nhóm theo ngày
   (Hôm nay/Hôm qua/7 ngày/30 ngày/Cũ hơn, dùng `createdAt` thay `updatedAt` — dsh không có
   `updatedAt` thật, xấp xỉ hợp lý vì danh sách chỉ có session live), popup "..." (đổi tên/
   xoá) portal-to-body giống `AccountMenu`, đổi tên inline (Enter xác nhận, Escape/blur huỷ,
   guard `isComposing` cho IME giống bản gốc). Giản lược so với bản gốc: không có
   `status`/`flow`/`projectId` (data model của ta không có các trường này).
7. `components/sidebar.tsx` — thêm nút search + ô input trong logo row (lọc client-side theo
   tiêu đề); **di chuyển `MenuItem` Skills** từ footer (vị trí đoán sai ở Phase H) lên ĐÚNG vị
   trí thật: ngay dưới "+ New chat", trên danh sách session; thay phần map session cũ bằng
   `<HistoryChat>`.
8. Thêm đủ khoá `sidebar.search`/`sidebar.searchPlaceholder`/`historyChat.*` vào
   `translations.ts` (vi+en).

**Test thật đã chạy (không chỉ build sạch):**
- `pnpm --dir packages/bundle-core exec tsc --noEmit` + `pnpm --dir apps/web run typecheck` +
  `pnpm run build` (cả 2 package) sạch.
- Boot thật, xác nhận `inject` mới (`sessionTitle`) không lỗi "waiting for service".
- `curl` toàn bộ luồng thật: tạo session → gửi 1 tin nhắn → `GET /sessions` thấy
  `title: null` trước, `title: "hello world this is a"` (fallback 5 từ, khớp
  `fallbackMaxWords: 5` thật của `dsh-base`) sau khi có tin nhắn đầu.
- `POST /session-rename` đổi thành công ("My renamed chat"), rename với title toàn khoảng
  trắng → 400 thật (`SessionTitleInvalidError`, không phải lỗi tự chế).
- `POST /session-delete` trên session ĐANG LIVE → 409 đúng như thiết kế; sau khi restart
  server (session không còn live) → xoá thành công, `find` xác nhận CẢ 2 file/thư mục
  (`sessions/.../<id>/`, `storages/session_projcache/sessions/<id>.json`) biến mất thật trên
  đĩa; gọi xoá lần 2 (đã xoá rồi) vẫn `200 {"ok":true}` (idempotent nhờ `force:true`); xác
  nhận session KHÁC (tạo từ trước) không bị đụng tới.

**Còn cần xác nhận bằng mắt:** mở sidebar thật, bấm search/gõ lọc, thử đổi tên inline, thử
nút "..." → Xoá (nút Delete này XOÁ THẬT trên đĩa — đã được người dùng xác nhận rõ ràng chấp
nhận, không phải ẩn giả).

## Phase J — Conversation: bỏ chrome kỹ thuật, tool-call pill thật, assistant không bubble — ĐÃ XONG

Người dùng phản hồi thật sau khi xem Phase I xong: "UI khung chat vẫn chưa giống và cũng như
markdown cung như route chat/" — 3 việc: khung chat (Phase J này), markdown (mục mới ngay dưới
Phase K), route `/chat/<id>` (mục mới sau đó). Cả 3 đã làm trong lượt này.

**Gap cụ thể (đối chiếu `Conversation.tsx` thật + CSS `.tool-pill`/`.bubble`/`.assistant-text`
đã đọc nguyên văn ở trên) — bản của ta (`conversation.tsx`, chưa restyle qua Đợt 1) đang
chính là kiểu "technical harness" mà example-2 CHỦ ĐỘNG bỏ đi:**
1. `turn/start`/`turn/end` hiện render `TurnBoundary` ("turn N started/ended") — bản thật
   KHÔNG render `turn/start` gì cả, `turn/end` chỉ render khi có lỗi hoặc lý do bất thường
   (không phải `'completed'`). Sửa: bỏ hẳn nhánh `turn/start`, chỉ push notice cho `turn/end`
   khi `reason.kind !== 'completed'`.
2. `tool/call`/`tool/result` hiện rơi vào `GenericEventLine` (`#seq type`, monospace debug) —
   cần viết lại thành `ToolPill` thật: 1 pill/tool-call, thu gọn mặc định, header
   icon+label+chevron (`Đang dùng {name}…`/`Đã dùng {name}`/`Lỗi khi dùng {name}` — 3 khoá
   này ĐÃ CÓ SẴN trong `translations.ts` từ Đợt 1, portable ngay), bấm mở ra xem
   args (JSON pretty) + result (đã `truncate` 500 ký tự). CSS thật: `border-radius:12px`,
   `background: bg-raised`, `border: border-subtle` (token mới, chưa có trong `globals.css`
   hiện tại — cần thêm `--color-border-subtle` đã có sẵn thật ở Đợt 1 nhưng CHƯA được dùng ở
   đâu — kiểm tra lại `globals.css` xác nhận biến tồn tại, chỉ chưa map Tailwind utility riêng
   cho nó ở lớp conversation), `tool-pill-detail` giới hạn `max-height: 320px` cuộn riêng.
3. `assistant/message` hiện render `MessageBubble` CÓ container (`bg-neutral-100`/dark
   variant, `rounded-lg`) cho CẢ 2 role — bản thật: user = bubble thật (`border-radius: 22px`,
   nền `--bubble-user`, `align-self: flex-end`, `max-width: 85%`), assistant = TEXT THUẦN
   không container, `max-width: 100%`, trái căn lề mặc định. Sửa `MessageBubble` tách 2 case.
4. **Markdown vs linkify — quyết định giữ khác biệt có chủ đích:** bản thật KHÔNG dùng thư
   viện markdown, chỉ 1 regex `linkify()` biến `[text](url)`/URL trần thành `<a>` — vì nội
   dung thật của họ (duckduckgo_web_search) chỉ cần link, không cần markdown đầy đủ. Bản của
   ta ĐANG dùng `react-markdown` cho assistant text (Phase 2, trước Đợt 1) — đây là lựa chọn
   TỐT HƠN cho agent-core (model có thể trả bảng/code-block markdown thật) nên **đề xuất GIỮ
   NGUYÊN react-markdown**, không hạ cấp xuống chỉ linkify — khác biệt có chủ đích, không phải
   thiếu sót, ghi rõ ở đây để không ai nhầm là bỏ sót.
5. **KHÔNG bỏ Approvals/nút Dừng (Stop)** — 2 thứ này KHÔNG tồn tại ở example-2 (họ không có
   khái niệm approval-gate hay agent tự chạy cần người duyệt tool call, không có nút huỷ giữa
   chừng) vì kiến trúc backend khác hẳn (không dùng `dsh-user-approval`). Đây là NĂNG LỰC THẬT
   của app này (Phase 2), KHÔNG xoá theo example-2 — chỉ cần restyle màu bằng design token
   (`Approvals.tsx` đang dùng `amber-*`/`green-*`/`red-*` thô, cần đổi sang
   `--color-status-*` đã có sẵn từ Đợt 1).

**Việc đã làm:** viết lại `conversation.tsx` — `buildEntries()` (thay `renderEvent`) tính lại
toàn bộ danh sách entry từ mảng `events` phẳng mỗi render (`useMemo`, không phải reducer tăng
dần như bản gốc — chưa cần vì Phase L (live streaming) chưa làm; state UI expand/collapse
riêng theo `Set<id>`), tương quan `tool/call`↔`tool/result` bằng `callId`/`toolCallId` thật
(đọc đúng field `dsh-session`'s `SessionEventMap`/`dsh-llm`'s `ToolResultBlock` thật, không
đoán). Bỏ hẳn `turn/start`, `turn/end` chỉ push notice khi `reason.kind !== 'completed'`.
`UserBubble` (22px radius, nền `--bubble-user`) tách khỏi `AssistantText` (không container,
full-width). `ToolPill` mới: header thu gọn (icon `Wrench` + label + chevron xoay khi mở),
`border-border-subtle`/`bg-bg-raised`/`rounded-xl`, chi tiết `max-height:320px` cuộn riêng,
`linkify()` cho text kết quả (port nguyên regex thật từ `Conversation.tsx`). Giữ nguyên
`react-markdown` cho `AssistantText` (quyết định đã ghi ở trên) nhưng styling markdown chính là
phần "markdown chưa giống" người dùng chỉ ra — xem mục ngay dưới. `Approvals.tsx`/`composer.tsx`
restyle bằng token + `Button` primitive thay vì `amber/green/red/blue` thô (gộp làm cùng lượt
vì cùng một mảng "khung chat" người dùng chỉ ra, không tách riêng thành Phase M/K nữa).

**2 lỗi thật bắt được nhờ soi dữ liệu event thật (không phải đoán):** gửi 1 tin nhắn thật qua
`POST /api/v1/session-messages` rồi đọc thẳng `GET /api/v1/session-events` (không qua UI) —
1. `user/message` không phải lúc nào cũng là tin người dùng gõ — dsh còn tự chèn thêm
   `user/message` khác cho ngữ cảnh runtime (`source.kind: 'plugin'`, ví dụ snapshot
   sandbox/approval policy từ `dsh-system-prompt`, thấy thật trong log: seq 9, dài cả đoạn dài
   "Current runtime context..."). Code TRƯỚC lượt sửa này không lọc theo `source.kind`, sẽ hiện
   luôn đoạn ngữ cảnh nội bộ đó như 1 bong bóng chat của người dùng. Sửa: chỉ nhận
   `user/message` khi `source.kind === 'user'` (hoặc không có `source`) — đúng cách
   `Conversation.tsx` thật của example-2 đã lọc từ trước.
2. **Lỗi có sẵn từ Phase 2 (trước cả Đợt 1), giờ mới phát hiện:** `system/message` (system
   prompt đầy đủ, seq 7 trong log thật — dài hàng nghìn ký tự) bị gộp CHUNG case với
   `user/message`/`assistant/message` trong code MVP ban đầu → render y hệt 1 tin nhắn chat
   bình thường, nghĩa là TOÀN BỘ system prompt nội bộ từng có thể hiện ra màn hình chat như lời
   assistant nói. `Conversation.tsx` thật của example-2 KHÔNG có case nào cho `system/message`
   cả (rơi vào default, bỏ qua) — sửa theo đúng vậy, bỏ hẳn `system/message` khỏi các case tạo
   bubble.

**Test thật đã chạy:** `tsc --noEmit` + `next build` sạch sau cả 2 lần sửa; gửi 1 tin nhắn thật
qua API và đọc lại events xác nhận đúng field/shape thật đang dùng (`source.kind`,
`toolCallId`, `reason.kind`) khớp với logic mới. **Chưa xác nhận bằng mắt trong trình duyệt**
— môi trường dev hiện tại chưa cấu hình API key model thật nên turn thật sự luôn lỗi ngay
("no API key for provider route") trước khi có tool-call/assistant reply nào để thấy
pill/bubble/markdown hiển thị — cần người dùng tự cấu hình 1 credential thật (qua Settings) rồi
thử 1 cuộc chat thật để xác nhận bằng mắt phần này.

## Markdown — styling thật (phát hiện mới, không nằm trong 8 phase + Phase I-M gốc)

**Gap thật:** `react-markdown` được dùng từ Phase 2 (trước cả Đợt 1) nhưng CHƯA BAO GIỜ có
`components` map — nghĩa là mọi thẻ (`h1`-`h3`, `ul`/`ol`, `code`/`pre`, `blockquote`, `table`,
`a`) render với CSS mặc định của trình duyệt, không theo design token nào của app, không có
dark-mode, nhìn "vỡ" so với phần còn lại — đây chính là phần "markdown" người dùng chỉ ra.

**Việc đã làm:** `components/markdown.tsx` (mới) — `components` map đầy đủ cho
`react-markdown@9`, mọi thẻ dùng token thật (`bg-bg-raised`/`border-border-subtle`/
`text-accent-text`/`text-muted`/...): heading margin/size theo cấp, list có `marker:text-muted`,
`code` inline (`bg-bg-raised` nhỏ, bo tròn) tách khỏi `pre > code` (block, không nền lặp lại,
phân biệt bằng className `language-*` mà `react-markdown` tự gắn cho code trong fence — cách
duy nhất đáng tin để phân biệt inline/block ở `components.code`), `pre` có border+bo góc+cuộn
ngang, bảng có border đầy đủ. `AssistantText` trong `conversation.tsx` giờ gọi
`<Markdown text={...} />` thay vì `<ReactMarkdown>` trần.

**Test thật đã chạy:** `tsc --noEmit` + `next build` sạch. **Chưa xác nhận bằng mắt** — cần 1
phản hồi thật của model có heading/list/code-block để thấy styling áp dụng đúng.

## Route `/chat/<sessionId>` thật (phát hiện mới, không nằm trong 8 phase + Phase I-M gốc)

**Gap thật:** app dùng `?session=<id>` (query string) từ đầu vì lý do đã ghi rõ lúc thiết kế
(`serveStatic()`/`dsh-host-frontend-static` "missing paths return 404" — không có SPA
fallback sẵn) — nhưng đây là giới hạn của SERVER, không phải giới hạn buộc phải giữ URL dạng
query mãi mãi. `ui.ts`'s route là plugin CỦA TA (`kind: 'prefix', path: ''`, khớp MỌI path),
nên ta hoàn toàn tự thêm fallback riêng mà không cần dsh hỗ trợ gì thêm — nhận định "route
segment sẽ 404 khi reload" ở đầu file này chỉ đúng nếu không tự thêm fallback, và giờ đã thêm.

**Việc đã làm:**
1. `ui.ts` — thêm 1 dòng rewrite TRƯỚC khi gọi `serveStatic()`: path không có phần mở rộng
   file (`extname(pathname) === ''`) và khác `/` được coi là app route, đổi thành `/` trước khi
   truyền vào `serveStatic()` — mọi asset thật (`_next/static/*.js`, `favicon.ico`,...) luôn có
   đuôi file nên không bị ảnh hưởng; `/api/v1/*` không đi qua route này (chúng được
   `ctx.connection.fetch.register()` khớp CHÍNH XÁC ở tầng ưu tiên cao hơn prefix `''`, đã xác
   nhận qua `ui.ts`'s comment gốc "exact table, then longest prefix, then fallback").
2. `lib/use-app-route.ts` (mới) — router client-side nhỏ tự viết, PHỎNG THEO đúng kỹ thuật thật
   của `App.tsx` (dùng `history.pushState`/`replaceState` + lắng nghe `popstate`), KHÔNG dùng
   router của Next (`app/chat/[id]/page.tsx` không khả thi với static export vì id session sinh
   lúc chạy, không thể `generateStaticParams` trước). SSR-safety: đọc `window.location` trực
   tiếp ngay trong initializer của `useState` (không qua `useEffect` như `useTheme`/
   `LocaleProvider`) — an toàn vì hook này chỉ được gọi từ `AppFrame`, mà `Home()` chỉ render
   `AppFrame` SAU KHI query auth-status đã settle; lúc `next build` prerender, query không bao
   giờ settle nên `AppFrame` không bao giờ thực sự chạy trong lúc prerender — đã xác nhận thật
   bằng `next build` chạy sạch (không throw `window is not defined`).
3. `page.tsx` — bỏ hẳn `useSearchParams()`/`useRouter()`/`Suspense` (không cần nữa), thay bằng
   `useAppRoute()`. Settings/Skills đổi thành state modal thuần client (`dialog`), KHÔNG còn
   nằm trong URL nữa — đơn giản hơn thiết kế cũ (`?view=`) vì đóng dialog không cần nhớ lại
   "quay về session nào", route bên dưới không hề đổi khi mở dialog. Automations tương tự,
   thành `centerView` state cục bộ (thứ này vốn không có UI trigger nào cả trước Đợt 2 — đã
   thêm luôn 1 mục "Automations" mới trong sidebar khi tiện sửa `Sidebar`, coi như dọn 1 lỗ
   hổng thật đã có từ trước, không phải yêu cầu của đợt này).

**Test thật đã chạy:** `curl` trực tiếp `GET /chat/<id-bất-kỳ>` (kể cả id giả) → 200, cùng
`<title>` với `/`; `GET /_next/static/does-not-exist.js` (đuôi file, không tồn tại) → vẫn 404
đúng như cũ; 1 chunk JS thật → vẫn 200; tạo session thật qua API rồi `GET
/chat/<session-id-thật>` → 200. Xác nhận SPA-fallback không phá vỡ asset thật lẫn API thật.

**Còn cần xác nhận bằng mắt:** mở trình duyệt thật, chuyển session xem URL đổi thành
`/chat/<id>`, bấm Back/Forward xem điều hướng đúng, F5 (hard refresh) ngay tại `/chat/<id>` xem
app boot lại đúng session đó.

## Phase K — Composer: auto-grow, Enter gửi, bỏ viền, biến thể màn hình trống — MỘT PHẦN

**Đã xong (mục 1, 2):** viết lại `composer.tsx` — card nổi bo góc 22px (`shadow-fh-md`,
`border-border`, cùng ngôn ngữ radius với bubble), textarea auto-grow thật (đo `scrollHeight`,
reset về `'auto'` trước khi đo lại để co lại được khi xoá chữ, xoá `style.height` hẳn khi rỗng
để CSS `min-height` là nguồn duy nhất — port đúng kỹ thuật + đúng lý do bug thật đã ghi trong
`Conversation.tsx` gốc), không border/outline (`border-none outline-none`), Send/Stop dùng
`Button` primitive (`variant="primary"`/`"outline"`) thay vì `bg-blue-600`/`border-neutral-300`
thô. `tsc --noEmit` + `next build` sạch.

**Gap còn lại (mục 3, CHƯA làm):**
3. **Biến thể "trống" (empty state) khác nhau về bản chất, không chỉ CSS:** bản thật hiện
   NGAY composer thật (to hơn, giữa màn hình) ngay cả khi CHƯA có session — gõ và Enter mới
   thật sự tạo session (tạo ngầm, `runtime.newSession()`/gửi tin nhắn gộp 1 bước). Kiến trúc
   của ta hiện tách rời: `EmptyState` chỉ có nút "+ New chat" (phải bấm tạo session trước,
   composer chỉ xuất hiện SAU khi có `sessionId`) — vì `/session-messages` route cần
   `sessionId` có sẵn, không có API "tạo session VÀ gửi tin nhắn đầu tiên trong 1 request".
   **Cần quyết định:** (a) giữ nguyên 2 bước (đơn giản, đã chạy đúng) chỉ restyle nút to hơn/
   giữa màn hình cho giống hình dáng, hoặc (b) làm composer thật xuất hiện luôn ở empty state,
   tạo session ngầm khi bấm Enter lần đầu (cần đổi `AppFrame`/`EmptyState` để gọi
   `createSession()` rồi `sendMessage()` nối tiếp trước khi điều hướng `?session=`) — (b) giống
   thật hơn nhưng đổi luồng điều hướng nhiều hơn, rủi ro cao hơn.

## Phase L — Streaming thời gian thực (nâng cấp thật, không chỉ restyle)

Dùng phát hiện `agent/assistant-stream` ở trên:
1. `gateway.ts`'s `/session-stream` route: bên cạnh `ctx.on('session/event', ...)` đã có,
   thêm subscribe `agent/assistant-stream` cho ĐÚNG agent của sessionId đang xem (khả năng cao
   qua `agent.on(...)` — pattern scoped-dispatch của cordis-scope, giống cách
   `agent.followup()`/`agent.cancel()` đã gọi trên đối tượng `Agent` cụ thể — **cần xác nhận
   thật cách đăng ký đúng khi code, chưa có ví dụ sẵn trong `core/` để tham chiếu**), forward
   frame `chunk` dạng SSE event mới (vd. `event: assistant-stream`) khi `chunk.type ===
   'text-delta'`.
2. Client: `use-session-stream.ts` thêm listener cho event mới, `store.ts` thêm state kiểu
   `liveBubbles: Map<string, string>` (giống hệt tên/thiết kế thật của example-2), khi
   `assistant/message` (event đã commit) tới thì xoá live bubble tương ứng khỏi map (đã có
   nội dung cuối cùng trong `events` rồi).
3. `conversation.tsx` render thêm các live bubble đang stream, dùng `assistant-text` style
   (không markdown khi đang stream dở — text có thể cắt giữa cú pháp markdown; chuyển sang
   `ReactMarkdown` khi commit xong, đúng cách 1 số chat app thật xử lý markdown-khi-stream).

**Rủi ro lớn nhất của Phase L:** đây là phần DUY NHẤT trong Đợt 2 động vào luồng dữ liệu real-
time thay vì chỉ UI — cần test thật bằng 1 phiên chat thật (không chỉ build sạch) trước khi
coi là xong, đúng convention rigor đã áp dụng cho Phase A/E/H.

## Quyết định đã chốt với người dùng (2026-09-16, sau khi đọc plan này)

1. **Auto-title:** Fallback + provider LLM — mount cả `dsh-session-title` (bắt buộc) và
   `dsh-session-title-first-prompt-llm` (title do model đặt sau tin nhắn đầu, chấp nhận tốn
   thêm 1 lần gọi model mỗi session mới).
2. **Composer ở empty state:** làm liền 1 bước như bản gốc — composer thật hiện ngay giữa màn
   hình kể cả khi chưa có session, Enter lần đầu tự tạo session ngầm rồi gửi tin nhắn luôn
   (đổi luồng điều hướng của `AppFrame`/`EmptyState`, chấp nhận rủi ro cao hơn phương án giữ
   2 bước).
3. **Xoá session:** người dùng chọn "điều tra thêm rồi làm cả Delete" — đã điều tra xong (xem
   mục ngay trên): **kết luận là không có API xoá thật** trong
   `dsh-session-persistence`/`dsh-session-persistence-jsonl`, chỉ có `fs.unlink()` trực tiếp
   (backend hack không an toàn, không tự làm mà không hỏi lại). **Cần hỏi lại người dùng một
   lần nữa, cụ thể hơn**, với phát hiện mới này, trước khi bắt tay vào Phase I.

## Thứ tự thực hiện

**I → J → K → M(restyle Approvals) → L**, theo mức rủi ro/độ chắc chắn tăng dần. Rename +
auto-title (Phase I) đi trước vì API đã xác nhận chắc chắn tồn tại; Delete chờ quyết định
cuối cùng ở trên trước khi đụng tới.

**Trạng thái (2026-09-16, sau phản hồi "UI khung chat vẫn chưa giống"):** I ✅, J ✅ (gộp cả
M vào — Approvals restyle làm cùng lượt), K một phần (auto-grow/border/nút ✅, lazy-session-
creation ở empty state CHƯA làm), markdown styling ✅ (phát hiện mới), route `/chat/<id>` ✅
(phát hiện mới). **Còn lại: K's mục 3 (composer 1-bước ở empty state) và Phase L (streaming
thời gian thực)** — cả 2 đều đổi luồng dữ liệu/điều hướng thật, chưa làm ở lượt này.

---

# Đợt 3 (2026-09-16) — Clone 2 plugin thật từ example-2 vào core

Yêu cầu: "trong model cài đặt bỏ model và khoá truy cập clone plugin
`example-2/packages/llm/openai-compat` và `example-2/packages/tool/serper-web-search` vào
core". Cả 2 package đã đọc TOÀN BỘ source thật trước khi port (không đoán), rồi đối chiếu
từng type/API với bản `@deepseek-ai/dsh-llm`/`@deepseek-ai/dsh-web` THẬT đã cài trong
`core/node_modules` (khác version với lúc example-2 viết: `0.1.1-rc.2` lúc đó vs `0.1.5-rc.1`/
`0.1.5-rc.2` ở đây) trước khi copy — không copy nguyên xi.

## `llm-openai-compat` — LLM adapter tổng quát cho mọi server OpenAI-compatible

**File mới:** `packages/bundle-core/src/llm-openai-compat/{index,adapter,serialize,sse,translate}.ts`
(giữ nguyên cấu trúc nhiều file như bản gốc, cùng 1 package `bundle-core`, không tách package
riêng — đúng quy ước "1 package, nhiều file plugin" đã có).

**1 lỗi API thật bắt được khi đối chiếu, đã sửa:** `translate.ts` dùng type `CallId` từ
`@deepseek-ai/dsh-llm` — type này KHÔNG TỒN TẠI trong bản đã cài (`0.1.5-rc.1`), đã đổi tên
thật thành `ToolCallId` (xác nhận bằng grep trực tiếp `.d.ts` thật, không đoán) — mọi field
khác (`GenerateOptions`, `StreamChunk`, `ContentBlock`, `Message`, `ctx.llm.registerAdapter()`)
khớp y nguyên, không cần sửa gì thêm.

**Đơn giản hoá có chủ đích so với bản gốc (ghi rõ, không giấu):** bản gốc dùng
`@deepseek-ai/dsh-launch-environment` (biến môi trường) làm nguồn cấu hình chính
(`baseURL`/`apiKeyEnv`/idle-timeout/extra-body), `ctx.credentials` chỉ là phụ. App này KHÔNG
có UI sửa biến môi trường nào cả (Settings chỉ sửa `ctx.credentials`) — nên bỏ hẳn
`dsh-launch-environment` (không thêm dependency mới), chuyển CẢ `baseURL` LẪN api key thành
credential ref thật (`OPENAI_BASE_URL`/`OPENAI_API_KEY`, mặc định `baseURL` là
`https://api.openai.com/v1`) — cả 2 sửa được qua CÙNG 1 màn Settings > Model & credentials
đã có sẵn, đúng ý người dùng yêu cầu ("cài đặt bỏ model và khoá truy cập"). Bỏ hẳn tính năng
`OPENAI_EXTRA_BODY` (advanced, không có UI để sửa) và cố định idle-timeout 120s (giá trị mặc
định gốc, không cho override nữa).

**Đăng ký:** `cordis.patch.yml` thêm row `cordis-llm-openai-compat` (provider mặc định
`openai-compat`, `apiKeyEnv: OPENAI_API_KEY`). `gateway.ts`'s `KNOWN_CREDENTIAL_REFS` thêm
`OPENAI_BASE_URL` (`OPENAI_API_KEY` đã có sẵn từ trước). `package.json` gốc thêm
`eventsource-parser@3.1.1` (dependency thật của `sse.ts`, đã resolve sẵn trong node_modules
trước đó, pin đúng version thật).

**Gap thật phát hiện thêm, đã sửa luôn:** `settings-models.tsx`'s ô chọn model là `<select>`
CHỈ nhận giá trị có sẵn trong catalog (`ctx.llm.listModels()`) — `llm-openai-compat` không
override `listModels()` (giống hệt bản gốc, ghi rõ "NOT verified" trong README gốc) nên
catalog LUÔN RỖNG cho provider này → không thể chọn model nào qua UI cũ, dù đã cấu hình đúng
credential. Sửa: đổi `<select>` thành `<input list="...">` (text input + `<datalist>` gợi ý từ
catalog khi có) — đúng tinh thần hợp đồng thật của `LlmAdapter.listModels()`'s doc-comment
("advisory... consumers must not turn absence into request rejection"), áp dụng cho MỌI
provider chứ không riêng openai-compat.

**Test thật đã chạy (không chỉ build sạch):**
- `tsc --noEmit` (bundle-core + web) + `next build` sạch sau khi sửa `CallId`.
- `dsh --profile cordis-app --dump-config` xác nhận đúng row `cordis-llm-openai-compat` với
  config thật.
- Boot thật sạch, không lỗi plugin.
- `GET /api/v1/model-providers` xác nhận `openai-compat` xuất hiện trong danh sách provider
  ĐANG LIVE (không chỉ "configurable") — nghĩa là `registerAdapter()` chạy thật thành công.
- `GET /api/v1/credentials` xác nhận `OPENAI_API_KEY`/`OPENAI_BASE_URL` cả 2 hiện đúng
  `configured:false, writable:true`.
- **Test end-to-end với request THẬT ra `https://api.openai.com/v1/chat/completions`** (dùng
  API key giả để không cần key thật): set model = `openai-compat`/`gpt-4o-mini`, set
  `OPENAI_API_KEY` = giá trị giả, gửi 1 tin nhắn thật → OpenAI trả về `401` thật →
  `turn/end` event ghi đúng `{code:"AUTH", status:401, message:"...401 Unauthorized"}` — xác
  nhận TOÀN BỘ luồng thật hoạt động: resolve credential → serialize request → fetch thật →
  map lỗi HTTP → propagate qua dsh-agent → hiện trong session log. Đã dọn lại (unset key giả)
  sau khi test xong.
- **Chưa test được:** phản hồi thật từ model (cần API key thật), tool-call streaming
  (`tool-call-delta`) — đúng như bản gốc, README gốc cũng ghi "NOT verified" mục này.

## `tool-serper-web-search` — nguồn tìm kiếm Google qua Serper.dev

**File mới:** `packages/bundle-core/src/tool-serper-web-search.ts` (1 file, đơn giản hơn
nhiều so với llm-openai-compat — chỉ đăng ký 1 search provider, không có tool riêng).

**Gap thật phát hiện khi điều tra (KHÔNG liên quan tới thay đổi này, có sẵn từ trước) — đã sửa
luôn để tính năng thật sự dùng được, không chỉ "đăng ký cho có":** `dsh --profile cordis-app
--dump-config` xác nhận `dsh-tool-web` (tool `web_search` model thật sự gọi) đang
`disabled: true` (do lớp patch của `dsh-web-app`, không phải do `core/` tự tắt) — nếu chỉ thêm
search-source mà không bật lại tool này thì model vẫn không có `web_search` để gọi, tính năng
coi như vô dụng dù đăng ký đúng. Đã thêm override trong `cordis.patch.yml`: bật lại
`tool-web` (`disabled: false`, restate nguyên `config` cũ) + đổi `web`'s `searchProvider` từ
`deepseek-official` (mặc định, cần `DEEPSEEK_API_KEY`) sang `serper`.

**Đơn giản hoá giống `llm-openai-compat`:** bỏ `dsh-launch-environment` fallback, chỉ dùng
`ctx.credentials` cho `SERPER_API_KEY`. Thêm `SERPER_API_KEY` vào `gateway.ts`'s
`KNOWN_CREDENTIAL_REFS`. `@deepseek-ai/dsh-web@0.1.5-rc.2` thêm vào `package.json` gốc (dùng
`WebError`/`WebSearchRequest`/`WebSearchResult` — đối chiếu type thật xác nhận khớp 100%,
KHÔNG có API drift nào giữa bản gốc viết và bản đã cài, khác với `llm-openai-compat`).

**Test thật đã chạy:** `tsc --noEmit` + `next build` sạch; `dump-config` xác nhận cả 2 row
override (`tool-web` bật lại, `web.searchProvider: serper`) và row insert mới đúng như patch;
boot thật sạch, không lỗi plugin (nếu `ctx.web`/`ctx.tools` thiếu gì đó `inject` sẽ yêu cầu
đúng, đã không xảy ra). **Chưa test được:** 1 lần gọi search thật (cần `SERPER_API_KEY` thật
VÀ 1 model thật gọi tool `web_search` — không có route REST nào trong `gateway.ts` để trigger
search trực tiếp mà không qua model, nên không kiểm chứng bằng curl thuần được như
llm-openai-compat) — cần người dùng tự cấu hình `SERPER_API_KEY` qua Settings rồi thử hỏi
agent 1 câu cần tra cứu web để xác nhận bằng thực tế.

## Cách dùng (cho người dùng)

1. Mở Settings > Model & credentials.
2. Chọn provider `openai-compat` ở ô đầu, gõ tự do model id ở ô thứ 2 (vd. `gpt-4o-mini`,
   `gpt-4.1`, hoặc bất kỳ model id nào server OpenAI-compatible đích hỗ trợ).
3. Cuộn xuống phần Credentials, đặt `OPENAI_API_KEY` = API key thật. Nếu không dùng OpenAI
   chính thức, đặt thêm `OPENAI_BASE_URL` = endpoint thật (vd. server tự host).
4. Đặt `SERPER_API_KEY` = key thật từ serper.dev nếu muốn agent tìm kiếm web thật (lấy free
   tier tại serper.dev).
5. Bấm "Save default model" — agent sẽ dùng route mới cho lần chat tiếp theo.

---

# Đợt 4 (2026-09-16) — Tái cấu trúc thư mục cho đúng convention của example-2

Yêu cầu: "hiện tại cấu trúc folder đang không ổn thì phải tham khảo cấu trúc model của
example 2 plugin như vậy mới ổn chứ tôi muốn llm, tool, skill 3 plugin này nằm ngoài cơ" —
2 plugin vừa clone (llm-openai-compat, tool-serper-web-search) đang nằm LỒNG bên trong
`packages/bundle-core/src/`, người dùng muốn chúng là package RIÊNG, độc lập, theo đúng
convention thư mục thật của example-2 (`packages/<nhóm>/<tên>`, vd `packages/llm/openai-compat`,
`packages/tool/serper-web-search`).

## Đã làm

1. **Di chuyển thật** (không copy) `packages/bundle-core/src/llm-openai-compat/*` →
   `packages/llm/openai-compat/src/*`, và `packages/bundle-core/src/tool-serper-web-search.ts`
   → `packages/tool/serper-web-search/src/index.ts`.
2. Mỗi package mới có `package.json`/`tsconfig.json`/`cordis.patch.yml` riêng, đúng shape
   example-2 dùng (`packages/<group>/<name>`) — NHƯNG khác 1 điểm có chủ đích (xem mục rủi ro
   dưới).
3. `pnpm-workspace.yaml` gốc chỉ có glob `packages/*` — KHÔNG nhận diện được thư mục nhóm 2
   cấp như `packages/llm/openai-compat`. Đã thêm glob `packages/*/*` (copy đúng nguyên văn
   comment + giải thích thật từ `pnpm-workspace.yaml` CỦA example-2, dự án đó cũng dùng đúng
   2 dòng glob này).
4. `bundle-core`'s `package.json`/`src/index.ts`/`cordis.patch.yml` — bỏ 2 export/insert-row
   của 2 plugin đã chuyển đi; GIỮ LẠI override `tool-web`/`web` (quyết định sản phẩm thuộc về
   bundle app-level, không phải package tái sử dụng — đúng cách example-2 tách 2 việc này).
5. `deploy/entrypoint.sh` — thêm 2 package mới vào `dependencies` (link:) và `dsh.profile.bundles`.
6. `deploy/core.Dockerfile` — copy + build thêm 2 package mới (trước đây build image sẽ THIẾU
   2 package này nếu không sửa).
7. Root `package.json`'s `build`/`typecheck` script — build/typecheck cả 2 package mới trước
   bundle-core.

## Rủi ro thật đã lường trước và tránh (KHÔNG copy y nguyên cách example-2 khai dependencies)

`bundle-core`'s package.json CÓ SẴN 1 comment ghi rõ 1 lỗi thật TỪNG gặp trong CHÍNH repo này:
"pnpm's hoisted linker tạo ra 1 bản sao node_modules THẬT RIÊNG cho bất kỳ dependency nào khai
trực tiếp trên 1 workspace package, gây lỗi TypeScript duplicate-identity (2 đường dẫn
`@deepseek-ai/dsh-session` khác nhau cho CÙNG 1 version)". example-2's OWN package.json
(`packages/llm/openai-compat/package.json`) LẠI khai `@deepseek-ai/dsh-llm`/`dsh-credentials`/
`dsh-launch-environment` làm `devDependencies` trực tiếp — cách đó ổn cho HỌ nhưng đã từng gây
lỗi thật cho REPO NÀY. Quyết định: **2 package mới KHÔNG khai bất kỳ `@deepseek-ai/dsh-*` nào
trực tiếp** (chỉ `peerDependencies: cordis`, đúng y hệt cách `bundle-core` đã làm an toàn từ
đầu) — mọi thứ (`dsh-llm`, `dsh-credentials`, `dsh-web`, `eventsource-parser`) tiếp tục khai
Ở ROOT `package.json` (đã có sẵn từ Đợt 3), resolve qua Node's plain upward directory-walk
xuyên qua root node_modules đã hoisted — same mechanism, không đổi. Đây LÀ khác biệt có chủ
đích so với example-2, ghi rõ trong `comment_dependencies` của cả 2 package.json mới.

## Lỗi thật thứ 2 gặp khi test (khác hẳn, không liên quan dependency): `dsh plugin install` tự
## động XOÁ bundle chưa từng qua `dsh plugin add`

Sau khi sửa `entrypoint.sh` để ghi thẳng `bundles` array gồm cả 5 bundle (kể cả 2 package mới)
vào profile's `package.json`, rồi gọi `dsh plugin --profile cordis-app install` — kết quả THẬT
(kiểm tra bằng `cat` lại file ngay sau khi chạy): **`install` tự ý xoá 2 entry mới khỏi
`bundles`**, chỉ giữ lại 3 bundle cũ — dù file mới ghi rõ ràng có cả 5. Test cô lập từng bước
xác nhận: `dsh plugin --profile cordis-app add "<tên package>"` (lệnh CHÍNH THỐNG, đúng như
gợi ý trong thông báo lỗi gốc "create it with 'dsh plugin ... add <package>'") mới thực sự làm
dsh "biết" và tin tưởng bundle đó — sau khi `add` cả 2 package mới đúng 1 lần, các lần
`install` sau đó mới giữ nguyên `bundles` đầy đủ. Kết luận: tự tay sửa mảng `bundles` trong
`package.json` KHÔNG đủ để dsh coi 1 bundle là hợp lệ — phải đi qua `add` trước ít nhất 1 lần.

**Sửa:** `entrypoint.sh` giờ gọi `dsh plugin --profile cordis-app add "<pkg>"` cho cả 3 package
của mình (bundle-core + 2 package mới) TRƯỚC khi gọi `install` — idempotent (chạy lại vô hại,
đã test thật gọi `add` 2 lần liên tiếp cho cùng 1 package không lỗi/không trùng lặp), nên chạy
mỗi lần boot không tốn kém gì đáng kể, và đảm bảo 1 `$DSH_HOME` HOÀN TOÀN MỚI (máy dev khác,
CI) cũng boot đúng ngay từ lần đầu — không chỉ đúng vì máy này đã có sẵn lịch sử `add` cũ.

## Test thật đã chạy

- `pnpm install` sau khi sửa `pnpm-workspace.yaml` → "Scope: all 5 workspace projects" (xác
  nhận pnpm nhận diện đúng 2 package nhóm mới).
- `tsc --noEmit` riêng từng package mới → sạch, KHÔNG có lỗi duplicate-identity (xác nhận
  chiến lược "không khai dependency trực tiếp" hoạt động đúng như dự đoán).
- `pnpm run typecheck`/`pnpm run build` ở root (đã update script) → sạch toàn bộ 5 package.
- **Test thật với `$DSH_HOME/profiles` bị XOÁ HOÀN TOÀN** (mô phỏng máy/CI hoàn toàn mới) →
  boot lại bằng `pnpm run dev` từ đầu → thành công, `dsh --dump-config` xác nhận cả
  `cordis-llm-openai-compat` và `cordis-tool-serper-web-search` xuất hiện đúng, kèm cả
  `tool-web`/`web` override vẫn đúng (thuộc `bundle-core`, không bị mất khi 2 plugin kia
  tách ra riêng).
- `GET /api/v1/model-providers` vẫn thấy `openai-compat` live; `GET /api/v1/credentials` vẫn
  thấy đủ 6 ref — xác nhận tái cấu trúc thư mục không làm mất bất kỳ hành vi thật nào đã
  verify ở Đợt 3.

## Còn lại (chưa làm, ghi rõ để không quên)

`packages/skill/` — người dùng nhắc tới "skill" như nhóm thứ 3 cùng llm/tool, nhưng CHƯA có
plugin skill cụ thể nào cần clone/tạo ở lượt này (không giống llm/tool, không có yêu cầu rõ
ràng nào cho 1 skill provider cụ thể) — thư mục nhóm này chưa tạo, để dành khi có plugin skill
thật cần thêm (vd. 1 skill-provider theo mẫu `dsh-skill-filesystem`), lúc đó áp dụng đúng
convention `packages/skill/<tên>` đã thiết lập ở đợt này.

---

# Đợt 5 (2026-09-16) — n8n tách package + toàn bộ hệ Skill (bundled + create + CRUD UI)

Yêu cầu: "Sao ko có skill move cả bộ skill và chức năng UI y hệt đi cũng như kiểm tra n8n sao
ko phải là 1 tool tách ra so vs core". 2 việc: (1) n8n cũng phải tách ra như llm/tool đã làm ở
Đợt 4, (2) clone TOÀN BỘ hệ skill của example-2 — nội dung skill có sẵn LẪN chức năng UI tạo/
sửa/xoá skill "y hệt" — không chỉ UI xem như Phase H đã làm.

## Phát hiện quan trọng: kiến trúc gốc ban đầu ĐÃ dự định tách sẵn

Đọc lại `docs/cordis-agent-architecture.md` (tài liệu thiết kế TỪ ĐẦU dự án, không phải viết
lại sau) xác nhận cấu trúc dự định ban đầu vốn đã là
`x-packages/plugin/{ui,gateway,llm-openai-compat,tool-n8n,audit}/` — MỖI plugin 1 package
riêng, không phải dồn hết vào 1 `bundle-core`. Việc dồn hết vào `bundle-core` lúc triển khai là
đi tắt so với thiết kế gốc — yêu cầu của người dùng ở Đợt 4-5 thực ra là ĐƯA VỀ ĐÚNG thiết kế
ban đầu, không phải một sở thích mới. (Khác biệt nhỏ: kiến trúc gốc dùng 1 tầng `plugin/` phẳng,
không chia `llm/`/`tool/`/`skill/` như example-2 — đã chọn theo đúng yêu cầu người dùng, tham
khảo cấu trúc example-2, không theo tài liệu kiến trúc gốc ở điểm này.)

## n8n → `packages/tool/n8n/`

Giống hệt cách làm với llm-openai-compat/tool-serper-web-search ở Đợt 4: di chuyển thật
(`packages/bundle-core/src/n8n.ts` → `packages/tool/n8n/src/index.ts`), package.json/tsconfig
riêng, không khai `@deepseek-ai/dsh-*` trực tiếp (cùng lý do tránh lỗi duplicate-identity).

**Khác biệt quan trọng với 2 package trước:** n8n vẫn giữ nguyên **opt-in**, KHÔNG auto-mount
mặc định — `Config.baseURL` là `required()` không có default hợp lý (mỗi deployment có n8n
instance khác nhau), quyết định thiết kế đã có từ trước (`cordis-agent-implementation-plan.md`
§8). Package vẫn được LINK vào profile's `dependencies` (để resolve được khi cần) nhưng KHÔNG
nằm trong `dsh.profile.bundles` mặc định. Cập nhật `docs/patch-cookbook.md`'s ví dụ 4
(`name: '@cordis-app/bundle-core/n8n'` → `'@cordis-app/tool-n8n'`) và
`deploy/docker-compose.yml`'s comment cho khớp tên package mới.

**Test thật:** boot từ `$DSH_HOME` hoàn toàn sạch → thành công; `dump-config` xác nhận n8n
KHÔNG xuất hiện trong composition mặc định (đúng thiết kế opt-in, không phải lỗi sót).

## Hệ Skill — bundled content + create_skill tool + CRUD UI thật

**1. Nội dung skill có sẵn (`packages/skills/`):** copy nguyên văn từ `example-2/packages/skills`
(6 skill: `business-case-builder`, `report-writing`, `skill-creator`, `sql-to-insights`,
`support-tone`, `web-research`) — xác nhận KHÔNG có nội dung nào gắn riêng với fox-harness
(không nhắc UI/backend riêng của họ), dùng được nguyên xi vì `web_search`/`bash` đều là tool
thật của app này. Không phải 1 package code (giống `packages/skills` gốc của example-2, chỉ có
`package.json`/`README.md` mô tả, không build).

**2. Mount `@deepseek-ai/dsh-skill-filesystem`:** 1 lỗi boot thật gặp phải: `insert:` 1 row mới
với `id: skill-filesystem` → boot fail thật `duplicate loader entry id: skill-filesystem` —
hoá ra `dsh-base` ĐÃ có sẵn row này (`disabled: true`, patch bởi `dsh-web-app`, cùng họ với
`tool-web`) — sửa bằng cách OVERRIDE row có sẵn (`disabled: false` + `config.bundledSkillDir`)
thay vì `insert:` — đúng bài học đã áp dụng cho `tool-web`/`web` ở Đợt 3, giờ lặp lại cho
skill-filesystem. Biến môi trường `CORDIS_BUNDLED_SKILL_DIR` thêm vào cả `scripts/dev.sh` và
`deploy/entrypoint.sh` (mặc định trỏ vào `packages/skills` thật), đọc qua `!!js
process.env.CORDIS_BUNDLED_SKILL_DIR` trong `cordis.patch.yml`.

**2b. Lỗi nội dung thật bắt được nhờ test thật (không phải đoán):** sau khi mount xong, `GET
/api/v1/skills` chỉ trả về 5/6 skill — thiếu đúng `business-case-builder`. Soi kỹ: description
của nó có cụm "Ví dụ: business plan..." — dấu hai chấm giữa chuỗi text KHÔNG được escape, mà
`dsh-skill-filesystem`'s frontmatter là YAML thô (`name: value`) nên `key: value` giữa dòng
gây lỗi parse thật (frontmatter YAML plain scalar không được chứa dấu hai chấm rồi khoảng
trắng giữa chuỗi — luật YAML thật, không phải bug của dsh). Sửa nội dung: đổi "Ví dụ:" thành
"Ví dụ như" (bỏ dấu hai chấm), giữ nguyên ý nghĩa. Xác nhận: watcher của `dsh-skill-filesystem`
(`watch: true` mặc định) tự phát hiện fix TRỰC TIẾP, không cần restart — `business-case-builder`
xuất hiện lại đúng sau khoảng 2-3 giây.

**3. `packages/tool/create-skill/`:** clone từ `example-2/packages/tool/create-skill`, ĐƠN
GIẢN HOÁ đáng kể so với bản gốc — bản gốc CHỈ validate (worker không biết user là ai, phải nhờ
browser lưu hộ qua route riêng của họ); app này single-admin, tool tự ghi thẳng
`$DSH_HOME/skills/<name>/SKILL.md` (đúng "user-dsh" root thật của `dsh-skill-filesystem`, xác
nhận bằng cách tự tay ghi 1 file test trực tiếp vào đường dẫn đó và thấy `source: "user-dsh"`
xuất hiện đúng qua API — kiểm chứng trước khi viết code tool, không đoán). Auto-mount mặc định
(không cần config).

**4. Route CRUD thật trong `gateway.ts`:** `GET /skill-content?name=`, `POST /skill-create`,
`POST /skill-update`, `POST /skill-delete` — dùng chung logic validate/ghi với tool (trùng lặp
có chủ đích khoảng 15 dòng thay vì thêm 1 dependency liên-package mới, theo đúng "đừng trừu
tượng hoá sớm"). `skill-update`/`skill-delete` đều kiểm `source === 'user-dsh'` trước khi cho
phép — test thật xác nhận: sửa/xoá 1 skill bundled (`report-writing`) → 400 "no editable skill
named...", không hề đụng tới file bundled.

**5. `SkillsDialog.tsx` viết lại toàn bộ theo đúng bố cục thật của example-2:** rail có "+ Tạo
skill mới", mục "Skill của tôi" (user-dsh, sửa được), mục "Skill có sẵn" (bundled, chỉ xem) —
panel bên phải là form Name/Description/Content + nút Lưu/Xoá cho skill của tôi, hoặc view chỉ
đọc cho skill có sẵn. Khác example-2: KHÔNG có khái niệm "của tôi" theo user (single-admin),
"của tôi" ở đây nghĩa là "user-dsh" (mọi skill do admin duy nhất tạo).

**Test thật đã chạy (đầy đủ, qua REST trực tiếp, không chỉ qua UI vì chưa có model thật để
gõ chat):**
- Tạo skill thật (skill-create) → GET /skill-content đọc lại đúng ngay; GET /skills
  list thấy sau khoảng 2-3s (độ trễ watcher thật, không phải lỗi).
- Sửa skill thật (skill-update) → nội dung đổi đúng, đọc lại xác nhận.
- Sửa/xoá skill KHÔNG PHẢI của mình (report-writing, bundled) → cả 2 đều bị chặn đúng, trả
  400 rõ ràng, KHÔNG đụng tới file bundled thật (xác nhận report-writing vẫn còn nguyên sau
  khi thử).
- Xoá skill thật (skill-delete) → biến mất khỏi GET /skills sau khoảng 2-3s, danh sách cuối
  cùng đúng lại 6 skill bundled ban đầu, không rơi rớt gì.
- tsc --noEmit + next build sạch toàn bộ 5 package backend + web; boot thật từ $DSH_HOME sạch
  hoàn toàn 2 lần (trước và sau khi sửa lỗi duplicate-id).

**Chưa test được:** tạo skill thật qua 1 cuộc chat thật với model (create_skill tool) — cần
API key thật, môi trường dev hiện tại chưa có; SkillsDialog UI mới cũng chưa xác nhận bằng mắt
trong trình duyệt thật.

---

# Đợt 6 (2026-09-16) — Model mặc định thật, tab Serper riêng, z-index thật, tái cấu trúc `components/`

## 1. Model mặc định dùng khoá thật của người dùng

Yêu cầu: "trong cài đặt vẫn chưa bỏ model và hãy dùng fix cứng ... này cho model mặc định" — người
dùng đưa key/base URL/model id THẬT (proxy OpenAI-compat riêng). Quyết định bảo mật quan trọng:
KHÔNG ghi secret thật vào bất kỳ file có commit git nào (không sửa default trong
`cordis.patch.yml`). Thay vào đó dùng đúng REST API mà chính Settings UI cũng gọi:
`POST /api/v1/credentials` (set `OPENAI_API_KEY`/`OPENAI_BASE_URL`) và `POST /api/v1/model`
(set model mặc định) — ghi thẳng vào `$DSH_HOME` (đã gitignore), giống hệt việc người dùng tự
gõ vào Settings. Xác nhận: giá trị này còn nguyên sau ít nhất 3 lần restart dev server
(`GET /api/v1/model` + `GET /api/v1/credentials` sau mỗi lần).

## 2. Tab "Web search" riêng cho SERPER_API_KEY

Yêu cầu: "SERPER API KEY cho web_search sẽ có 1 tab cho user add key trong cài đặt". Thêm tab
thứ 4 (`WebSearchTab`) vào `SettingsDialog` — field nhập key, dòng trạng thái đã cấu hình hay
chưa, link tới serper.dev. Đồng thời `settings-models.tsx`'s danh sách credential chung lọc bỏ
`SERPER_API_KEY` (`.filter(credential => credential.ref !== 'SERPER_API_KEY')`) để không bị
trùng 2 chỗ nhập cùng 1 key.

## 3. Bug thật: dropdown ngôn ngữ bị che sau dialog Settings

Người dùng báo: "dropdown đang index thấp quá chỉnh cao lên". Xác nhận đúng là bug thật (không
phải hiểu lầm): `LanguageSelect` portal thẳng vào `document.body`, cùng cấp DOM với
`SettingsDialog` (cũng portal, `z-[1000]`) — 2 popup portal-ed cùng `document.body` CẠNH TRANH
z-index trực tiếp (không phải cha-con). `LanguageSelect` cũ chỉ `z-50` → luôn bị `z-[1000]` của
Settings đè lên khi mở dropdown ngôn ngữ TRONG Settings. Sửa: nâng lên `z-[1100]` (cao hơn mọi
dialog). Xác nhận bằng cách rebuild sạch (`rm -rf .next out`) rồi grep đúng `z-[1100]` trong
bundle JS đã minify.

## 4. "Vẫn còn tab model và khoá truy cập" — điều tra kỹ, KHÔNG phải bug code

Người dùng báo vẫn thấy Serper key trong tab "Model & khoá truy cập". Kiểm tra lại toàn bộ:
đọc đúng source hiện tại của `settings-models.tsx` — filter `SERPER_API_KEY` VẪN ĐÚNG VÀ CÒN
NGUYÊN; xác nhận chỉ có 1 nơi render `<SettingsModels />` (trong `settings-dialog.tsx`); grep
thẳng vào bundle JS đã build lại — thấy đúng logic filter đã compile
(`SERPER_API_KEY"!==e.ref).map(...)`). Kết luận: đây là trạng thái cũ còn lưu trong bộ nhớ tab
trình duyệt (SPA đã load JS cũ từ trước khi fix), không phải lỗi trong code — khuyến nghị người
dùng reload cứng trang thay vì chỉ đóng/mở lại dialog.

## 5. Tái cấu trúc `apps/web/components/` theo đúng `features/<category>/` của example-2

Yêu cầu: "cấu trúc folder UI components đang chưa phân chia tham khảo example-2 mà làm" — trỏ
thẳng vào dòng `{tab === 'models' ? <SettingsModels /> : null}` trong `settings-dialog.tsx`
(dòng này vốn ĐÚNG, không có gì phải bỏ — 4 tab thật đã có General/Models/WebSearch/Account,
`models` là tab thứ 2 không phải tab thừa) — trọng tâm yêu cầu thực sự là cấu trúc thư mục
`components/` đang phẳng (14 file ngang hàng), chưa chia theo nhóm chức năng như
`example-2/packages/*/src/components/{features,primitives}/` thật.

**Đọc cấu trúc thật của example-2** trước khi làm (không đoán): `features/auth/`,
`features/conversation/`, `features/settings/`, `features/sidebar/`, `features/skills/`,
`features/projects/`, và `features/LanguageSelect.tsx` được đưa lên NGANG HÀNG với các nhóm
(không nằm trong nhóm nào) vì được dùng ở ≥2 nơi khác nhau (auth screen + settings) — áp dụng
đúng quy tắc này cho `LanguageSelect` của app (dùng ở `login-form.tsx` VÀ `settings-dialog.tsx`,
xác nhận bằng grep trước khi quyết định vị trí).

**Đã di chuyển (14 file, giữ nguyên `primitives/` phẳng vì example-2 cũng để phẳng):**
- `features/auth/`: `login-form.tsx`, `theme-toggle.tsx`
- `features/conversation/`: `conversation.tsx`, `composer.tsx`, `approvals.tsx`, `markdown.tsx`
- `features/settings/`: `settings-dialog.tsx`, `settings-models.tsx`
- `features/sidebar/`: `sidebar.tsx`, `account-menu.tsx`, `history-chat.tsx`
- `features/skills/`: `skills-dialog.tsx`
- `features/automations/`: `automations.tsx`
- `features/language-select.tsx` (ngang hàng, không vào nhóm nào — lý do ở trên)

**Bug thật bắt được nhờ `tsc --noEmit`, không phải đoán:** tính lại đường dẫn tương đối theo độ
sâu thư mục — file cũ `components/X.tsx` (sâu 1 cấp) dùng `../lib/...`; file mới
`components/features/<nhóm>/X.tsx` (sâu 3 cấp) phải dùng `../../../lib/...` (3 cấp), còn
`primitives/` (nằm ngay trong `components/`) chỉ cần `../../primitives/...` (2 cấp). Lần sửa
đầu tiên viết nhầm TOÀN BỘ các import `lib/*` chỉ với 2 cấp (`../../lib/...`) thay vì 3 — sai ở
10/14 file (chỉ `features/auth/*` viết đúng ngay từ đầu, và `features/language-select.tsx` đúng
vì nó nằm ở độ sâu 2, không phải 3). `tsc --noEmit` bắt lỗi CHÍNH XÁC toàn bộ
(`TS2307: Cannot find module '../../lib/...'`) — sửa lại đúng `../../../lib/...` cho 10 file đó,
`tsc --noEmit` sạch hoàn toàn ngay lần chạy tiếp theo.

**Test thật đã chạy (không chỉ tsc):**
- `pnpm --dir apps/web run typecheck` — sạch, 0 lỗi.
- `rm -rf .next out && pnpm --dir apps/web run build` — build production thành công, export tĩnh
  4 trang, kích thước bundle không đổi bất thường (55.6 kB route `/`, như trước khi tái cấu trúc).
- Restart dev server thật từ đầu (`./scripts/dev.sh`, sau khi kill cổng 3080) — boot sạch, build
  lại cả 5 package backend + web, log in `dsh web: http://127.0.0.1:3080/?token=...` không có lỗi.
- `curl` xác nhận: `/` → 200; `/chat/abc123` (route SPA ảo) → 200 (SPA-fallback rewrite trong
  `ui.ts` vẫn hoạt động đúng sau khi đổi cấu trúc import); `/favicon.ico` (không tồn tại) → 404
  (SPA-fallback không nuốt nhầm asset thật); `GET /api/v1/auth/status` không cookie → 401 đúng.
- Grep toàn bộ `apps/web` xác nhận KHÔNG còn file nào import theo đường dẫn cũ
  (`../components/conversation` v.v.) — `app/page.tsx` là nơi tiêu thụ duy nhất, đã sửa đủ cả
  8 dòng import.

**Chưa test được:** xác nhận bằng mắt trong trình duyệt thật rằng UI hiển thị y hệt sau khi tái
cấu trúc (đổi cấu trúc thư mục import không đổi hành vi runtime, nhưng vẫn cần xác nhận bằng mắt
theo đúng nguyên tắc đã áp dụng suốt tài liệu này); đăng nhập thật qua `/api/v1/auth/login` với
mật khẩu mặc định thất bại trong lần test này — nghi do state `$DSH_HOME` cũ đã có mật khẩu admin
khác 12345678 từ phiên làm việc trước (không liên quan tới thay đổi cấu trúc thư mục lần này,
chưa điều tra thêm vì ngoài phạm vi yêu cầu hiện tại).

---

# Đợt 7 (2026-09-16) — Bỏ hẳn tab Model & credentials; 2 lỗi thật ở flow tạo session mới

## 1. Bỏ HẲN tab "Model & credentials", không chỉ lọc nội dung

Người dùng lặp lại nhiều lần ("trong cài đặt vẫn chưa bỏ model", "check UI vẫn còn tab model
và khoá truy cập", rồi chọn đúng dòng `{tab === 'models' ? <SettingsModels /> : null}` và hỏi
"sao chưa bỏ đi", cuối cùng "vẫn còn cái tab model & credentials ấy UI th mà sao xoá mãi ko đc
thế"). Lần trước hiểu SAI phạm vi — chỉ lọc `SERPER_API_KEY` ra khỏi danh sách credential chung
trong tab đó, KHÔNG xoá cả tab. Ý định thật của người dùng (nhất quán xuyên suốt các lần nhắc):
model mặc định giờ là giá trị CỐ ĐỊNH do vận hành đặt (Đợt 6 §1), nên không cần bất kỳ picker
nào cho người dùng cuối chọn model/nhập khoá LLM nữa — cả tab phải biến mất.

Đã xoá thật: `type Tab` bỏ `'models'`; `MenuItem` nav cho tab đó; dòng render
`{tab === 'models' ? <SettingsModels /> : null}`; import `SettingsModels`/`SettingsIcon`; xoá
hẳn file `settings-models.tsx`; xoá các hàm client API chỉ mình nó dùng (`getModel`, `setModel`,
`listModelProviders`, `listModelCatalog` + 4 type liên quan) khỏi `lib/api.ts`; xoá các key i18n
chỉ mình nó dùng (`settings.modelsTab`, `models.defaultModel`, `models.currently`,
`models.selectProvider`, `models.selectModel`, `models.reasoningPlaceholder`,
`models.saveDefault`, `models.credentials`, `models.credentialsHint`, `models.setFrom`,
`models.notSet`, `models.newValuePlaceholder`, `models.readOnlyPlaceholder`, `models.save`) ở cả
2 ngôn ngữ — giữ lại đúng `models.remove` vì `WebSearchTab` (tab Serper) vẫn dùng chung key đó.
Backend (`gateway.ts`'s `/model`, `/model-providers`, `/model-catalog`, `/credentials` routes)
GIỮ NGUYÊN — đây vẫn là cách hạ tầng đặt model mặc định (Đợt 6 §1's REST call), chỉ là không còn
lối vào từ UI nữa.

**Test thật:** `tsc --noEmit` sạch; `rm -rf .next out && next build` sạch, bundle route `/` giảm
đúng từ 55.6kB → 54.1kB (bằng chứng thật là code đã bị cắt, không phải chỉ ẩn bằng CSS); grep
`out/` sau build xác nhận KHÔNG còn chuỗi "Model & credentials"/"Model & khoá truy cập" ở đâu cả
trong bundle đã compile; restart dev server thật (`./scripts/dev.sh`, Node 22 qua nvm) — boot
sạch. Đã giải thích cho người dùng: lần trước filter ĐÃ đúng trong code nhưng tab vẫn hiện vì
JS cũ còn chạy trong bộ nhớ tab trình duyệt — cần reload cứng (không chỉ đóng/mở lại dialog).

## 2. Flow tạo session mới — 2 lỗi thật, phát hiện qua đọc lại example-2's App.tsx

Người dùng: "Khung chat trung tâm và flow tạo session mới chỉ mở chưa có — check lại và thêm".
Đọc lại kỹ `example-2/apps/web/src/App.tsx` (không đoán) để so sánh hành vi thật của
"+ New chat" — 2 lỗi thật, không phải cảm nhận chủ quan:

**Lỗi 1 — session mới không hiện ngay trong sidebar.** `startNew()` trong `page.tsx` gọi
`createSession()` rồi `goToSession(newId)` nhưng KHÔNG BAO GIỜ invalidate query
`['sessions']` mà `Sidebar`/`HistoryChat` dùng — xác nhận thật bằng cách đọc toàn bộ
`page.tsx` không có `useQueryClient` nào được import. Kết quả: khung chat trung tâm "mở" đúng
session mới, nhưng sidebar không có gì mới cho tới khi có hành động khác (rename/xoá) vô tình
invalidate cache, hoặc reload cả trang. Sửa: `startNew()` giờ gọi
`queryClient.invalidateQueries({ queryKey: ['sessions'] })` ngay sau khi tạo xong.

**Lỗi 2 (liên quan) — tiêu đề session không bao giờ tự cập nhật sau khi có.** `dsh-session-title-llm`
ghi 1 sự kiện log-only thật tên `session/title` sau khi model sinh tiêu đề từ tin nhắn đầu (xác
nhận qua `.d.ts` của `@deepseek-ai/dsh-session-title` — `SessionTitleEventData`) nhưng
`useSessionStream.ts` (đã nhận đủ mọi event qua SSE) chưa từng invalidate `['sessions']` khi gặp
event này — sidebar kẹt ở "Untitled" mãi cho tới khi reload cả trang. Sửa: thêm nhánh
`if (event.type === 'session/title') queryClient.invalidateQueries({ queryKey: ['sessions'] })`
— cùng kiểu event-driven (không polling) như cách approval đã làm.

**Việc "thêm" theo đúng thiết kế thật của example-2:** đọc `App.tsx` thấy example-2 có hẳn 1 quy
tắc rõ ràng — `hasChatted`/`newSessionDisabled`: bấm "+ New chat" khi đang xem 1 session CHƯA hề
có tin nhắn thật nào là NO-OP (không tạo thêm session rác), tái dùng đúng session trống đang mở.
App hiện tại trước đây KHÔNG có quy tắc này — mỗi lần bấm đều tạo hẳn 1 session+agent thật mới ở
backend dù session trước đó còn trống, tích tụ dần các dòng "Untitled" vô nghĩa trong sidebar.
Thêm mới: hàm `hasRealUserMessage(events)` export từ `conversation.tsx` (dùng lại NGUYÊN
tiêu chí đã có sẵn trong `buildEntries`'s case `user/message`, không viết logic lệch đi ở nơi
thứ hai); `page.tsx`'s `AppFrame` tính `hasChatted`/`newSessionDisabled` từ đó, `startNew()`
no-op khi đang đứng ở 1 session trống; nút "+ New chat" trong `Sidebar` nhận thêm prop
`newSessionDisabled` → `disabled` + `title` tooltip giải thích tại sao (key i18n mới
`sidebar.newChatDisabled`, cả 2 ngôn ngữ). Khác example-2 có chủ đích: dùng `seq` (số thứ tự sự
kiện) làm tín hiệu "đã chat" bị loại ngay từ đầu sau khi kiểm tra thật — `POST /sessions` xong
`seq` đã bằng 3 (setup events, chưa có tin nhắn nào) chứ không phải 0, nên seq không đáng tin;
dùng đúng sự kiện `user/message` thật (giống cách `Conversation` tự hiển thị) đáng tin hơn.

**Test thật đã chạy (REST trực tiếp qua token dev của dsh, không qua UI vì chưa mở trình duyệt
thật):**
- `POST /sessions` → `GET /sessions` ngay sau đó: session mới xuất hiện đúng ngay cả trước khi
  sửa (xác nhận lỗi nằm ở cache phía client, không phải backend) — với fix, `invalidateQueries`
  đảm bảo React Query gọi lại đúng lúc này.
- `POST /session-messages` (tin nhắn thật, dùng đúng model/khoá đã fix cứng ở Đợt 6) → theo dõi
  `GET /session-stream` trực tiếp: xác nhận CÓ THẬT sự kiện `"type":"session/title"` phát ra
  giữa luồng; `GET /sessions` sau đó trả về `title: "Xin chào, hôm nay là"` — đúng luồng thật
  event `session/title` → cần invalidate mà trước đây thiếu.
- `tsc --noEmit` sạch; `rm -rf .next out && next build` sạch; restart dev server thật — boot
  sạch, không lỗi.

**Chưa test được:** hành vi no-op của nút "+ New chat" (logic thuần phía client, dựa đúng tiêu
chí đã dùng ở `Conversation`'s bubble rendering — chưa bấm thật trong trình duyệt để xác nhận
bằng mắt); phiên test tạo qua curl ở trên vẫn còn "live" (session sweep chưa idle) nên
`session-delete` bị từ chối đúng thiết kế (409) — để nguyên, không phải lỗi.

---

# Đợt 8 (2026-09-16) — Composer hiện ngay khi vào app, thu hẹp khung chat, đổi thương hiệu "Fox Harness"

Yêu cầu: "khi mở link và đăng nhập tôi cần khung chat có input hiện ra sẵn luôn như example-2
kia kìa chứ ko phải 1 nút ấn mở trò truyện và thu hẹp đoạn chat lại tham khảo của example-2 về
mặc UI và cũng như đổi tên thành Fox Harness". 3 việc, đọc lại đúng `example-2/apps/web/src/App.tsx`
và `Conversation.tsx`/`style.css` thật (không đoán) trước khi làm.

## 1. Không còn màn hình "bấm nút để bắt đầu"

Đọc `App.tsx` xác nhận: example-2 LUÔN kết nối 1 session "new" thật ngay khi tải trang/đăng nhập
xong (`connect(..., sessionIdFromUrl() ?? "new")`) — không có màn hình chờ bấm nút nào cả, input
đã sẵn sàng ngay. App hiện tại trước đây có `EmptyState` — trung tâm chỉ có 1 nút "+ New chat",
phải bấm mới thấy composer.

Sửa: `AppFrame` (`page.tsx`) thêm 1 `useEffect` tự gọi đúng logic tạo session (`startNew(true)`)
ngay khi route là `'home'` (chưa có `/chat/<id>`) — dùng `replaceState` (không phải
`pushState`, vì đây là app tự làm thay người dùng, không phải 1 cú bấm — đúng quy tắc thật của
`App.tsx`'s `replaceChatUrl`/`pushChatUrl`). Có ref guard chống việc effect chạy 2 lần (React
dev-mode double-invoke) tạo nhầm 2 session. `EmptyState` xoá hẳn, thay bằng `CenterLoading` (chỉ
hiện đúng khoảng thời gian chờ `POST /sessions` — network round-trip thật, không phải màn hình
chờ người bấm).

**Bug thật gặp khi sửa:** `startNew` giờ có tham số `replace`, nhưng `Sidebar`'s nút "+ New chat"
truyền thẳng `onNewSession={startNew}` làm `onClick` — React sẽ gọi `startNew(mouseEvent)`,
biến `mouseEvent` (object, luôn truthy) thành `replace`, khiến MỌI click nút cũng bị ép thành
`replaceState` (mất lịch sử Back/Forward, quay lại đúng lỗi loại đã từng gặp ở Đợt 2). Sửa bằng
bọc lại `onNewSession={() => { startNew() }}`.

## 2. Empty conversation = welcome heading + composer to hơn, không phải trang trắng

Đọc `Conversation.tsx`'s CSS thật (`.fh-conversation-root.fh-conversation-empty`,
`.fh-conversation-empty-heading`, `.fh-conversation-empty #send-form`/`#text-input`) — khi
session chưa có tin nhắn thật nào, thay vì log rỗng phía trên + composer nhỏ phía dưới, cả cột
căn giữa dọc: icon Bot (48px) + heading "Bắt đầu cuộc trò chuyện"/"Start a conversation", rồi
composer TO HƠN (font 1.05em, cao tối thiểu ~3 dòng, ít margin dưới hơn vì không dán đáy).

Sửa: `ChatView` (`page.tsx`) tính `isEmpty = !hasRealUserMessage(events)` (tái dùng đúng helper
đã export ở Đợt 7) — khi rỗng, render heading thay vì `<Conversation>`, và truyền
`large={isEmpty}` cho `Composer`. `Composer` thêm prop `large` điều chỉnh padding/font/chiều
cao textarea đúng theo 2 bộ giá trị CSS thật đọc được ở trên. Dọn dẹp luôn nhánh
"empty" cũ bên trong `Conversation` component (`entries.length === 0` → text "Chưa có tin
nhắn…") vì giờ không bao giờ còn chạy tới (page.tsx không còn render `<Conversation>` khi rỗng
nữa) — xoá code chết, xoá luôn key i18n `conversation.empty` không dùng nữa, thêm
`conversation.emptyHeading` đúng bản dịch thật của example-2 ở cả 2 ngôn ngữ. Cũng dọn key
`app.newChat` (chỉ `EmptyState` cũ dùng, giờ không còn nơi nào gọi).

## 3. Thu hẹp khung chat trung tâm — đúng 760px như example-2

Đọc thấy `#center-col > * { max-width: 760px; margin: 0 auto; width: 100%; }` trong style.css
thật — nội dung cột giữa (log hội thoại + composer) không bao giờ full-bleed hết chiều rộng, chỉ
tối đa 760px, luôn căn giữa. Sửa: bọc phần log+composer trong `ChatView` bằng
`mx-auto w-full max-w-[760px]` (giữ `Approvals` full-width phía trên, đúng vị trí nó có sẵn).

## 4. Đổi thương hiệu hiển thị "Cordis" → "Fox Harness"

Yêu cầu trực tiếp: "đổi tên thành Fox Harness". Đổi đúng 4 chỗ CÓ HIỂN THỊ cho người dùng (grep
toàn bộ `apps/web`, xác nhận đây là TOÀN BỘ, không sót): `app/layout.tsx`'s `<title>` (tab trình
duyệt), `Sidebar`'s tên thương hiệu cạnh icon Bot, `login.title` ở cả 2 ngôn ngữ (tiêu đề màn
đăng nhập). KHÔNG đổi tên package nội bộ (`@cordis-app/*` trong `package.json`, tên thư mục
`bundle-core`, tài liệu kiến trúc, ...) — đó là tên phát triển nội bộ, không hiển thị cho người
dùng cuối, đổi sẽ là 1 việc rename lớn không liên quan tới yêu cầu thật (chỉnh UI hiển thị).

**Test thật đã chạy:** `tsc --noEmit` sạch (bắt đúng lỗi key i18n thiếu nếu có, vì `en`
được gõ kiểu `Record<TranslationKey, string>` — xoá/đổi tên key ở `vi` mà quên `en` sẽ lỗi biên
dịch ngay, đã tự kiểm chứng bằng cách chạy lại sau mỗi lần sửa cả 2 ngôn ngữ); `rm -rf .next out
&& next build` sạch; grep `out/` sau build: 0 kết quả cho "Cordis", có kết quả cho "Fox Harness"
ở đúng `index.html`'s `<title>` + trong bundle JS; grep riêng bundle `page-*.js` xác nhận có mặt
`max-w-[760px]`, `"Start a conversation"`, và key `sidebar.newChatDisabled` — đúng 3 phần đã
thêm. Restart dev server thật (Node 22 qua nvm) — boot sạch, `GET /api/v1/sessions` qua token
dev vẫn hoạt động bình thường sau khi đổi.

**Chưa test được (đúng như mọi lần khác trong tài liệu này):** hành vi auto-create-on-landing và
layout welcome-composer là logic/CSS phía client thuần tuý — cần mở thật trình duyệt tại
http://127.0.0.1:3080/ để xác nhận bằng mắt (curl không chạy được JS phía client). Đề nghị người
dùng reload cứng trang (Cmd+Shift+R hoặc tương đương) trước khi kiểm tra, vì đã nhiều lần lỗi
"vẫn thấy cái cũ" hoá ra là do JS cũ còn chạy trong bộ nhớ tab, không phải do code sai.

---

# Đợt 9 (2026-09-16) — Check thật n8n: chưa từng chạy, quản lý ra sao, 1 bug thật tìm thấy + sửa

Yêu cầu: "n8n đã chạy chưa và chạy logic như thế nào quản lý như thế nào check lại". Không đoán —
dựng thật 1 n8n container, patch thật vào dev profile, gửi tin nhắn thật cho model gọi tool thật.

## 1. n8n CHƯA chạy — xác nhận thật

`docker ps` lúc kiểm tra: không có container n8n nào; `lsof` cổng 5678: không ai lắng nghe.
`deploy/docker-compose.yml` có định nghĩa service `n8n` nhưng dev hiện tại chạy qua
`./scripts/dev.sh` (không qua compose), và bản thân comment đầu file cũng ghi rõ: dù compose
`n8n` chạy, **tích hợp vẫn TẮT theo mặc định** — phải patch thêm 2 row mới bật.

## 2. Quản lý ra sao — opt-in, cần đúng 2 row, không phải 1

`@cordis-app/tool-n8n` (`packages/tool/n8n/`) **không nằm trong composition mặc định** —
`config.baseURL` bắt buộc, không có default hợp lý (mỗi deployment có n8n instance riêng).
Bật bằng cách insert **2 row** vào `cordis.patch.yml` (profile hoặc home tier, không phải file
git-tracked):
```yaml
- insert:
    - id: webhook-runtime
      name: '@deepseek-ai/dsh-webhook'   # thiếu row này boot fail thật: "waiting for service: webhookRuntime"
    - id: cordis-n8n
      name: '@cordis-app/tool-n8n'
      config: { baseURL, apiKeyEnv, webhookPath, webhookSecretEnv, webhookSource, routes }
```
Credential (`N8N_API_KEY`, `N8N_WEBHOOK_SECRET`) set qua `POST /api/v1/credentials` — không bao
giờ trong patch file. Mỗi `route.workspacePath` phải là thư mục có sẵn trước khi trigger lần đầu
(gotcha đã ghi trong `docs/patch-cookbook.md`, xác nhận lại đúng lần này).

## 3. Logic thật — test end-to-end với n8n thật, không giả lập

Dựng `docker run n8n:latest` (port 5678), tạo owner headless qua `POST /rest/owner/setup`, sinh
API key thật qua `POST /rest/api-keys` — không cần UI. Patch dev profile trỏ
`baseURL: http://127.0.0.1:5678`, restart — **boot thành công ngay lần đầu**, đúng như tài liệu
mô tả (2 row, không thiếu row nào).

**Chiều n8n → agent (webhook vào):**
- Thiếu header `x-n8n-webhook-secret` → 401. Header sai → 401 (sau khi set credential; TRƯỚC
  khi set credential trả 503 "secret unavailable" — đúng thiết kế, không phải bug). Header đúng
  + `workflowId` khớp `config.routes` → **202**, và xác nhận thật qua `GET /sessions`: 1 session
  MỚI được tạo, đúng `cwd` = `workspacePath` đã cấu hình, đúng `title` = `route.title`.
- Đọc lại `GET /session-events`: payload webhook nằm trong prompt đầu tiên với nhãn RÕ RÀNG
  "UNTRUSTED external data", `source.kind: 'webhook'`, `source.provider: 'n8n'` — đúng invariant
  "Model-visible means logged, input ngoài không được nhét thẳng vào prompt" (kiến trúc doc §1.3/§7.2).

**Chiều agent → n8n (tool ra):** gửi tin nhắn thật yêu cầu model dùng `n8n_list_workflows` +
`n8n_validate_workflow` — cả 2 tool gọi THẬT tới n8n, round-trip đúng (`n8n_get_workflow` với id
sai trả đúng lỗi 404 thật từ n8n; `n8n_list_workflows` trả đúng `{data: [], nextCursor: null}`
vì n8n instance mới tinh chưa có workflow nào).

## 4. Bug thật tìm thấy qua test này (không phải đoán) — đã sửa

`n8n_validate_workflow`/`n8n_upsert_workflow` liên tục fail "workflow must be a JSON object" dù
nội dung model gửi đúng cấu trúc — vì model (`hosted_vllm/Qwen3.5-35B-A3B-FP8` qua proxy thật
của người dùng) **double-encode**: gửi `workflow` như 1 CHUỖI chứa JSON, không phải object JSON
thật. Đào tới gốc: tham số `type: 'json'` trong `dsh-tools` là **"annotation-only"** — comment
gốc của chính dsh-tools: "the author-only json node becomes an annotation-only schema" — nghĩa
là schema THẬT gửi cho model không có `type` nào ràng buộc cả, model yếu dễ đoán sai thành string.

Sửa: thêm `coerceWorkflowArg()` trong `packages/tool/n8n/src/index.ts` — nếu giá trị đến là
string, thử `JSON.parse()` trước khi validate; áp dụng cho cả 2 tool. Test lại NGAY với đúng
model đó, đúng câu hỏi đó — model **double-encode y hệt lần nữa** (xác nhận hành vi lặp lại, có
thể tái tạo), nhưng lần này `n8n_validate_workflow` trả đúng `{"valid": true, "errors": []}`
thay vì lỗi như trước — xác nhận fix hoạt động, không phải may mắn model đổi hành vi.

**Test đầy đủ đã chạy:** `tsc` sạch cho `tool/n8n` riêng lẻ VÀ `pnpm run typecheck` sạch toàn bộ
repo sau fix; restart dev server thật 2 lần (trước và sau fix) — cả 2 lần boot sạch. Dọn dẹp sau
test: revert `cordis.patch.yml` (home tier) về `[]` — n8n vẫn giữ đúng trạng thái opt-in mặc
định, không có gì rò rỉ vào composition mặc định; xoá container `n8n-check`.

**Chưa test được:** `n8n_activate_workflow` (cần approval gate — chưa thử luồng approve/reject
thật qua UI) và `n8n_run_workflow` (cần 1 workflow có Webhook trigger node thật đã active) — 2
tool còn lại trong bộ 7 chưa đụng tới lần này vì ngoài phạm vi câu hỏi (chỉ cần xác nhận n8n có
chạy/logic ra sao, không cần vét cạn toàn bộ 7 tool).

---

# Đợt 10 (2026-09-16/17) — Bật n8n THẬT (không revert), test "chat để AI tạo flow" end-to-end

Yêu cầu: "sao lại tắt n8n bật lên và chạy đi vd tôi muốn chat cho AI tạo 1 flow thì sao". Khác
Đợt 9 (chỉ test rồi revert): lần này bật THẬT, giữ nguyên, và chứng minh đúng kịch bản người
dùng nêu — chat để model tự tạo workflow — chạy được thật, không giả lập.

## Hạ tầng persistent (khác container tạm ở Đợt 9)

`docker volume create cordis-n8n-data` + `docker run -d --name cordis-n8n --restart
unless-stopped -p 127.0.0.1:5678:5678 -v cordis-n8n-data:/home/node/.n8n
docker.n8n.io/n8nio/n8n:latest` — có volume + `--restart unless-stopped` nên sống qua reboot
host, khác hẳn container `n8n-check` dùng-rồi-xoá ở Đợt 9. Owner + API key vẫn tạo headless qua
`POST /rest/owner/setup` + `POST /rest/api-keys` (không cần UI). Patch 2 row (`webhook-runtime`
+ `cordis-n8n`) ghi thẳng vào `cordis.patch.yml` (home tier) và **giữ nguyên, không revert**.

## Bug thật thứ 2 tìm thấy (khác bug ở Đợt 9) — scope API key thiếu `tag:list`

Test lần đầu: model tự soạn workflow "Hello Cordis" → validate OK → `n8n_upsert_workflow` báo
`isError: true` với "Error: Forbidden". Đào tới gốc: workflow **ĐÃ được tạo thành công thật** ở
phía n8n (`n8n_list_workflows` sau đó thấy đúng nó) — lỗi Forbidden nằm ở bước gắn tag
`agent-generated` phía sau, vì API key mình tự tạo thiếu scope `tag:list` (khác `tag:read` —
2 scope riêng biệt trong n8n, xác nhận qua `GET /rest/api-keys/scopes` thật). Đây là lỗi setup
API key của mình, không phải bug code — nhưng code cũng có 1 gap thật đáng lưu ý: lỗi tag
KHÔNG được coi là best-effort (khác đúng "tag đã tồn tại" đã xử lý sẵn), nên toàn bộ
`n8n_upsert_workflow` báo lỗi dù workflow đã tạo xong — model tự phát hiện qua
`n8n_list_workflows` và báo lại đúng cho người dùng, không tạo trùng.

Sửa thật: tạo lại API key với đủ scope (`tag:list`, `workflowTags:update`,
`workflowTags:list` thêm vào bộ cũ), cập nhật `N8N_API_KEY` qua `POST /api/v1/credentials`, xoá
key cũ khỏi n8n. Ghi lại đầy đủ bộ scope cần thiết vào `docs/patch-cookbook.md` Ví dụ 4 (gotcha
mới, xác nhận thật bằng lỗi 403 trực tiếp trên `GET /api/v1/tags`).

## Cải thiện description tool (giảm — không loại bỏ hẳn — hành vi double-encode của Đợt 9)

Thêm ví dụ JSON cụ thể vào description của `workflow` param (`n8n_validate_workflow` và
`n8n_upsert_workflow`) — nhấn mạnh "real JSON object, not a JSON-encoded string" + 1 ví dụ tối
giản đúng cấu trúc. Test lại: model **vẫn** stringify `workflow` (thói quen của model này không
đổi hẳn), nhưng lần này JSON hợp lệ (trước đó có lần JSON hỏng giữa chừng) — `coerceWorkflowArg`
(fix Đợt 9) parse đúng, validate pass ngay lần đầu. Kết luận thật: description ví dụ không sửa
được thói quen double-encode của model, nhưng `coerceWorkflowArg` (đã có sẵn) là lớp phòng thủ
thực sự hiệu quả — giữ cả 2, không bỏ cái nào.

## Test end-to-end THẬT — đúng kịch bản người dùng hỏi

Phiên chat thật (`POST /session-messages`, theo dõi `GET /session-stream`), không qua UI (chưa
mở trình duyệt) nhưng đúng luồng REST mà UI cũng gọi:
1. "Tạo giúp tôi 1 n8n workflow tên 'Cordis Retest' chỉ cần 1 node Manual Trigger..." → model tự
   gọi `n8n_validate_workflow` → pass → hỏi xác nhận trước khi tạo (hành vi agentic tốt, không
   được yêu cầu riêng, model tự quyết).
2. Trả lời "Có, tạo luôn đi" → model gọi `n8n_upsert_workflow` → **thành công thật**
   (`isError: false`), trả về đúng `id` workflow thật từ n8n.
3. Xác nhận trực tiếp qua n8n API: workflow `AUwktLIr8VtwSroI` tồn tại thật, có đúng tag
   `agent-generated`.
4. Xác nhận `GET /api/v1/automations` (route FE dashboard "Automations" gọi) trả về đúng
   workflow này — tab Automations trên UI giờ sẽ hiển thị dữ liệu thật, không còn trống/lỗi
   như trước khi bật n8n.

**Test đầy đủ đã chạy:** `pnpm run typecheck` sạch toàn repo sau các sửa; restart dev server
thật 2 lần (sau mỗi lần sửa code) — cả 2 lần boot sạch với n8n đã bật.

**Trạng thái hiện tại — khác Đợt 9, KHÔNG revert:** n8n vẫn đang chạy thật (`docker ps` sẽ thấy
`cordis-n8n`), patch vẫn còn trong `cordis.patch.yml` (home tier, dev-only — chưa đụng tới
`deploy/entrypoint.sh`/`docker-compose.yml` production, n8n production vẫn opt-in như thiết kế
ban đầu, đây chỉ là bật cho MÔI TRƯỜNG DEV để người dùng test qua UI). Đăng nhập UI thật (xem
trả lời trước) dùng admin/12345678; sau khi vào, gõ y hệt kịch bản trên trong ô chat để thấy lại
đúng luồng này qua UI thật.

**Chưa test:** `n8n_activate_workflow` (cần chạy qua UI thật để duyệt approval — REST approval-
respond route có sẵn nhưng chưa gọi lần này) và `n8n_run_workflow` (cần 1 workflow đã active có
Webhook trigger — "Cordis Retest" hiện chỉ có Manual Trigger, không áp dụng được).

---

# Đợt 11 (2026-09-17) — Tắt popup onboarding + "buy n8n" của n8n, xác nhận thật từng cờ

Yêu cầu: "Khi start server và mở account lần đầu trên n8n có các popup onboarding điền form và
popup mua n8n tôi bỏ hết cái này lúc start được không". Không đoán biến môi trường — đọc thật
`GET /rest/settings` (đã đăng nhập) TRƯỚC và SAU khi thêm từng biến, xác nhận đúng field nào bị
tắt bởi biến nào.

## Đọc `/rest/settings` thật trước khi sửa

Phát hiện đúng field cần tắt: `personalizationSurveyEnabled: true` (form onboarding "tell us
about yourself"), `versionNotifications.enabled`/`whatsNewEnabled: true` (popup "có bản mới"),
`hiringBannerEnabled: true`, `templates.enabled: true`, `telemetry.enabled`/`posthog.enabled:
true`, và quan trọng nhất — `dynamicBanners.enabled: true` (fetch banner quảng cáo thật từ
`api.n8n.io/api/banners` — đây chính là "popup mua n8n" người dùng mô tả).

## Restart container thật với từng biến, xác nhận qua field tương ứng

`docker stop/rm` rồi `docker run` lại (giữ nguyên volume `cordis-n8n-data` — dữ liệu, owner
account, API key, cả 2 workflow đã tạo trước đó SỐNG SÓT nguyên vẹn qua lần đổi này, xác nhận
lại bằng `GET /api/v1/workflows` sau khi restart). Test 2 vòng:

**Vòng 1** — `N8N_DIAGNOSTICS_ENABLED`, `N8N_PERSONALIZATION_ENABLED`,
`N8N_VERSION_NOTIFICATIONS_ENABLED`, `N8N_HIRING_BANNER_ENABLED`, `N8N_TEMPLATES_ENABLED` — tất
cả `=false`. Đọc lại `/rest/settings`: mọi field tắt đúng NGOẠI TRỪ
`versionNotifications.whatsNewEnabled` vẫn `true` — **1 cờ riêng, không nằm chung** với
`N8N_VERSION_NOTIFICATIONS_ENABLED`.

**Vòng 2** — thêm `N8N_VERSION_NOTIFICATIONS_WHATS_NEW_ENABLED=false` — đọc lại: **tất cả 6
field đều `false`**, bao gồm đúng `dynamicBanners.enabled: false` (popup mua n8n đã tắt thật).

## Áp dụng vào cả dev (container đang chạy) và production (docker-compose.yml)

Container `cordis-n8n` đang chạy đã mang đủ 6 biến này (không cần làm gì thêm cho môi trường
dev hiện tại). Thêm `environment:` block vào service `n8n` trong `deploy/docker-compose.yml` để
production tự động có cùng trải nghiệm gọn — không phải nhớ set tay mỗi lần deploy.

**Đánh đổi cần biết:** `N8N_TEMPLATES_ENABLED=false` tắt luôn panel Templates (tính năng thật,
không chỉ quảng cáo) — nếu muốn duyệt template mẫu từ n8n.io thì bật lại field này, không ảnh
hưởng gì tới các cờ còn lại.

**Test đã chạy:** đọc `/rest/settings` thật qua session đăng nhập thật, không đoán tên biến môi
trường; xác nhận dữ liệu (workflow, owner account, API key) sống sót qua 2 lần recreate
container nhờ volume riêng.

---

# Đợt 12 (2026-09-17) — `/automations` thành route thật + nút "Mở trong n8n" mỗi workflow

Yêu cầu: "Khi mở nút automations phải mở 1 route mới / và cũng như các thẻ workflow phải có nút
go to đến direct web n8n workflow đó". 2 việc riêng biệt, cả 2 đã làm và test thật.

## 1. `/automations` là route thật, không còn state cục bộ

Trước đó `centerView` là 1 `useState` cục bộ trong `AppFrame` — bấm "Automations" chỉ đổi UI tại
chỗ, URL vẫn ở `/` hoặc `/chat/<id>`, F5 mất trạng thái, không back/forward được. Sửa:
`lib/use-app-route.ts`'s `AppRoute` thêm nhánh `{ kind: 'automations' }`, `parseRoute()` nhận
diện `/automations`, thêm `goToAutomations()` (pushState thật, cùng kiểu với `goToSession`).
`page.tsx` bỏ hẳn `CenterView`/`centerView` state, mọi thứ suy ra trực tiếp từ `route.kind`.

Không cần sửa gì ở `ui.ts`'s SPA-fallback (đã tổng quát hoá từ Đợt 2, tự nhận diện mọi path
không có đuôi file, không hard-code riêng `/chat/*`) — `/automations` tự động rơi đúng vào
nhánh SPA-fallback, xác nhận qua `curl /automations` → 200 thật.

## 2. Mỗi thẻ workflow có nút "Mở trong n8n"

Vấn đề thật cần giải quyết trước khi làm UI: `cordis-n8n`'s `config.baseURL` là origin CORE
dùng để gọi API (trong production là `http://n8n:5678` — tên DNS nội bộ compose, trình duyệt
KHÔNG resolve được) — không thể dùng thẳng để build link cho trình duyệt. Thêm field mới
`Config.editorBaseURL` (optional, mặc định = `baseURL` khi không set — đúng cho dev vì cả 2
trùng nhau ở `127.0.0.1:5678`). `/api/v1/automations` giờ trả thêm `editorUrl` mỗi workflow =
`${editorBaseURL ?? baseURL}/workflow/<id>`, tính SERVER-SIDE (frontend không tự đoán URL).

`Automation` type (`lib/api.ts`) thêm `editorUrl?: string`; `automations.tsx` thêm icon
`ExternalLink` mở `editorUrl` ở tab mới (`target="_blank"`), `stopPropagation` để không kích
hoạt luôn việc mở rộng card execution list bên dưới. Cập nhật `docs/patch-cookbook.md` Ví dụ 4
với field `editorBaseURL: http://127.0.0.1:5678` cho đúng trường hợp production thật.

**Test thật:** `pnpm run typecheck` sạch toàn repo; build + restart dev server sạch;
`curl /automations` → 200 (route SPA thật); `curl /api/v1/automations` → trả đúng
`editorUrl: "http://127.0.0.1:5678/workflow/AUwktLIr8VtwSroI"` cho workflow thật đã tạo ở Đợt
10; `curl` thẳng vào chính URL đó → 200, xác nhận trỏ đúng tới trang thật trên n8n, không phải
đường dẫn suy diễn sai.

**Chưa test bằng mắt:** click thật nút "Mở trong n8n" trên UI trong trình duyệt (logic phía
client đơn giản, `href` đã xác nhận đúng qua curl, nhưng chưa mở trình duyệt thật để bấm).

---

# Đợt 13 (2026-09-17) — Nút n8n sang phải + icon cuối; bỏ tag agent-generated

Yêu cầu: "nút nằm bên phải và icon ở cuối bỏ việc đánh tag agent-generated đi và cả thay đổi
Các n8n workflow do agent tạo (gắn thẻ agent-generated)". 3 việc nhỏ, đều đã làm + test thật.

## 1. Nút "Mở trong n8n" — sang phải, icon cuối

`automations.tsx`: đổi `w-fit` (căn trái mặc định trong flex-col) thành thêm `self-end` (căn
phải theo cross-axis của `<li>` flex-col cha) — text đứng trước, icon `ExternalLink` chuyển
xuống SAU text thay vì trước.

## 2. Bỏ tag `agent-generated`

`packages/tool/n8n/src/index.ts`: `n8n_upsert_workflow` không còn gọi
`getOrCreateTag(ctx, config, 'agent-generated')` — chỉ còn gắn `session:<id>` (vẫn giữ, không
được yêu cầu bỏ, vẫn có giá trị truy vết session nào tạo). `/automations` route bỏ luôn filter
`?tags=agent-generated` — nếu không bỏ, mọi workflow tạo MỚI (không còn tag đó) sẽ vĩnh viễn
không hiện trên dashboard. Giờ liệt kê TOÀN BỘ workflow trong n8n instance, không phân biệt
nguồn gốc.

## 3. Đổi text mô tả

`automations.readonlyHint` (cả 2 ngôn ngữ): "Các n8n workflow do agent tạo (gắn thẻ
agent-generated)..." → "Tất cả n8n workflow trong instance này..." / "All n8n workflows in this
instance...". `automations.empty` cũng đổi tương ứng ("Chưa có workflow nào do agent tạo" →
"Chưa có workflow nào trong n8n"). Đồng bộ luôn `docs/cordis-agent-architecture.md` §7.1 (quy
ước bắt buộc + sequence diagram) cho khớp hành vi thật — không sửa
`docs/cordis-agent-implementation-plan.md` (đúng nguyên tắc đã áp dụng xuyên suốt: đó là nhật ký
lịch sử đã Definition-of-Done tại thời điểm cũ, không viết đè).

**Test thật:** `pnpm run typecheck` sạch toàn repo; build sạch, grep bundle FE xác nhận
"agent-generated" biến mất HOÀN TOÀN (lần đầu build vẫn còn sót ở key `automations.empty`,
phát hiện qua đúng bước grep-bundle này — sửa tiếp rồi build lại, lần 2 sạch); tạo workflow thật
qua chat ("No Tag Test") → xác nhận `"tags": []` (không tag) từ chính response n8n thật; gọi lại
`/api/v1/automations` → thấy đủ cả 3 workflow (kể cả 2 cái CŨ vẫn còn tag `agent-generated` từ
trước và cái MỚI không tag) — xác nhận filter đã bỏ thật, không phải chỉ ẩn ở UI. Restart dev
server thật — boot sạch.

---

# Đợt 14 (2026-09-17) — Session trống không hiện trong sidebar history (đúng hành vi thật của example-2)

Yêu cầu: "Xem lại việc show list chat conversation của example 2 khi tạo mới mà chưa chat thì
đừng lưu và show trên sidebar phần history". Đây chính xác là phần "hide until chatted" của
example-2 mà Đợt 8 CHƯA làm (Đợt 8 chỉ xử lý phần UI composer + no-op guard chống tạo trùng
session trống, KHÔNG xử lý phần ẩn khỏi sidebar) — đọc lại `App.tsx`'s `hasChatted` +
`sessions.first_message_at IS NOT NULL` filter (backend thật của họ) để làm đúng phần còn thiếu.

## Tìm tín hiệu "đã chat" đáng tin cậy, rẻ, không cần đọc lại log

Loại bỏ ngay các phương án sai đã cân nhắc:
- `session.seq` — SAI, đã tự xác nhận ở Đợt 7: `POST /sessions` xong `seq` đã bằng 3 (event
  setup: permission/policy, sandbox/mode, approval/policy...) chứ không phải 0.
- Title đã có hay chưa (`ctx.sessionTitle.get()`) — SAI, có race thật: title được model sinh
  BẤT ĐỒNG BỘ (`session-title-llm`), nên ngay sau khi gửi tin thật, có 1 khoảng title vẫn null
  dù đã thật sự "đã chat" — dùng làm tín hiệu sẽ ẩn nhầm đoạn chat NGƯỜI DÙNG ĐANG GÕ.

Tín hiệu đúng, đọc `@deepseek-ai/dsh-session`'s real `.d.ts`: `Session.surface.nodes` (danh
sách seq các event model-visible, đã fold sẵn TRONG BỘ NHỚ, không cần đọc lại log) +
`Session.eventAt(seq)` (tra event tại 1 seq, đồng bộ). Viết `sessionHasRealUserMessage(session)`
trong `gateway.ts`: duyệt `surface.nodes`, tìm 1 event `user/message` có `source.kind` là
`undefined` hoặc `'user'` — Y HỆT tiêu chí `hasRealUserMessage()` phía frontend
(`conversation.tsx`, Đợt 7) để server và client không bao giờ lệch nhau.

## Áp dụng filter vào đúng 1 route

`GET /sessions` (route DUY NHẤT đang được sidebar's `HistoryChat` gọi, xác nhận qua grep toàn
bộ `apps/web` — không có consumer nào khác) thêm `.filter(sessionHasRealUserMessage)` trước khi
map. Không đụng gì tới việc TẠO session (`POST /sessions` vẫn tạo eager như cũ, đúng hành vi
composer-hiện-ngay của Đợt 8) — chỉ ẩn khỏi danh sách hiển thị, đúng nghĩa "đừng show" người
dùng yêu cầu.

**Test thật:** `pnpm run typecheck` sạch toàn repo; restart dev server sạch; tạo session mới qua
`POST /sessions` → `GET /sessions` ngay sau đó → **0 kết quả** (trước đây sẽ thấy 1 dòng
"Untitled"); gửi 1 tin nhắn thật vào đúng session đó → `GET /sessions` → xuất hiện đúng 1 dòng,
title đã có ngay ("Chào bạn" — fallback tức thời trước khi title-llm bất đồng bộ chạy xong,
không phải null); tạo thêm 1 session trống thứ 2 → xác nhận vẫn ẩn, danh sách vẫn đúng 1 dòng —
không ảnh hưởng session đã chat.

**Giới hạn còn lại, cố ý không xử lý lần này (ngoài phạm vi câu hỏi):** thư mục workspace + log
session trống vẫn được TẠO THẬT trên đĩa (`ctx.agents.create()` vẫn eager, khớp thiết kế Đợt 8)
— chỉ ẩn khỏi mọi nơi hiển thị trong UI, không dọn rác trên đĩa. Nếu muốn dọn tự động (garbage
collection theo thời gian idle) thì đây là 1 tính năng riêng, chưa làm.

---

# Đợt 15 (2026-09-17) — MCP server của n8n: THẬT sự hoạt động nhưng vỡ context window

Đảo ngược quyết định Đợt trước ("đi hướng B") sau khi có token thật (`quay lại bước A`) — n8n's
MCP server đã bật thật, token lấy thật qua UI (không tự động hoá được việc SINH token — đã thử
~15 endpoint REST, CLI `--help`, và `ttwf:generate` — cái cuối là stub "displayed until AI
workflow builder PRs merged", chưa dùng được ở bản 2.38.7).

## Nối vào core — Config thật

Thêm row `mcp-n8n` (`@deepseek-ai/dsh-mcp-client`, `transport: streamable-http`,
`url: http://127.0.0.1:5678/mcp-server/http`, token qua `!!js` đọc `process.env.N8N_MCP_TOKEN`)
vào `.dev-state/harness/profiles/cordis-app/cordis.patch.yml`. Boot sạch, `--dump-config` xác
nhận đúng row.

## Test thật — model gọi đúng tool MCP, nhận schema THẬT của n8n

Gửi lại đúng prompt Gmail đã fail trước đó. Model gọi đúng chuỗi tool theo hướng dẫn có sẵn của
MCP server: `search_nodes` → `get_workflow_best_practices` → `get_node_types` → lặp lại — nhận
về ĐÚNG TypeScript type definition thật của Gmail Trigger/Gmail message/LangChain Agent/HTTP
Request/Set node trực tiếp từ n8n, không còn đoán mò. Đây là bước tiến thật so với tool tự viết
trước đó.

## Nhưng vỡ context window thật — chưa giải quyết dứt điểm

Turn 2 (và cả lần retry sau khi thêm `contextWindow: 32768`) đều dừng với lỗi thật từ provider:
`CONTEXT_WINDOW_EXCEEDED`. Nguyên nhân: `get_node_types` trả về nguyên khối TypeScript + JSDoc
dài cho mỗi node — vài lần gọi là đủ tràn. Gốc rễ tìm được: adapter `llm-openai-compat` KHÔNG
hề khai `contextWindow` — thiếu số này thì `dsh-compaction-basic` (đã mount sẵn) không biết khi
nào cần tự nén trước, chỉ phát hiện SAU KHI request đã thất bại.

Thêm `contextWindow: 32768` (override qua `.dev-state/harness/profiles/cordis-app/cordis.patch.yml`,
KHÔNG sửa default của package — số này đặc thù theo model thật của người dùng, không phải giá
trị chung). Test lại: cải thiện thật (đi được 6 tool call thay vì 5 trước khi lỗi) nhưng **vẫn
chưa hết lỗi** — 32768 có thể chưa đúng context window thật của model qua proxy, hoặc compaction
chưa đủ mạnh/kịp thời. Cần biết đúng số thật của model mới giải quyết dứt điểm — để lại chưa
xong, ghi nhận rõ ràng thay vì báo "đã fix".

**Trạng thái hiện tại:** MCP n8n vẫn đang bật thật trong dev, hoạt động đúng cho các bước
nghiên cứu node (search/best-practices/type lookup) nhưng CHƯA hoàn thành được 1 workflow phức
tạp trọn vẹn trong 1 turn vì giới hạn context window thật của model đang dùng.

---

# Đợt 16 (2026-09-17) — Gộp Serper + n8n credentials vào 1 tab "Config"

Yêu cầu: gộp phần nhập Serper API key (tab "Web search" cũ) cùng 2 mục n8n credentials vào 1 tab
"Config" — vì cả 3 đều cùng dạng "secret set 1 lần lúc đầu" giống nhau.

`settings-dialog.tsx`: tab `webSearch` đổi thành `config`; thêm component `CredentialField` dùng
chung (status + input password + Lưu/Xoá) thay vì lặp lại logic 3 lần; `ConfigTab` render 3
`CredentialField`: Serper API key (như cũ), n8n API key (mới), n8n webhook secret (mới).

**Bug thật bắt được trước khi build:** `gateway.ts`'s `KNOWN_CREDENTIAL_REFS` (danh sách
`GET /credentials` cho phép liệt kê) chưa có `N8N_API_KEY`/`N8N_WEBHOOK_SECRET` — dù `POST` đã
nhận các ref này từ trước (không kiểm tra theo danh sách), `GET` sẽ không bao giờ trả về trạng
thái "đã cấu hình" cho 2 field mới nếu không thêm vào danh sách này trước. Thêm cả 2 ref vào.

**Test thật:** `tsc --noEmit` sạch (cả `apps/web` lẫn `bundle-core`); build sạch, grep bundle
xác nhận có đủ text mới; restart dev server; `GET /api/v1/credentials` trả đúng cả 2 ref n8n
mới với `configured: true` (đã set từ trước ở Đợt 10/15).

---

# Đợt 17 (2026-09-17) — Menu "/" chọn skill trong composer + bug nền tảng: model chưa từng dùng được skill

Yêu cầu: "khi chat / ko hiện ra các option skill tham khảo example-2 và implement". Đọc thật
`SkillMenu.tsx`/`slashQuery`/`useSkillMenu`/`skillsApi.ts` của example-2 trước khi làm.

## Phát hiện quan trọng trước khi code: backend đã có sẵn, chỉ thiếu UI

`@deepseek-ai/dsh-tool-skill`'s README xác nhận: "Users can invoke a skill with `/name`" — 1
token `/name` đứng riêng biệt (whitespace-bounded) BẤT KỲ ĐÂU trong tin nhắn người dùng sẽ tự
inject full instructions của skill đó — tính năng THẬT của dsh, không phải custom code riêng của
example-2. `settings-dialog.tsx`/`skills-dialog.tsx` từ trước đã ghi sẵn "Gõ /tên trong ô chat để
dùng" — nhưng composer chưa từng implement việc gõ đó cả.

## UI — port từ example-2, thích ứng vào kiến trúc thật của mình

`composer.tsx` thêm `slashQuery()` (y hệt regex `/^\/([a-z0-9-]*)$/` của example-2 — menu chỉ mở
khi TOÀN BỘ nội dung ô nhập đúng là token lệnh), component `SkillMenu` nội bộ (theo đúng quy ước
sẵn có của codebase này — sub-component cùng file thay vì tách file riêng như example-2, khớp
với cách `WebSearchTab`/`ExecutionsPanel` đã làm), điều hướng bàn phím (mũi tên/Enter/Tab chọn,
Escape đóng) y hệt `onTextareaKeyDown` gốc. Khác chủ đích: dùng lại `['skills']` react-query
cache có sẵn (đã dùng chung với `skills-dialog.tsx`) thay vì port nguyên `skillsApi.ts`'s pub/sub
riêng của example-2 — app này đã có 1 cơ chế cache chung, không cần dựng thêm cái thứ 2.

**Cải tiến so với bản gốc, dựa trên field thật app này có mà example-2 không có:** lọc thêm
`skill.invocation.userInvocable` — bắt được từ dữ liệu thật `GET /skills` có skill
`sql-to-insights` với `userInvocable: false` (chỉ model gọi được qua tool, gesture `/name` không
bao giờ kích hoạt được) — nếu không lọc, menu sẽ hiện 1 mục bấm vào không có tác dụng gì.

## Bug nền tảng thật tìm ra khi TEST gesture (không phải giả định)

Test `/web-research ...` qua REST trước khi tin UI đã đúng — **model coi như text thường**, tự
gọi `web_search` thẳng, không có sự kiện injection nào cả. Đào ra nguyên nhân thật qua
`--dump-config`: **`@deepseek-ai/dsh-tool-skill` đang `disabled: true`** — kế thừa từ default của
`dsh-web-app`, CÙNG HỌ với lỗi `tool-web`/`skill-filesystem` đã sửa ở đợt trước. Nghĩa là: **toàn
bộ hệ skill (Đợt 5) từ đầu tới giờ chỉ hoạt động ở phía lưu trữ/UI — model CHƯA BAO GIỜ thực sự
dùng được 1 skill nào**, dù CRUD/hiển thị đều đúng.

Sửa: thêm override `disabled: false` cho `tool-skill` vào `packages/bundle-core/cordis.patch.yml`
(default git-tracked, áp dụng mọi deployment — không phải chỉ patch tạm dev).

**Test thật sau khi bật:** gửi lại đúng `/web-research thời tiết Hà Nội hôm nay thế nào` — lần
này log sự kiện có đúng `user/message` với `source.kind: 'skill-catalog'` (toàn bộ catalog 7
skill được bơm vào) và `source.kind: 'skill-invocation', name: 'web-research'` (đúng skill được
gọi) — model sau đó tự gọi `web_search` với **3 query khác nhau trong 1 lần gọi** (đúng hướng dẫn
"nhiều truy vấn thay vì một" của chính skill `web-research`) thay vì 1 query đơn lẻ như lần test
trước khi bật — bằng chứng hành vi thật đã thay đổi theo đúng skill, không chỉ log sự kiện suông.

**Test đầy đủ:** `pnpm run typecheck` sạch toàn repo; build + restart dev server thật, boot sạch
(không crash "duplicate loader entry"/"waiting for service" — khác các lần từng gặp trước khi
biết cách override đúng); grep bundle FE xác nhận có `skills.mineBadge`/`bottom-full` (UI đã lên
đúng).

**Chưa test bằng mắt:** thao tác chuột/bàn phím thật trên UI (gõ "/", bấm mũi tên, click chọn) —
logic phía client đã xác nhận đúng qua bundle + cùng pattern đã verify với example-2, nhưng
chưa mở trình duyệt thật để thao tác.

---

# Đợt 18 (2026-09-18) — Lỗ hổng packaging thật: máy user mới sẽ KHÔNG có config nào cả

Câu hỏi thật của user sau khi audit "4 env var hardcode" (`OPENAI_API_KEY`/`BASE_URL`/`MODEL_ID`/
`EXTRA_BODY`): "khoan đã thế lúc start trên máy user sao" — tức app này sẽ được đóng gói gửi cho
user tự start local, không phải chạy trên máy mình.

## Xác nhận thật lỗ hổng (không suy đoán)

`cat deploy/profile-template/cordis-app/cordis.patch.yml` — file git-tracked, được copy vào MỌI
`$DSH_HOME` mới hoàn toàn khi boot lần đầu — vẫn là `[]` rỗng. Toàn bộ việc làm từ đầu session
(n8n/MCP, `contextWindow`, `extraBody`, tool-result-pruner) chỉ tồn tại trong
`.dev-state/harness/.../cordis.patch.yml` — file gitignore, chỉ trên máy này. Model Qwen thật
đang chạy chỉ vì gọi tay `POST /api/v1/model` 1 lần — grep `apps/web` xác nhận **không có UI nào
gọi route này cả** — không có gì tái tạo lại nó trên máy khác. `docker-compose.yml`'s `core`
service cũng chưa có `environment:`/`env_file:` nào — dù có set env thật trên host cũng không
bao giờ tới được container.

Tin tốt đọc được từ chính README `@deepseek-ai/dsh-credentials-local`: thứ tự resolve thật là
**launch environment → stored file → project .env → harness-home .env**, và "launch environment"
là đọc `process.env` thật. `OPENAI_API_KEY`/`OPENAI_BASE_URL` đã là `ctx.credentials` ref sẵn
(`adapter.ts`) nên **tự động hoạt động qua env var thật, không cần sửa code** — chỉ thiếu đường
dẫn thật đưa env var vào tiến trình đang chạy. `@deepseek-ai/dsh-agent-default-model` (đọc
README xác nhận) thì KHÔNG có cơ chế fallback env var này — `provider`/`model` là 2 field bắt
buộc thuần composition, cần 1 override thật mới đọc được env.

n8n/MCP giữ nguyên ngoài phạm vi — đã là opt-in đúng chủ đích từ trước (`tool-n8n` không có
`dsh.bundle.patch`, `docs/patch-cookbook.md` đã ghi rõ bước cài 1 lần) — quyết định đó không đổi.
Chỉ đưa `tool-result-pruner` (không phụ thuộc n8n, vô hại khi không có) lên default vĩnh viễn.

## Sửa — 5 file thật

1. `packages/llm/openai-compat/cordis.patch.yml`: thêm `contextWindow`/`extraBody` đọc
   `!!js process.env.OPENAI_CONTEXT_WINDOW`/`OPENAI_EXTRA_BODY`; thêm override MỚI cho
   `agent-default-model` (id đã tồn tại từ `dsh-base`, xác nhận qua `--dump-config` thật:
   `provider: deepseek-official, model: deepseek-flash`) — `provider: openai-compat` cứng,
   `model: !!js process.env.OPENAI_MODEL_ID || 'unconfigured-model'` (placeholder để không crash
   boot khi máy mới chưa set gì).
2. `packages/bundle-core/cordis.patch.yml`: đưa `tool-result-pruner` override (đã dùng ổn ở Đợt
   15) từ dev-state lên đây — git-tracked, default vĩnh viễn.
3. `.env.example` (mới, repo root): 5 biến kèm giải thích.
4. `deploy/docker-compose.yml`: thêm `env_file: [{path: ../.env, required: false}]` cho service
   `core` — cố ý KHÔNG dùng `environment: ${VAR:-}` (sẽ set cứng thành chuỗi rỗng khi biến chưa
   set trên host, tệ hơn là không set gì).
5. `scripts/dev.sh`: source `.env` ở đầu script (trước phần check Node) cho đường chạy bare-host
   — Docker có `env_file` lo, bare-host chưa có cơ chế tương đương.
6. `.gitignore`: thêm `/.env` — file thật sẽ chứa API key thật, chưa từng được ignore trước đó
   (lỗ hổng nhỏ phát hiện thêm khi làm, sửa luôn).

## Bug thật bắt được khi verify (không phải giả định "chắc chạy được")

Viết `contextWindow`/`extraBody` bằng ternary/`JSON.parse` không quote:
`!!js process.env.X ? Number(process.env.X) : undefined` — `--dump-config` thật cho ra
`contextWindow: {'[object Object]': undefined}` — HỎNG. Nguyên nhân: YAML plain-scalar parser
đọc `? ... : ...` (có dấu `: `) như cú pháp complex-mapping-key của chính YAML, không phải text
JS thường. Sửa bằng cách quote nguyên biểu thức JS trong dấu nháy đơn (`!!js '...'`) — đúng lý do
`mcp-n8n`'s Authorization header ở dev-state patch trước đó đã quote sẵn (không phải ngẫu nhiên).

Đọc thẳng source `@deepseek-ai/cordis-plugin-loader/lib/index.js` để xác nhận cơ chế eval thật
(không đoán): `!!js` compile thành `with (ctx) { return eval(expr) }` — `eval()` thuần JS, không
có parser giới hạn riêng nào. Test lại bằng `node -e` với đúng hàm `evaluate` này: cả 2 trường hợp
set/chưa set env đều cho kết quả đúng (`contextWindow: 20000`, `model: 'unconfigured-model'` khi
chưa set, v.v.).

**Test thật khác đã chạy:**
- `--dump-config` trên 1 `$DSH_HOME` HOÀN TOÀN MỚI (thư mục scratch riêng, không đụng
  `.dev-state` thật của máy này) — `dsh plugin add` + `install` chạy sạch, cả 2 row
  `agent-default-model`/`cordis-llm-openai-compat` xuất hiện đúng, không còn `[object Object]`.
- `docker compose -f deploy/docker-compose.yml config` — không có `.env`: không lỗi, `core`
  không có `environment:` nào cả (không bị set rỗng). Có `.env` test (2 biến): `core.environment`
  hiện đúng CHỈ 2 biến đó, không tự thêm biến nào khác.
- `pnpm run typecheck` sạch toàn repo (dùng Node 22 qua nvm — Node mặc định của shell là 21.7.1,
  pnpm 11 yêu cầu 22.13+).

**Chưa test:** chưa chạy `docker compose up` thật (build image) lẫn 1 phiên chat thật end-to-end
trên `$DSH_HOME` hoàn toàn mới với credential thật — do rủi ro đụng `.dev-state` thật của máy này
nếu không cẩn thận, và build Docker image tốn thời gian không cần thiết cho việc verify cơ chế
(đã verify cơ chế bằng `--dump-config` + eval trực tiếp, đủ độ tin cậy cho phạm vi thay đổi
thuần YAML/env-var này).
