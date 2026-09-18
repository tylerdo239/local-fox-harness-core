# Cordis Agent Core — Kế hoạch triển khai theo phase

> Bám sát `docs/cordis-agent-architecture.md` (v0.3). Tài liệu đó là **kiến trúc/quyết định**;
> tài liệu này là **việc cụ thể phải làm, theo thứ tự, có Definition of Done**.
> Không lặp lại lý do đằng sau mỗi quyết định — xem lại file kia khi cần "vì sao".

**v5 — ĐỔI CƠ CHẾ FORK, viết lại §0.** v4 (Phase 3, Docker) dùng cách "git clone toàn bộ
`deepseek-ai/deepseek-harness`" (~2.7GB, 1600+ package, build ~3 phút). Sau khi so sánh với
một dự án tham khảo khác của chính người dùng (`example-2`, xem §0.3) hoá ra dùng đúng
nghĩa "fork mỏng": `@deepseek-ai/dsh` và từng `@deepseek-ai/dsh-*` package đều **publish
thật lên npm** (đã tự `npm view` xác nhận từng cái) — không cần git clone gì cả. Đã dựng
lại toàn bộ project theo cách đó, xác nhận lại **toàn bộ** Phase 1-3 vẫn hoạt động y hệt
(cùng code nghiệp vụ, chỉ đổi cách lấy dsh):

| | v4 (git-fork) | v5 (npm dependency) |
|---|---|---|
| Cài đặt | ~1600 package, vài phút, không cache | 571 package, ~10 giây |
| Kích thước checkout | ~2.7GB (`packages/`, `vendor/`, `.git`) | ~vài chục MB |
| Docker image | 1.84GB | 513MB |
| Build trong Docker | biên dịch cả monorepo dsh (~3 phút) | chỉ biên dịch 2 package của ta (giây) |
| Nâng cấp dsh | `git fetch upstream && git merge` | đổi số version trong `package.json` + `pnpm install` |

Bản git-fork cũ được giữ nguyên tại `../local-base.gitfork-archive/` (không xoá, chỉ để tham
khảo/rollback — không phải một phần của project hiện tại, đừng đọc nhầm đường dẫn từ đó
ra đây). Từ v5 trở đi, mọi đường dẫn trong tài liệu này trỏ vào project mới tại `core/`
(npm-based).

**Bài học quan trọng nhất khi đổi:** dist-tag `latest` trên npm của TỪNG `@deepseek-ai/dsh-*`
package con bị cũ (đứng ở `0.0.1-rc.1`), trong khi bản thật sự đang dùng — khớp với
`@deepseek-ai/dsh` (CLI) bản mới nhất — là `0.1.5-rc.1`, xác nhận bằng cách đọc
`dependencies` thật của chính `@deepseek-ai/dsh`/`@deepseek-ai/dsh-web-app` trên npm
(`npm view @deepseek-ai/dsh dependencies`), không phải tin theo `npm view <pkg> version`
của từng package riêng lẻ. **Luôn pin đúng version này (hoặc version mới hơn xác nhận lại
tương tự) cho MỌI `@deepseek-ai/dsh-*` package ở các phase sau** — đừng dùng version mặc
định `npm view` trả về.

---

## 0. Quyết định nền & nguyên tắc bất biến

### 0.1 Cách lấy dsh — npm dependency, không git clone

`core/` = root project, tương ứng `cordis/` trong sơ đồ layout ở architecture doc §3.2 —
nhưng KHÔNG còn là một git clone của `deepseek-ai/deepseek-harness`. Đây là project npm
bình thường, `git init` riêng, phụ thuộc `@deepseek-ai/dsh` (CLI) + từng
`@deepseek-ai/dsh-*` package mà code của ta import trực tiếp, tất cả cài qua
`pnpm install` như dependency thông thường. Không có remote `upstream`, không có
`git merge` — nâng cấp dsh là sửa số version trong `package.json` rồi `pnpm install` lại.

```
core/                                  # project npm thật, git init riêng — ĐÃ TỒN TẠI THẬT
├── package.json                       # @deepseek-ai/dsh (CLI) + mọi @deepseek-ai/dsh-* mà
│                                       #   code của ta import (pin CỨNG "0.1.5-rc.1", xem trên)
├── pnpm-workspace.yaml                 # packages:[packages/*, apps/*] + nodeLinker: hoisted
│                                       #   (BẮT BUỘC — xem §3.2, không có sẵn thì Cordis
│                                       #   loader không thấy transitive deps lúc boot thật)
├── packages/bundle-core/               # dsh.bundle — MỘT bundle chứa hết code của ta
│   ├── package.json                    # { "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
│   │                                   #   CỐ TÌNH không có "dependencies" riêng — xem §3.2
│   ├── cordis.patch.yml                # 40 row UI disabled + modules/cordis-client-runner/
│   │                                   #   api-remotes disabled + insert ui/gateway
│   ├── tsconfig.json                   # đơn giản, không cần "paths:{}" ghi đè như bản git-fork
│   │                                   #   (không còn workspace tsconfig.base.json nào để xung đột)
│   └── src/                            # ui.ts (P1, xong), gateway.ts (P2, xong), index.ts (barrel)
│                                       #   — logic KHÔNG đổi so với bản git-fork, copy nguyên
├── apps/web/                           # Next.js — KHÔNG còn bị upstream chiếm tên (packages/
│   │                                   #   không tồn tại nữa) — pnpm-workspace.yaml RIÊNG
│   │                                   #   (packages:[.]), lockfile/node_modules riêng, vẫn
│   │                                   #   tách khỏi workspace chính (lý do thực nghiệm ở §4.2)
│   ├── app/                            # route tĩnh DUY NHẤT `/`, chọn session qua ?session=<id>
│   ├── lib/                            # api.ts, store.ts (zustand), use-session-stream.ts (SSE)
│   ├── components/                     # conversation.tsx, composer.tsx, approvals.tsx
│   └── out/                            # build output — distIndex mà P1/ui.ts phục vụ
├── deploy/                             # Docker thật, đã build+chạy+curl xác nhận (image 513MB)
│   ├── profile-template/cordis-app/
│   │   └── cordis.patch.yml            # rỗng `[]` — copy vào $DSH_HOME lần đầu, tầng "Home" (§7)
│   ├── entrypoint.sh                   # sinh profile package.json bằng heredoc + socat proxy
│   │                                   #   (0.0.0.0 → 127.0.0.1, xem §5.3) trước khi exec dsh
│   ├── core.Dockerfile                 # Vẫn 3 stage (web-builder/core-builder/runtime) —
│   │                                   #   core-builder giờ chỉ install+build 1 package nhỏ
│   │                                   #   của ta, không phải cả monorepo dsh → nhanh hơn hẳn
│   └── docker-compose.yml              # 1 service `core` — n8n thêm ở Phase 6
├── .dockerignore / .gitignore          # cả hai đều cần negation cho apps/web/lib/ — root
│                                       #   pattern `lib/` (build output của bundle-core) khớp
│                                       #   nhầm cả apps/web/lib/ (source tay viết) — gặp bug
│                                       #   này 2 lần (Phase 2 .gitignore, Phase 3 .dockerignore)
├── .nvmrc                              # "22.23.2"
└── (DSH_HOME dev-time + Docker bind mount đều ở core/data/ — gitignore `/data/`)
```

Bundle vẫn CHỈ MỘT (`@cordis-app/bundle-core`, nhiều export subpath `./ui`, `./gateway`,
...), profile vẫn là thư mục runtime tại `$DSH_HOME/profiles/cordis-app/` sinh bởi
entrypoint — hai quyết định này không đổi so với v3/v4, chỉ đổi CÁCH lấy code dsh bên
dưới. Lý do kỹ thuật đầy đủ (bao gồm một bug TypeScript thật gặp phải khi đổi) ở §3.2.

### 0.2 Vai trò của `example-1/` và `example-2/`

`example-1/` (đổi tên từ `example/`): project "agent-core"/fox-harness cũ, build thẳng
trên `@deepseek-ai/cordis`, scope rộng hơn nhiều (gRPC, Postgres, RLM, memory) — chỉ tham
khảo ý tưởng seam/bundle, không migrate code.

`example-2/` (fox-harness-core, **mới** — chính là dự án khiến ta phát hiện ra cách dùng
dsh qua npm dependency thay vì git clone, xem v5 ở trên): một bản **multi-tenant** thật của
cùng ý tưởng — nhiều user, mỗi session một container Docker riêng
(`services/gateway`+`services/orchestrator`+`packages/agent-driver` thay `core/agent-loop`).
**Không lấy lớp multi-tenant này** — Cordis Agent Core vẫn single-user theo đúng
architecture doc. Phần hữu ích thật sự tham khảo được:
- Cách publish/pin version `@deepseek-ai/dsh-*` (đã áp dụng, xem v5).
- `pnpm-workspace.yaml` cần `nodeLinker: hoisted` — bài học họ đã trả giá thật, áp dụng lại
  nguyên xi (§3.2).
- `packages/llm/openai-compat` của họ — mẫu tham khảo cho Phase 4 nếu cần adapter riêng
  thay vì chỉ dùng `dsh-llm-pi-ai` có sẵn (chưa quyết định, xem §6 khi làm tới).
- `packages/profile-template` — xác nhận độc lập cùng một cách materialize profile ta đã
  tự nghĩ ra ở Phase 1 (copy template → `$DSH_HOME/profiles/<name>/`).

### 0.3 Bất biến áp dụng xuyên suốt mọi phase

- **Không sửa code dsh.** Trước là "không sửa `packages/`" (git-fork); giờ đơn giản hơn:
  dsh là npm dependency trong `node_modules/`, không có gì để "sửa" — mọi hành vi khác đi
  qua patch (`cordis.patch.yml`) hoặc code mới trong `packages/bundle-core`/`apps/web`.
- **Model-visible means logged** — runtime-asserted thật trong dsh
  (`docs/architecture.md:121`), không có ngoại lệ cho n8n/webhook.
- **Side-effect ra ngoài → approval gate**, người bấm. Cơ chế đã có sẵn (`ctx.approval`,
  §4.4) — chỉ thiếu answerer, không thiếu cơ chế.
- **Không dựng lại plugin manager/store.** Đổi hành vi = sửa patch (rebuild hoặc restart
  tuỳ tầng, §7) + restart.
- **Single-user, không auth mặc định.** dsh đã tự lo việc này tốt hơn dự tính ban đầu
  (§5.2) — không viết middleware riêng.

### 0.4 Ngoài phạm vi

BFF riêng, JWT nội bộ, MariaDB/Postgres, Redis, S3/MinIO, multi-instance/multi-tenant
(xem §0.2 — `example-2` có làm nhưng KHÔNG lấy), plugin store/manager runtime, RSC, Next
middleware, Auth.js, gRPC, OTLP/APM riêng (JSONL đủ). **Thêm sau recon:** không viết lại
LLM adapter, static file server, cookie/session auth, webhook dispatch runtime, hay
approval policy engine — dsh-base/dsh-web-app đã có, dùng lại (chi tiết §3, §4, §5, §6).

---

## 1. Ước lượng & thứ tự

| Phase | Nội dung | Size (đã điều chỉnh) | Ghi chú |
|---|---|---|---|
| 0 | Recon | **Xong** — xem §2 | Đã clone/build/chạy thật |
| 1 | Fork & profile | **Xong** — xem §3 | Fork thật, bundle rỗng boot được, entrypoint chạy end-to-end |
| 2 | Gateway + chat tối thiểu | **Xong** — xem §4.1, §4.2 | Backend + FE build thật, boot thật, curl xác nhận end-to-end. Browser thật chưa test. |
| 3 | Đóng gói 1 image | **Xong** — xem §5 | Docker thật, đã fix socat proxy + git-hash override |
| 4 | Model + credential | S — nhẹ hơn hẳn v1 | `llm-pi-ai` đã có sẵn trong `dsh-base`, chỉ cấu hình |
| 5 | Patch layer | S | Một tầng, không phải hai (đã gộp, §7) |
| 6 | n8n | L | Không đổi nhiều — có template `webhook-github` để copy |
| 7 | Audit | S | Không đổi |

Thứ tự: 0 → 1 → 2 → 3, sau đó 4/5/6/7 tương đối độc lập (giữ khuyến nghị cũ).

---

## 2. Phase 0 — Recon (ĐÃ XONG, hands-on thật)

Đã thực hiện, không phải chỉ đọc doc: clone `deepseek-ai/deepseek-harness` vào scratch,
cài Node 22.23.2 + pnpm 11.7.0 (qua nvm/corepack — máy dev vốn có Node 21, **cần cài
thêm Node 22+ trước khi làm Phase 1 thật**), `pnpm install` (57s) + `pnpm run build`
(thành công, kể cả build FE mặc định của dsh) chạy sạch, rồi chạy thật
`dsh --profile web --dump-config` và `dsh --profile cordis-app --from-default-profile
headless --dump-config`. Toàn bộ phát hiện dưới đây là từ output thật, không phải suy
đoán từ doc.

**Ghi chú sau v5:** việc "clone vào scratch" ở đây chỉ là kỹ thuật recon tạm thời (đọc
source thật, chạy thử) — KHÔNG phải cách project cuối cùng lấy dsh. Từ v5, project thật
dùng npm dependency (§0.1). Mọi cơ chế mô tả dưới đây (profile/bundle/patch layering, API
`ctx.webServer`/`ctx.connection`, v.v.) hoàn toàn không đổi — đây là cách dsh hoạt động
BÊN TRONG, giống hệt dù lấy dsh bằng git clone hay npm install.

### 2.1 Cơ chế profile — khác v1 tưởng

Profile **không phải** một package thường trong workspace của bạn. `dsh --profile <name>`
chỉ tìm dưới `$DSH_HOME/profiles/<name>/` (`apps/cli/src/args.ts:143`). Chạy
`dsh --profile cordis-app --from-default-profile headless` tạo thật 4 file tại
`$DSH_HOME/profiles/cordis-app/`:

- **`package.json`** (nội dung thật, đã chạy ra):
  ```json
  {
    "name": "dsh-profile-cordis-app",
    "private": true,
    "dependencies": {},
    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"], "patchReload": "startup" } }
  }
  ```
- **`cordis.yml`** — luôn `[]`, không sửa file này ("Edit cordis.patch.yml, not this file").
- **`cordis.patch.yml`** — luôn `[]` lúc mới tạo, đây chính là **tầng patch sống động
  nhất** (xem sửa lỗi ở §7 — v1 tưởng có 2 file "Profile" + "Home" riêng, thực ra
  **chỉ có một file thật**: `$DSH_HOME/profiles/<name>/cordis.patch.yml`).
- **`pnpm-workspace.yaml`** — xác nhận profile dir là **một pnpm project thật** (`packages: [.]`,
  `nodeLinker: hoisted`). `dsh plugin --profile <name> <pnpm-args>` (`apps/cli/src/args.ts:189-199`)
  forward thẳng vào pnpm chạy trong thư mục này.

Bundle resolve qua tên package (`resolveBundleDir`, `packages/boot/app-boot/src/profile.ts:746-757`)
thử `installAnchor` trước — với CLI `dsh` bình thường, anchor này trỏ vào chính node_modules
của checkout dsh, nên **bundle nào đã có trong `pnpm install` gốc thì dùng được ngay trong
profile, không cần `pnpm install` riêng trong thư mục profile.** Đã xác nhận thực nghiệm:
không hề chạy `pnpm install` bên trong `.dsh-home/profiles/cordis-app/`, `--dump-config`
vẫn resolve đúng `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`.

**Hệ quả cho Phase 1:** không cần `dsh plugin`/pnpm-in-profile-dir. Chỉ cần bundle của ta
là một pnpm workspace package bình thường trong `core/` (cùng closure cài đặt với
`dsh-base`), rồi **tự tay viết** `package.json` + `cordis.patch.yml` đúng hai shape thật ở
trên vào `deploy/profile-template/cordis-app/` (commit trong git), và một script nhỏ copy
chúng vào `$DSH_HOME/profiles/cordis-app/` lúc container khởi động (§3.4). Không dùng
`--from-default-profile` lúc runtime — chỉ dùng nó một lần lúc viết plan này để lấy đúng
shape thật.

### 2.2 `dsh --dump-config` thật của profile `web` — dùng để biết chính xác row nào tồn tại

Chạy thật, 540 dòng, có comment nguồn (`# == @deepseek-ai/dsh-base`, rồi
`# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app`). Các điểm quan trọng:

- **`llm-pi-ai` (`@deepseek-ai/dsh-llm-pi-ai`) đã có sẵn trong `dsh-base`**, cùng
  `agent-default-model` (config `provider`/`model`), `credentials`
  (`@deepseek-ai/dsh-credentials-local`), `approval` (`@deepseek-ai/dsh-user-approval`),
  `sandbox-policy`. → **P3 (llm-openai-compat) và phần lớn "credential service" trong
  architecture doc đã có sẵn, không phải viết plugin mới** (chi tiết §5).
- Không có row `webhook`/`dsh-webhook` nào trong profile `web` mặc định — đúng như kỳ
  vọng, ta phải tự thêm (§6).
- Không có row `dsh-host-frontend-static` xuất hiện trong dump — vì `dsh-web-app`
  (`@deepseek-ai/dsh-web-app`, row `web-runtime`) tự mount nó bằng code bên trong `apply()`
  của chính nó (`distIndex` là "assembly fact", không phải config row patch được).
  **Xác nhận bằng cách đọc source thật** (`packages/bundle/web-app/src/index.ts:162-170,232`):
  `resolveDistIndex()` hardcode `require.resolve('@deepseek-ai/dsh-web-frontend/package.json')`
  rồi `ctx.plugin(FrontendStatic, {distIndex})` — **không có field config nào để đổi**, và
  gọi `ctx.webServer.registerFallback(...)` — seat "một chủ sở hữu duy nhất, đăng ký lần
  hai sẽ throw" (`docs/subsystems/web-server.md:27,89-94`). → **Không thể "mượn nguyên
  `web-runtime` rồi đổi dist"** như bản kế hoạch trước tưởng; cũng không thể disable
  `web-runtime` để tự mount thay thế, vì `connection` (`dsh-client-connection`) `inject:
  [webRuntime]` — mất `web-runtime` là mất luôn service `ctx.webRuntime` mà `connection`
  cần (`trustedHosts`), plugin đó treo mãi.
  **Giải pháp đã xác nhận chạy thật (§3.2, Phase 1 build thật):** `cordis-ui` (P1, code ở
  Phase 3) không tranh seat fallback. Package `dsh-host-frontend-static`
  (`packages/host/frontend-static/src/index.ts:66-104`) export riêng hàm `serveStatic()`
  độc lập với `apply()`/`registerFallback`. Ta gọi `ctx.webServer.register({kind:'prefix',
  path:'', handler})` (path rỗng = khớp mọi pathname, `packages/host/webserver/src/index.ts:322-324`)
  dùng lại `serveStatic()` trỏ `distIndex` của ta. Theo đúng thứ tự match "exact table
  trước, rồi prefix dài nhất, rồi mới tới fallback" (`docs/subsystems/web-server.md:27`),
  route của ta luôn thắng trước khi request chạm tới fallback — `web-runtime` vẫn mount
  seat của nó y nguyên, chỉ là không bao giờ được gọi tới nữa. Không đụng, không disable
  `web-runtime`.
- **Danh sách row giữ nguyên từ `dsh-web-app`** (không patch, kể cả `web-runtime` —
  xem lý do ở trên): `web-startup` (`@deepseek-ai/dsh-web-app/startup`), `webserver`
  (`@deepseek-ai/dsh-host-webserver`), `web-runtime` (`@deepseek-ai/dsh-web-app`),
  `connection` (`@deepseek-ai/dsh-client-connection`).
- **Danh sách row đã `disabled: true` thật, chạy qua `--dump-config` xác nhận không lỗi**
  (chat UI mặc định của dsh — toàn bộ React client roster có tiền tố `ui-` + `client-hmr`,
  40 row, danh sách sinh tự động bằng awk từ dump thật, không gõ tay — xem
  `packages/bundle-core/cordis.patch.yml` trong fork để lấy id/name chính xác thay
  vì chép lại ở đây và có nguy cơ lệch khi upstream đổi). Patch chỉ cần `{id, name,
  disabled: true}` — không cần restate `config` khi row gốc không có config (đã xác nhận
  thật, không phải suy đoán).
- **Row cố tình CHƯA disable** (quyết định hoãn, không phải quên): `modules`
  (`dsh-client-modules`), `cordis-client-runner`, `api-remotes`, `file-upload`
  (`dsh-client-file-upload`), `locale`, `resources`. Các row này vẫn chạy nhưng vô hại —
  FE Next.js của ta không bao giờ gọi tới asset `/plugins/...` của chúng (đã xác nhận: root
  HTML trả về sau khi disable 40 row UI vẫn còn `<script src="/plugins/??...">` trỏ tới các
  package này — chúng chỉ là service ngầm không lộ ra ngoài một khi P1 thật (Phase 3) chiếm
  route `''`). Có thể disable sau để dọn dẹp, không phải việc bắt buộc.
- **CLI flags xác nhận thật** (`packages/bundle/web-app/src/startup.ts:51-54`, không nằm
  trong `apps/cli/src/args.ts` mà nằm trong chính bundle `web-app`, parse sau flag của
  launcher): `--host <host>`, `--port <port>`, `--no-open`, `--trusted-host <authority...>`
  (repeatable). `--host` chỉ nhận `127.0.0.1` hoặc `0.0.0.0`
  (`docs/subsystems/web-server.md:35`) — CLI stock **từ chối** `--host 0.0.0.0` ở tầng
  `dsh web` theo README, dùng tunnel thay vì patch để lách (giữ nguyên khuyến nghị
  architecture doc).

### 2.3 API để mount route riêng (thay cho "viết REST framework từ đầu")

Hai API thật, khác mục đích, cả hai đều KHÔNG cần cho việc này qua `apps/cli`:

- **`ctx.webServer.register({kind:'exact'|'prefix', path, handler})`**
  (`packages/host/webserver/src/index.ts`, ký hiệu xác nhận ở
  `docs/subsystems/web-server.md:69-76`) — raw Node `(req, res) => void`, **được phép giữ
  response mở (SSE)** — ghi rõ trong doc: "may hold the response open (e.g. SSE)". Route
  ở đây **không** tự động có auth. Dùng cho route không phải trình duyệt (ví dụ webhook
  n8n, §6).
- **`ctx.connection.fetch.register(route)`** (`packages/client/connection/src/rpc-host.ts:88-156`)
  — route kiểu Fetch API (`{path, methods, requestBody, fetch(request): Promise<Response>}`),
  đăng ký bên trong `/api` mà `dsh-client-connection` sở hữu, nên **tự động thừa hưởng
  Host/Origin trust fence + cookie browser-session auth đã có sẵn** (README
  `dsh-client-connection` — cùng cơ chế `?token=...` → cookie mà `dsh-host-frontend-static`
  dùng cho root page). Đây chính là API cho REST+SSE của Phase 2 (SSE trả về bằng
  `new Response(readableStream, {headers: {'content-type': 'text/event-stream'}})`) —
  **thay thế hoàn toàn kế hoạch v1 tự viết passphrase middleware ~80 dòng.** Ví dụ gọi
  thật cụ thể (session-log download, file-upload route) chưa tìm thấy trong thời gian
  recon — xác nhận exact request/response streaming semantics khi code Phase 2, không
  giả định thêm.

### 2.4 `DSH_HOME` — sửa lỗi so với v1

Biến env `DSH_HOME` (`packages/util/home-paths/src/index.ts:18`), mặc định `~/.dsh`
(`:12,62`). Compose của ta set `DSH_HOME=/data/harness` — không đổi. **Nhưng** tầng patch
"Home" **không phải** `$DSH_HOME/cordis.patch.yml` như v1 viết — nó là
`$DSH_HOME/profiles/cordis-app/cordis.patch.yml` (§7).

**Definition of Done — đạt:** trả lời được không cần tra lại doc: shape thật của bundle/
profile package.json, patch nhắm row bằng `id`, `--dump-config` in gì, API mount route
riêng là gì, DSH_HOME nằm đâu.

---

## 3. Phase 1 — Fork & profile (ĐÃ XONG, chạy thật)

**Mục tiêu đạt được:** `dsh --profile cordis-app` boot sạch qua HTTP thật, row của ta
(`cordis-ui` rỗng) xuất hiện trong composition, auth cookie/token của
`dsh-client-connection` hoạt động nguyên vẹn. UI upstream **chưa bị gỡ** ở phase này (xem
lý do sửa DoD bên dưới) — việc gỡ nó thật sự (route `''` che fallback) là code của Phase 3.

**Ghi chú sau v5 — §3.1 dưới đây là LỊCH SỬ, đã thay bằng §0.1:** lúc viết mục này, project
còn dùng git clone (`local-base/`, giờ đã lưu ở `../local-base.gitfork-archive/`, không phải
project hiện tại). §3.2 trở xuống (cơ chế bundle/profile/patch) **vẫn đúng nguyên xi** —
chỉ đổi package.json của bundle không còn `"workspace:^"` (không còn workspace pnpm chung
với dsh nữa — xem package.json thật tại `packages/bundle-core/package.json`, dependencies
`@deepseek-ai/dsh-*` giờ khai ở ROOT `package.json`, lý do ở §3.2 phần cuối) và
`pnpm-workspace.yaml` không còn dòng `x-packages/*/*` (thư mục đó không tồn tại nữa, xem
§0.1 cho cấu trúc thật hiện tại).

### 3.1 Fork thật — LỊCH SỬ (git-clone, đã bỏ — xem §0.1 cho cách làm thật hiện tại)

```bash
cd /Users/tyler/Documents/workspace/fpt-telecom/local-agent-core
git clone https://github.com/deepseek-ai/deepseek-harness.git local-base   # full clone, không --depth
cd local-base
git remote rename origin upstream
echo "22.23.2" > .nvmrc   # máy dev có sẵn qua nvm — không tồn tại upstream, an toàn thêm
corepack prepare pnpm@11.7.0 --activate
pnpm install && pnpm run build   # cả hai chạy sạch thật, build ~vài phút
```

### 3.2 Bundle `cordis-app` — đã tạo, đã link, đã boot được

`packages/bundle-core/package.json` thật (bản v5, npm dependency — xem file thật trong
project để chép chính xác, đây là tóm tắt shape):
```json
{
  "name": "@cordis-app/bundle-core",
  "private": true,
  "type": "module",
  "main": "./lib/index.js",
  "exports": { ".": "./lib/index.js", "./ui": "./lib/ui.js", "./gateway": "./lib/gateway.js", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { "@deepseek-ai/cordis": "4.0.2" }
}
```
**Cố tình KHÔNG có `dependencies`** dù `src/gateway.ts`/`src/ui.ts` import trực tiếp nhiều
`@deepseek-ai/dsh-*` package — lý do là một bug TypeScript thật gặp phải khi đổi sang npm
dependency (§0.1 v5): `nodeLinker: hoisted` (bắt buộc, xem dưới) vẫn tạo một bản copy vật
lý RIÊNG (không phải symlink) của bất kỳ dependency nào một package trong workspace tự khai
trực tiếp, khác với bản ở root `node_modules`. Hai bản copy giống hệt nội dung nhưng khác
đường dẫn thật khiến TypeScript coi `Session` từ bản này và bản kia là hai type khác nhau
— lỗi thật: `ctx.on('session/event', callback)` báo tham số `session` không tương thích
giữa `.../node_modules/@deepseek-ai/dsh-session` (root) và
`.../packages/bundle-core/node_modules/@deepseek-ai/dsh-session` (bản riêng của
bundle-core). **Sửa:** khai mọi `@deepseek-ai/dsh-*` đúng một lần, ở ROOT `package.json`,
để `packages/bundle-core` resolve chúng qua directory-walk-up bình thường của Node/TS
xuyên qua node_modules hoisted duy nhất — không tự khai lại ở package.json của nó.

`lib/ui.js` là JS tay viết (không qua TypeScript build — không đáng đầu tư toolchain cho
một placeholder; Phase 3 mới cần `src/`+build thật khi có logic thật):
```js
export const name = 'cordis-ui'
export function apply(ctx) {
  ctx.logger('cordis-ui').info('cordis-ui placeholder mounted (Phase 1)')
}
```

`cordis.patch.yml` — 40 row `disabled: true` (roster `ui-*` + `client-hmr`, sinh tự động
bằng awk từ `--dump-config` thật, xem §2.2) + một `insert:` cho `cordis-ui`. Nội dung đầy
đủ nằm trong file thật ở project, không chép lại ở đây.

`pnpm-workspace.yaml` (root) — bản thật v5:
```yaml
packages:
  - packages/*
  - apps/*
nodeLinker: hoisted   # BẮT BUỘC — xem đoạn trên; không có dòng này Cordis loader không
                       # thấy transitive deps (vd @deepseek-ai/dsh-llm, dep của dsh-base)
                       # lúc boot thật, dù --dump-config vẫn chạy được (không import gì)
```

### 3.3 Phát hiện quan trọng nhất của Phase 1 — profile KHÔNG resolve bundle tự do

Thử đầu tiên (bundle list `[dsh-base, dsh-web-app, @cordis-app/bundle-core]`, profile
package.json không có `dependencies`) **thất bại thật**:
```
Error: dsh: cannot resolve profile bundle "@cordis-app/bundle-core" from the dsh
installation or .../profiles/cordis-app; run 'dsh plugin --profile cordis-app install'
if its dependency is not installed
```
`@deepseek-ai/dsh-base`/`@deepseek-ai/dsh-web-app` resolve được vì chúng nằm trong
resolution graph mà chính `apps/cli` phụ thuộc; bundle của ta thì không — dsh không "đoán"
ra bundle lạ. **Sửa đúng theo thông điệp lỗi**: thêm `dependencies: {"@cordis-app/bundle-core":
"link:<đường dẫn tuyệt đối tới packages/bundle-core>"}` vào profile package.json,
rồi chạy:
```bash
dsh plugin --profile cordis-app install   # forward pnpm install trong chính thư mục profile — xác nhận: 252ms, "+ @cordis-app/bundle-core <- link"
```
Sau đó `--dump-config` mới in đúng section `# == @cordis-app/bundle-core` ở cuối. **Đây là
lý do §3.4 (entrypoint) sinh `package.json` bằng heredoc thay vì copy file tĩnh** — đường
dẫn `link:` phải là tuyệt đối và đúng với vị trí bundle trong image, không thể hard-code
sẵn trong một file commit tĩnh dùng chung cho cả dev máy host lẫn container.

### 3.4 Entrypoint bootstrap — đã viết, đã chạy end-to-end thật

`deploy/entrypoint.sh` (thật, không phải bản nháp — đã test từ `$DSH_HOME` rỗng, đúng kịch
bản container lần đầu chạy):
```sh
#!/bin/sh
set -eu
: "${DSH_HOME:?DSH_HOME must be set}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BUNDLE_DIR="$REPO_ROOT/packages/bundle-core"
PROFILE_DIR="$DSH_HOME/profiles/cordis-app"
mkdir -p "$PROFILE_DIR"
cat > "$PROFILE_DIR/package.json" <<EOF
{ "name": "dsh-profile-cordis-app", "private": true,
  "dependencies": { "@cordis-app/bundle-core": "link:$BUNDLE_DIR" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@cordis-app/bundle-core"], "patchReload": "startup" } } }
EOF
[ -f "$PROFILE_DIR/cordis.yml" ] || printf '[]\n' > "$PROFILE_DIR/cordis.yml"
[ -f "$PROFILE_DIR/cordis.patch.yml" ] || cp "$REPO_ROOT/deploy/profile-template/cordis-app/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"
cd "$REPO_ROOT"
dsh plugin --profile cordis-app install >&2
exec dsh --profile cordis-app --no-open "$@"
```
`package.json` được sinh lại **mỗi lần start** (composition/bundle-tier — đường dẫn
`BUNDLE_DIR` có thể đổi giữa các image); `cordis.yml`/`cordis.patch.yml` chỉ tạo khi thiếu
(data/tuỳ biến-tier, đúng §7). `dsh plugin ... install` chạy mỗi lần start là an toàn — đã
đo thật 252ms khi không có gì đổi ("Already up to date"), không cần mạng (link: cục bộ).

### 3.5 Chạy thử thật — kết quả

```bash
export DSH_HOME=.../data/harness-dev   # trống, mô phỏng container lần đầu
./deploy/entrypoint.sh --host 127.0.0.1 --port 3099
```
Log thật: `dsh web: http://127.0.0.1:3099/?token=...` — không lỗi. `curl /` không token →
**401** "dsh web authentication required" (đúng, không phải bug — auth free từ
`dsh-client-connection` đã sống, khớp phát hiện Phase 0 §2.3). Dùng đúng URL có
`?token=...` → **303** + `Set-Cookie` httpOnly ký sẵn → `curl /` kèm cookie → **200**, HTML
trả về **vẫn là UI mặc định của dsh** (mong đợi — `web-runtime` chưa bị che, việc che nó
bằng route `''` là code thật của Phase 3, xem §2.2/§5.1). `git diff` xác nhận `packages/`
không đổi dòng nào; đúng như kỳ vọng.

**Sửa DoD so với bản nháp trước:** yêu cầu "root không còn trả HTML dsh" bị dời sang Phase
3 — ở Phase 1 chưa có FE nào của ta để so sánh, đòi hỏi đó vô nghĩa trước khi có nó.

**Definition of Done — đạt**
- `dsh --profile cordis-app --dump-config` in đúng: rows `dsh-base` + `dsh-web-app` (40 row
  UI đã `disabled: true`) + section `@cordis-app/bundle-core` với `cordis-ui`.
- Boot thật (`--no-open`) không lỗi, log không có row "chờ mãi".
- Auth token→cookie→200 hoạt động đúng như README mô tả (đã tự tay xác nhận bằng curl,
  không phải đọc README rồi tin).
- **Sau v5:** không còn `packages/` vendor để "không sửa dòng nào" — dsh là dependency npm
  trong `node_modules/`, không commit, không sửa được kể cả lỡ tay. Invariant thật hiện tại
  (§0.3): không patch/monkeypatch code trong `node_modules/@deepseek-ai/dsh*`. Toàn bộ code
  của ta nằm trong `packages/bundle-core/`, `apps/web/`, `deploy/` — `git status` ở `core/`
  xác nhận đúng vậy, không có gì lạ ngoài các thư mục đó.

---

## 4. Phase 2 — Gateway + chat tối thiểu (P2) — BACKEND ĐÃ XONG, chạy thật

**Mục tiêu backend đạt:** boot thật, tạo session thật, gửi message thật (turn chạy hết
pipeline tới đúng chỗ dừng vì thiếu `DEEPSEEK_API_KEY` — lỗi rõ ràng, không phải crash),
SSE stream realtime thật xác nhận bằng `curl -N` chạy song song lúc gửi message, fork thật
kế thừa đúng toàn bộ log cha, interrupt/approval-respond/error-path đều đã tự tay curl qua.

### 4.1 Backend — `packages/bundle-core/src/gateway.ts` — code thật, đã build & boot

**Sửa quan trọng so với v2 (phát hiện khi đọc `packages/client/connection/src/rpc-host.ts`
thật, không phải README):** `ctx.connection.fetch.register(route)` khớp route theo
**pathname CHÍNH XÁC** (`Map<string, Route>`, không có khái niệm prefix/param) và
`assertFetchRoute` bắt mỗi segment khớp `/^[A-Za-z0-9_$.-]+$/` — **`:id` không hợp lệ**.
Không thể có `/api/v1/sessions/:id/stream` theo kiểu REST. Đổi thiết kế: path tĩnh, danh
tính đi trong query (GET) hoặc JSON body (POST) — đúng quy ước `/api/<namespace>/<method>`
mà chính Typert của dsh dùng (`docs/api-gateway.md`). Route thật đã build & test:

| Route | Method | Việc | Đã curl xác nhận |
|---|---|---|---|
| `/api/v1/sessions` | POST | Tạo session — `ctx.agents.create({sessionId: SessionId(randomUUID()), meta:{cwd}, agentOptions: ctx.agentDefaultModel.currentSelection()})`, `mkdir cwd` trước | ✅ 200, trả `{sessionId, cwd}` |
| `/api/v1/sessions` | GET | Danh sách — `ctx.sessions.list()` (chỉ session **live trong RAM**, chưa nối `session-query-sqlite` vì mặc định `openAt:'never'` — giới hạn cố ý, xem ghi chú) | ✅ 200 |
| `/api/v1/session-events?id=&since=` | GET | Replay — `ctx.sessionQuery.observeSession(id)` rồi filter `event.seq >= since` (KHÔNG gọi `session.snapshotEvents()` trực tiếp — method đó `@deprecated` cho call site mới, xác nhận trong `packages/core/session/src/index.ts:631`) | ✅ 200 |
| `/api/v1/session-stream?id=` | GET | SSE thật — đăng ký `ctx.on('session/event', (session,event)=>{}, {global:true})` **TRƯỚC** khi đọc snapshot ban đầu (tránh lọt event giữa hai bước), trả `new Response(readableStream,...)` | ✅ xác nhận bằng `curl -N` chạy song song, nhận đủ toàn bộ 17 event của 1 turn realtime |
| `/api/v1/session-messages` | POST | `agent.followup(createUserMessage({content:[{type:'text',text}], source:{kind:'user'}}))`; nếu session nguội thì `ctx.agents.resume()` trước (dedupe qua `Map<id,Promise>` — 2 request đồng thời cho cùng id nguội không được resume 2 lần) | ✅ turn chạy hết pipeline, dừng đúng chỗ ở lỗi `MISSING_CREDENTIAL` (Phase 4) |
| `/api/v1/session-interrupt` | POST | `agent.cancel({kind:'user'})` | ✅ 200 kể cả khi agent đang idle |
| `/api/v1/session-fork` | POST | `ctx.agents.create({sessionId: new, meta:{parentSession, isSeeded:true, cwd}, inheritedEventCount: SessionLogOffset(events.length), seed: events})` — **từ chối fork nếu turn đang mở** (`seed` phải là "balanced completed-turn prefix", xác nhận trong docstring `CreateAgentOptions.seed`) | ✅ session mới kế thừa đủ 17 event của cha |
| `/api/v1/session-approvals?id=` | GET | Liệt kê approval đang chờ trong `Map` nội bộ | ✅ 200, rỗng khi không có gì chờ |
| `/api/v1/session-approval-respond` | POST | `resolve(outcome)` cho pending theo `callId` | ✅ 404 đúng khi `callId` không tồn tại |

**Sửa quan trọng #2 — không phải `ctx.sessions.fork()`:** xác nhận thật, fork luôn qua
`ctx.agents.create()` với `inheritedEventCount` (tên field chính xác — architecture doc cũ
đoán `seedLength`, sai).

**Approval answerer — việc thật mới, không có sẵn upstream để mượn** (`ui-approval` gắn
chặt vào React client dsh đã loại bỏ): `ctx.on('approval/request', (req, next) => {...})`
— **không cần `{global:true}`** (khác `session/event`) — xác nhận bằng cách đọc thật
`packages/acp/acp/src/index.ts:155-173`, ACP tự đăng ký y hệt vậy ở scope plugin-level và
nhận đủ mọi agent. Nếu `req.callId === undefined` thì `next()` (không có gì để REST client
trỏ vào); ngược lại lưu `Promise` resolver vào `Map<callId, PendingApproval>`, expose qua
hai route GET/POST ở trên. `req.signal` abort → tự resolve `'cancelled'`.

**Build tooling mới cho `packages/bundle-core`** (không có ở Phase 1, cần vì
gateway.ts là code thật đầu tiên đáng build): `tsconfig.json` riêng, extends
`tsconfig.base.json`, **`paths: {}`** ghi đè (base map `@deepseek-ai/cordis` sang
`vendor/cordis/src` cho project-reference graph của monorepo chính — nếu không ghi đè,
`tsc` kéo cả source vendor vào rootDir của ta và lỗi, **đã tự dính lỗi này thật, đã dọn
sạch file rác sinh ra trong `vendor/*/src/`** trước khi hiểu ra cách sửa đúng). Dùng
`tsc -p` (không `-b`/composite build) để không kích hoạt rebuild vendor. Mọi package
value-import thật (không phải `import type`) phải khai trong `dependencies` (không chỉ
`devDependencies`) — pnpm strict isolation. Ba package chỉ dùng qua `ctx.<key>` (không có
value-import nào) vẫn cần `import type {} from '<pkg>'` để kéo augmentation
`declare module '@deepseek-ai/cordis'` vào chương trình biên dịch — thiếu dòng này TS báo
"Property does not exist on type Context" dù đã cài đúng dependency.

**Bẫy runtime đã tự dính và tự sửa:** quên khai `export const inject = [...]` liệt kê mọi
`ctx.<key>` đọc trực tiếp → boot fail loud "cannot get property \"connection\" without
inject" (đúng theo quy ước ghi trong `packages/CLAUDE.md` của chính dsh — đọc được lúc còn
git-fork, giờ nằm trong `../local-base.gitfork-archive/packages/CLAUDE.md`, không có bản
vendor nào trong `core/` để đọc trực tiếp nữa vì dsh giờ chỉ nằm trong `node_modules/`):
property access cần khai `inject`,
`ctx.get(name)` mới là cách đọc optional không cần khai).

### 4.2 Frontend — `apps/web` — ĐÃ XONG, build thật + serve thật qua dsh

**Lịch sử vị trí (không còn áp dụng từ v5):** lúc còn git-fork (`local-base/` cũ), `apps/web/`
đã bị chiếm bởi chính frontend React/Vite gốc của dsh (`@deepseek-ai/dsh-web-frontend`, thứ
`web-runtime` resolve qua `require.resolve()`, xem §2.2/§5.1) — phải đặt FE của ta ở
`x-packages/app/web/` để tránh đụng. Từ v5 (npm dependency, không còn vendor `packages/`
nào trong project), **không còn collision** — `apps/web/` giờ hoàn toàn tự do và đúng vị
trí architecture doc gốc muốn.

**Sửa routing quan trọng:** không dùng `/chat/[sessionId]` (dynamic path segment) như mọi
bản trước ghi — `serveStatic()` (P1) **không có SPA fallback chung cho path lạ** (đọc
đúng source: absent/non-file target → 404 thẳng, không fallback về index.html — chính
README của `dsh-host-frontend-static` nói rõ "explicit failure rather than a silent SPA
fallback"). Một path segment sẽ 404 khi reload trực tiếp. Đổi sang: **một route tĩnh
`/` duy nhất**, chọn session qua **query string** `?session=<id>` đọc bằng
`useSearchParams()` (bọc trong `<Suspense>` theo yêu cầu của Next static export) — query
string không đổi pathname nên luôn khớp `distIndex`.

**Package riêng biệt, KHÔNG chung pnpm workspace với phần còn lại** — phát hiện qua lỗi
thật (lúc còn git-fork): đặt `apps/web` chung workspace glob với phần backend, build
`next build` lỗi type thật khó hiểu (`Suspense` không gán được vào `ReactNode` — hai định
danh `ReactNode` khác nhau dù cùng version) do React 19 của FE và React 18 của
`dsh-web-frontend` (frontend gốc dsh, lúc đó còn vendor trong `packages/`) cùng nằm trong
một workspace pnpm với dependency graph liên kết chéo. Dù từ v5 không còn `dsh-web-frontend`
vendor trong project nữa (npm dependency không kéo theo nó), quyết định giữ `apps/web`
độc lập vẫn đúng — không có lý do để FE (React/Next) và backend (Cordis plugin) chung một
`node_modules`. **`apps/web/pnpm-workspace.yaml` riêng (`packages: [.]`)** — cùng kỹ thuật
làm profile dir độc lập ở Phase 1 — biến nó thành một pnpm project hoàn toàn tách biệt, tự
`pnpm install` (lockfile riêng, `node_modules` riêng). Kèm `next.config.mjs` set
`outputFileTracingRoot` để tắt warning "nhầm workspace root" do có 2 lockfile lồng nhau.

**Tech stack thật đã cài** (khác v1 một chỗ: bỏ react-hook-form+zod, shiki — chưa cần cho
Phase 2, để dành Phase 4 settings form): Next.js 15.5, React 19.3, TanStack Query v5,
Zustand v5, react-markdown v9, Tailwind v4 (`@tailwindcss/postcss`, không cần
`tailwind.config.js` — CSS-first). TypeScript **5.9, không phải 6.x** — thử `^6.0.3` (khớp
root dsh) trước, dính đúng lỗi `Suspense`/`ReactNode` ở trên (khác nguyên nhân với vụ
workspace — cả hai đều biểu hiện giống hệt nhau, đã xác nhận riêng biệt bằng cách sửa từng
cái một); TS 5.7-5.9 build sạch ngay.

**File thật:** `lib/api.ts` (client REST khớp đúng gateway — path tĩnh, id qua query/body),
`lib/store.ts` (Zustand — "stream đang chạy, composer" như architecture doc §3.1 chỉ định),
`lib/use-session-stream.ts` (native `EventSource` — **không tự viết reconnect**: browser tự
gửi lại `Last-Event-ID` khi tự reconnect, cookie same-origin tự kèm theo, gateway
`session-stream` đã replay đúng suffix — không cần logic thủ công), `components/
conversation.tsx` (dispatch theo `event.type`, bubble cho user/assistant/system message,
banner lỗi cho `turn/end` reason lỗi, dòng gọn cho mọi type khác — MVP, chưa render
`assistant/chunk` theo từng token), `components/composer.tsx`, `components/approvals.tsx`
(refetch **event-driven** khi thấy `approval/asked`/`approval/decided` qua SSE, không
polling).

**Đã boot thật và curl xác nhận root trả về đúng HTML của ta** (không phải chat UI mặc định
của dsh) sau khi giải quyết thêm một phát hiện mới (kéo một phần việc Phase 3 vào sớm, xem
§5.1): `ctx.webServer.renderIndex()` mà route P1 gọi trên chính `index.html` của ta chạy
**chung** cơ chế `webserver/index-inject` với MỌI plugin đang bật — `dsh-client-modules`
(chưa disable ở lần đầu) tự tiêm `window.__ModuleLoader__`/`__DSH_BOOT__` vào ngay `<head>`
trang của ta dù không ai gọi tới. Sửa: thêm `modules`, `cordis-client-runner`, `api-remotes`
vào danh sách disable trong `cordis.patch.yml`. `file-upload` **phải giữ lại** — thử disable
luôn thì boot fail thật (`@deepseek-ai/dsh-api-session-controller: waiting for service:
fileUploads`) vì `session-controller` (một hàng khác của `dsh-web-app`) inject cứng nó.

**Bug tự dính và tự sửa đáng nhớ:** `workspaceRoot()` mặc định `process.cwd()` khi request
tạo session không truyền `cwd` — lúc chạy qua `pnpm dsh` thì `cwd` chính là **gốc git repo
`core/`**, tạo ra thư mục UUID rác ngay trong repo (`235af5da-.../`, đã tự phát hiện
qua `git status` và dọn sạch). Sửa: mặc định `os.tmpdir()/cordis-workspace`, không bao giờ
`process.cwd()`.

**Definition of Done — đạt:**
- `next build` xuất ra `out/index.html` + `out/_next/...` sạch, không lỗi type.
- Boot thật, `curl /` (có cookie) trả về đúng HTML của Next.js app (xác nhận qua build-id
  comment khớp `out/index.html`), không còn dấu vết UI/boot-script của dsh.
- Asset tĩnh (`_next/static/...`) trả 200 qua route của ta.
- API gateway (`/api/v1/sessions`) vẫn hoạt động song song bình thường trên cùng server.
- Chưa test được trên trình duyệt thật (môi trường không có browser) — đã test đầy đủ bằng
  curl (HTML, asset, API); test tay trên trình duyệt thật (bấm nút New chat, gõ tin nhắn,
  thấy stream chạy) là việc còn lại trước khi coi Phase 2 là "đã dùng được", nên làm ngay
  khi có máy có browser truy cập được `http://<host>:3099`.

---

## 5. Phase 3 — Đóng gói một image (P1)

### 5.1 `packages/bundle-core/src/ui.ts` — ĐÃ LÀM XONG THẬT (kéo sớm từ Phase 2, không chờ Phase 3)

Code thật (không phải nháp) nằm trong file thật ở fork — tóm tắt: `serveStatic()` (export
riêng, độc lập `apply()`, `packages/host/frontend-static/src/index.ts:66-104`) qua
`ctx.webServer.register({kind:'prefix', path:'', handler})` — **không**
`ctx.plugin(FrontendStatic, {distIndex})` (tranh seat fallback với `web-runtime`, đã xác
nhận unconditional trong `packages/bundle/web-app/src/index.ts:232`, throw "second
registration" — đã tự dính lỗi này lúc code thật rồi mới hiểu tại sao cách kia sai).
`distIndex` trỏ `apps/web/out/index.html` (Next.js `output:'export'` xuất ra `out/`, không
phải `dist/` như architecture doc gốc giả định), qua biến môi trường `CORDIS_UI_DIST_INDEX`
(Docker) hoặc đường dẫn tương đối mặc định (dev). Fail loud thật (`existsSync` lúc `apply()`, không đợi tới request) nếu
chưa build — bổ sung so với `serveStatic()` gốc (gốc chỉ fail per-request, không fail lúc
activate).

`web-runtime` (`dsh-web-app`) vẫn mount seat fallback của nó y nguyên — không đụng, không
disable — chỉ là không bao giờ được webserver gọi tới nữa vì route `prefix ''` khớp trước
(exact table → prefix dài nhất → fallback, `docs/subsystems/web-server.md:27`). **Phát hiện
thêm lúc test thật** (không có trong tài liệu upstream, tự suy ra từ hành vi quan sát được):
`ctx.webServer.renderIndex()` — bắt buộc phải gọi để `webserver/index-inject` hoạt động
đúng — tiêm nội dung từ **MỌI** plugin đang bật đăng ký event đó, kể cả plugin không liên
quan gì tới ta (`dsh-client-modules`). Xử lý bằng cách disable `modules`,
`cordis-client-runner`, `api-remotes` (xem cordis.patch.yml thật, đã cập nhật ở §4.2) —
không phải bug của `serveStatic()`/`renderIndex()`, là hệ quả tất yếu của việc dùng chung
webserver row với `dsh-web-app` mà không disable hết các plugin client-side không cần.

### 5.2 Auth single-user — GẦN NHƯ MIỄN PHÍ (khác hẳn v1)

`dsh-client-connection` đã tự làm toàn bộ: launch token trong URL (`?token=...`) →
signed HttpOnly cookie, Host/Origin trust fence chống DNS rebinding, `trustedHosts` config
cho remote access, secret ký cookie lưu trong `ctx.credentials` (`$DSH_HOME/.credentials.yaml`).
**Không viết middleware passphrase riêng.** Việc cần làm ở Phase 3 chỉ là:
- Local: không cấu hình gì thêm, mặc định `127.0.0.1`.
- VM: set `--trusted-host <host>` (flag thật ở `packages/bundle/web-app/src/startup.ts:54`)
  khi chạy qua Tailscale/tunnel, không publish port ra ngoài.

### 5.3 Dockerfile + compose — ĐÃ LÀM XONG, `docker compose up` chạy thật (bản v5, npm dependency)

`deploy/core.Dockerfile`, vẫn 3 `FROM` (không đổi số stage so với bản git-fork, nhưng
`core-builder` giờ nhẹ hẳn — không còn biên dịch monorepo dsh):
- **web-builder**: `node:22-bookworm-slim`, cài+build `apps/web` (lockfile riêng của
  chính nó, xem §4.2) → `out/`.
- **core-builder**: `node:22-bookworm-slim`, copy `package.json`+`pnpm-lock.yaml` (root) +
  `packages/bundle-core/package.json` trước để cache layer cài đặt, `pnpm install
  --frozen-lockfile` (571 package, ~10s — so với build cả monorepo ~3 phút ở bản git-fork),
  rồi copy source thật + `pnpm --dir packages/bundle-core run build`.
- **runtime**: `node:22-bookworm-slim` + `pnpm` (cài global — xem lý do dưới) + `socat` (xem
  lý do dưới), copy toàn bộ cây từ core-builder, ghi đè `apps/web/out` từ
  web-builder (giữ nguyên layout tương đối để `ui.ts`'s default path — không cần set
  `CORDIS_UI_DIST_INDEX` trong Dockerfile, layout image giống hệt layout dev).

**Kết quả đo được:** image 1.84GB (git-fork) → **513MB** (npm dependency), build image từ
đầu ~3 phút → **dưới 1 phút**. Cùng chức năng, đã curl xác nhận lại y hệt bên dưới.

**Phát hiện thật, chỉ thấy được khi build/chạy Docker thật, không đoán trước được:**

1. **(Chỉ áp dụng bản git-fork cũ, không còn gặp ở v5)** `git rev-parse HEAD` fail trong
   build vì `pnpm run build` của monorepo dsh cần commit hash cho client build metadata mà
   `.git/` đã bị loại khỏi context — sửa bằng biến `DSH_CLIENT_COMMIT_HASH`. Bản v5 không
   còn `pnpm run build` cho dsh (chỉ cài qua npm), vấn đề này biến mất hoàn toàn, không
   phải "đã sửa" mà là "không còn tồn tại".
2. **`lib/` gitignore/dockerignore rule nuốt nhầm source thật — gặp LẠI ở v5, y hệt bug
   cũ:** root `.gitignore`/`.dockerignore` có rule `lib/` không neo, khớp cả `apps/web/lib/`
   là code tay viết (không phải build output như `packages/bundle-core/lib/`) — vẫn phải
   thêm negation `!apps/web/lib/` + `!apps/web/lib/**` ở CẢ HAI file, y hệt cách đã sửa ở
   Phase 2 cho `.gitignore` — bug tái diễn vì đây là quy luật chung của cách đặt tên thư
   mục `lib/` cho cả build-output lẫn source, không phải lỗi riêng một lần.
3. **Quan trọng nhất, không đổi so với bản git-fork — `--host 0.0.0.0` bị chặn cứng + Docker không forward tới
   `127.0.0.1` trong container:** `packages/bundle/web-app/src/startup.ts:74-75` throw usage
   error thẳng khi `--host === '0.0.0.0'` ("intentionally not supported yet for safety").
   dsh chỉ bind `127.0.0.1` được. Nhưng test thật trên Docker Desktop (macOS): container
   chạy đúng, `docker exec` vào gọi `http://127.0.0.1:3080/` từ BÊN TRONG container trả lời
   đúng (401 như kỳ vọng) — còn `curl` từ HOST qua cổng publish (`127.0.0.1:3080:3080`) trả
   về **"Empty reply from server"**, connection TCP thành công nhưng không có response nào.
   Docker Desktop không route port publish tới service chỉ bind loopback bên trong
   namespace container ở cấu hình này. **Sửa:** thêm `socat` bên trong container, bind
   `0.0.0.0:$CORDIS_PORT` (mặc định 3080, cái Docker publish ra), forward vào
   `127.0.0.1:$CORDIS_INTERNAL_PORT` (mặc định 3081, cái dsh thực sự lắng nghe) — chạy nền
   trong `entrypoint.sh` trước khi `exec` dsh. Đã build lại, `docker compose up`, curl qua
   `127.0.0.1:3080` từ host thành công (200/401 đúng ngữ cảnh) sau khi thêm socat — xác
   nhận nguyên nhân đúng, không phải đoán.

`entrypoint.sh` gọi thẳng `"$REPO_ROOT/node_modules/.bin/dsh"` (đường dẫn file trực tiếp,
không dựa vào PATH). **Khác so với bản git-fork:** lúc đó `node_modules/.bin/dsh` không
đảm bảo tồn tại ngay sau install+build đầu tiên (bin symlink của `apps/cli` trong monorepo
chỉ tạo đúng nếu `lib/bin.js` đã có SẴN lúc `pnpm install` chạy, mà lúc đó nó chưa được
build — từng phải tự tạo symlink tay lúc dev). Ở v5, `@deepseek-ai/dsh` là package npm đã
build sẵn trong tarball — `node_modules/.bin/dsh` luôn đúng ngay sau `pnpm install`, đã xác
nhận thật (`ls -la node_modules/.bin/dsh` ra symlink hợp lệ ngay lần cài đầu tiên, không
cần workaround). Vẫn gọi qua đường dẫn file trực tiếp cho chắc, không phải vì cần thiết
nữa mà vì không tốn gì để giữ.

`deploy/docker-compose.yml`: `../data/harness:/data/harness` (không phải `./data/harness`
— compose resolve path tương đối theo vị trí CHÍNH FILE compose, `deploy/`, nên cần `../`
để `data/` nằm ở gốc repo, không lồng trong `deploy/`), `workspace:/workspace` (named
volume, khớp `CORDIS_WORKSPACE_ROOT=/workspace` set trong Dockerfile), publish
`127.0.0.1:3080:3080`, `cap_drop:[ALL]`, `security_opt:["no-new-privileges:true"]`. Chưa có
service `n8n` (Phase 6).

**Definition of Done — đạt, xác nhận bằng Docker thật (không phải giả lập):**
- `docker compose -f deploy/docker-compose.yml build` chạy sạch từ context sạch (`context: ..`
  trong compose = gốc `core/`, `.dockerignore` loại `node_modules/` host và `out/`/`.next/`
  của `apps/web`) — image `cordis-core:dev`, **513MB** (so với 1.84GB của bản git-fork cũ —
  xem bảng so sánh đầu tài liệu).
- `docker compose up -d` → boot sạch, log in đúng dòng `dsh web: http://127.0.0.1:3081/...`.
- `curl http://127.0.0.1:3080/` (cổng publish, qua socat) → 401 không token, 200 có
  cookie đúng — xác nhận từ HOST thật, không phải từ trong container.
- Tạo session qua `/api/v1/sessions` → `cwd` nằm dưới `/workspace/...` (đúng volume, không
  phải `process.cwd()` của image).
- `docker compose restart core` → cookie cũ (ký từ trước restart) vẫn còn hiệu lực (secret
  ký cookie bền trong `DSH_HOME/.credentials.yaml`), và **`GET /api/v1/session-events`**
  của session tạo trước restart đọc lại đúng dữ liệu (cold read qua
  `ctx.sessionQuery.observeSession()`, xác nhận session log thật sự bền trong bind mount —
  `GET /api/v1/sessions` (chỉ liệt kê session **live**) trả rỗng sau restart, đúng giới hạn
  đã ghi nhận ở §4.2, không phải mất dữ liệu).

---

## 6. Phase 4 — Model + credential (P3) — ĐÃ XONG, chạy thật

**Đổi lớn nhất so với v1: không viết plugin `llm-openai-compat`, và không dùng
`ctx.remote.settings`/`ctx.remote.credentials` (Host Remote/RPC — xem
`@deepseek-ai/dsh-api-settings-controller`) dù package đó tồn tại sẵn trong `dsh-base` —
namespace đó phục vụ RPC client của chính dsh (`dsh-client-connection`'s rpc-host), FE của
ta không nói giao thức đó. Giữ nguyên convention path tĩnh + GET query/POST body của
Phase 2, thêm route mới thẳng vào `gateway.ts`, gọi trực tiếp `ctx.llm`/`ctx.agentDefaultModel`/
`ctx.credentials` — không dùng lại RPC controller, không viết storage riêng.**

`llm-pi-ai` (`@deepseek-ai/dsh-llm-pi-ai`) đã ở trong `dsh-base` mặc định (xác nhận trong
dump thật §2.2 và lại lần nữa ở đây), theo README: "custom provider, base URL, protocol,
model discovery, reasoning effort, credential qua reference" — đúng thứ architecture doc
muốn (DeepSeek/vLLM/OpenRouter/LM Studio/Ollama qua một adapter OpenAI-compatible). Route
thật đã thêm vào `packages/bundle-core/src/gateway.ts` (`inject` thêm `'llm'`,
`'credentials'`):

- `GET`/`POST /api/v1/model` — đọc/ghi `ctx.agentDefaultModel.currentSelection()`/
  `saveSelection({provider, model, reasoningEffort?})`. `reasoningEffort` branded qua
  `ReasoningEffortId()` (từ `@deepseek-ai/dsh-llm`) trước khi truyền xuống.
- `GET /api/v1/model-providers` — `ctx.llm.listProviders()` (route đang sống) +
  `ctx.llm.listConfigurableProviders()` (route pi-ai biết cách kích hoạt nhưng chưa cấu
  hình — **API thật, không phải danh sách tự chế**: test thật trả về đúng
  `deepseek-official` đã live, cộng ~35 route pi-ai (openai, anthropic, openrouter,
  google, xai, groq, mistral, together, fireworks, ...) ở trạng thái "declared, chưa cấu
  hình" — đúng ý "OpenAI-compatible adapter phủ nhiều provider" của architecture doc mà
  không cần code thêm gì).
- `GET /api/v1/model-catalog?provider=<id>` — `ctx.llm.listModels(provider)`; test thật
  với `deepseek-official` trả đúng 4 model thật (`deepseek-flash`, `deepseek-v4-flash`,
  `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`) kèm tên/mô tả/modality.
- `GET`/`POST /api/v1/credentials` — describe/set/unset qua `ctx.credentials`
  (`credentialRef()`/`isCredentialRefName()` từ `@deepseek-ai/dsh-credentials`, thêm làm
  dependency root ở version `0.1.5-rc.2` — **khác** với version pin `0.1.5-rc.1` của mọi
  package khác, vì đây là `peerDependencies` transitive từ `dsh-credentials-local`/
  `dsh-llm-pi-ai` chứ không phải dep trực tiếp của CLI; đã kiểm tra thật chỉ có MỘT bản
  trong `node_modules` trước khi pin, để không lặp lại bug duplicate-identity của §3). Danh
  sách ref cố định trong response GET không-query (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) chỉ để tránh round-trip từng cái một — POST
  nhận **bất kỳ** ref hợp lệ POSIX identifier nào, không giới hạn 4 cái đó.
- Route settings profile-level (`--patch`/`DSH_HOME/profiles/cordis-app/cordis.patch.yml`,
  §7) **không cần đụng tới** cho việc đổi default model — đó chỉ là cách thay đổi ở tầng
  composition (khi build image/deploy); runtime UI đổi qua `saveSelection()` là đủ, không
  restart. Patch profile vẫn là đường tắt hợp lệ nếu operator muốn set default cứng vào
  deployment thay vì để trống rồi chỉnh qua UI.

**FE**: không tạo route Next.js con `/settings/models` — lặp lại đúng bug đã né ở §4.2
(`serveStatic()` không có fallback, một path con không có file thật sẽ 404 y hệt
`/chat/[sessionId]`) — verify lại bằng cách đọc thẳng `dsh-host-frontend-static`'s
`serveStatic()` source (`target = resolve(join(distRoot, pathname))`, không có logic thử
`.html`/index nào ngoài đúng `distIndex`). Dùng chung route `/` với `?view=settings` (cùng
kiểu `?session=<id>` đã có), thêm `apps/web/components/settings-models.tsx` render trong
`Home()`. Không dùng `ui-settings-models` của dsh (đã disable từ §3, gắn với React client
dsh).

**Definition of Done — đạt, xác nhận bằng boot thật + curl thật (profile test cô lập,
không đụng `~/.dsh` thật của máy dev):**
- `POST /api/v1/model` đổi `deepseek-flash` → `deepseek-v4-pro` + `reasoningEffort: high`,
  `GET` ngay sau đó phản ánh đúng, **không restart** — đúng DoD gốc.
- `docker compose restart`-tương-đương (kill + boot lại process, cùng `DSH_HOME`): `GET
  /api/v1/model` sau restart vẫn trả `deepseek-v4-pro`/`high` — xác nhận ghi thật vào
  `$DSH_HOME/settings.yaml` (`agent-default-model:` section), không phải state RAM.
- `POST /api/v1/credentials` set `DEEPSEEK_API_KEY` → `describe()` trả `configured: true,
  source: "file"`, **không có field value nào trong response**; `GET
  /api/v1/model-providers`/`--dump-config` không hề chứa giá trị đó ở đâu — đúng thiết kế
  `credentials-local`: tool chỉ nhận reference. `POST` với ref sai grammar
  (`"not a valid ref!"`) → `400`, không throw 500.
- `GET /api/v1/model-providers` trả đúng route sống (`deepseek-official`) lẫn route chưa
  cấu hình (toàn bộ catalog pi-ai) — không phải danh sách tay.

---

## 7. Phase 5 — Patch layer (sửa lại — chỉ MỘT tầng, không phải hai) — ĐÃ XONG, test thật

**Sửa lỗi quan trọng so với v1:** architecture doc gốc mô tả 4 tầng patch gồm "Profile"
và "Home" tách biệt (`packages/.../cordis.patch.yml` cho Bundle,
`DSH_HOME/cordis.patch.yml` cho Home). Thực tế dsh chỉ có: **patch của từng bundle trong
stack** (rebuild-tier, ở `packages/bundle-core/cordis.patch.yml`) → **MỘT file
patch profile duy nhất** tại `$DSH_HOME/profiles/cordis-app/cordis.patch.yml`
(`packages/boot/app-boot/src/profile.ts:45,181,794`) → `--patch` overlay CLI (một lần
chạy). Không có file `$DSH_HOME/cordis.patch.yml` riêng nào khác. Đây chính là file được
tạo trống bởi entrypoint ở §3.4 nếu chưa tồn tại.

**Việc cụ thể — đã làm, xem `docs/patch-cookbook.md` cho nội dung đầy đủ**

1. `docs/patch-cookbook.md` đã viết: 3 bước (dump-config → sửa patch → restart), 3 ví dụ
   thật (tắt một row, đổi `agent-default-model` ở tầng composition, thêm provider
   `llm-pi-ai` tuỳ chỉnh), phân biệt rõ patch này (tầng Home/profile,
   `data/harness/profiles/cordis-app/cordis.patch.yml`) với patch bundle-level
   (`packages/bundle-core/cordis.patch.yml`, rebuild-tier, đã dùng từ §3).
2. Xác nhận thật (không phải đọc README rồi tin): file patch **0 byte** làm
   `--dump-config` thoát ngay với `Error: dsh: overlay ... must be a top-level YAML array
   of loader patch entries` — message thật, đã copy nguyên văn vào cookbook. `[]` là cách
   đúng để nói "không patch gì"; entrypoint (§3.4) tạo đúng vậy, chỉ một lần, không bao giờ
   ghi đè lại.
3. Test tay thật trên profile cô lập (không phải Docker, nhưng cùng cơ chế
   `patchReload: startup` + bind-mount path): tạo session thật, gửi message, patch tắt row
   `session-log-download`, kill + restart process, xác nhận (a) `--dump-config` cho thấy
   dòng `# == ..., patched by <path>` + `disabled: true` đúng row, và (b) `GET
   /api/v1/session-events` của session tạo TRƯỚC patch vẫn đọc lại đúng toàn bộ event sau
   restart — không mất lịch sử. Test thêm: patch `agent-default-model`'s `config` (tầng
   composition) đổi default → `GET /api/v1/model` (Phase 4) phản ánh đúng, **không đụng**
   `settings.yaml` — hai tầng (patch composition vs. settings user layer) độc lập, đúng như
   `dsh-agent-default-model`'s README mô tả.

**Definition of Done — đạt:** tắt được một tool row bằng sửa đúng một file YAML từ ngoài
container + restart, không rebuild, không mất lịch sử chat. Cả 3 vế đã xác nhận bằng test
thật ở trên, không phải suy luận từ tài liệu.

---

## 8. Phase 6 — n8n (P4) — ĐÃ XONG, backend + FE + compose, test thật với n8n thật

**Phát hiện quan trọng nhất, KHÔNG có trong bản nháp v1 — xác nhận bằng cách dump OpenAPI
spec thật của một container n8n 2.19.5 thật (`docker run n8nio/n8n`, không phải đọc docs
hay đoán): n8n's public REST API (`/api/v1`) KHÔNG CÓ endpoint "run workflow"/"execute
workflow" nào cả.** Toàn bộ path thật (`/workflows`, `/workflows/{id}`,
`/workflows/{id}/activate`, `/workflows/{id}/deactivate`, `/workflows/{id}/tags`,
`/executions`, `/executions/{id}`, `/executions/{id}/retry`, `/executions/{id}/stop`, ...)
— không có gì khác. Cách DUY NHẤT để kích hoạt một workflow từ bên ngoài là POST thẳng vào
URL của chính node Webhook trigger trong workflow đó (`{baseURL}/webhook/{path}`), và URL
đó 404 cho tới khi workflow được activate — xác nhận thật bằng chu trình đầy đủ: tạo
workflow → activate → POST webhook → execution ghi nhận `status: "success"`. Vì vậy
`n8n_run_workflow` (§ dưới) đọc `n8n_get_workflow` để tìm node Webhook rồi POST thẳng vào
đó, KHÔNG gọi một endpoint "run" nào — không tồn tại.

**Phát hiện thứ hai:** API-key scope để activate/deactivate tên là `workflow:activate`/
`workflow:deactivate` dù tên hiển thị người dùng và mô tả HTTP path gọi hành động này là
"publish" ở bản n8n này — xác nhận bằng cách thử `workflow:publish` (bị từ chối "Invalid
scopes for user role") rồi tra đúng danh sách qua endpoint nội bộ
`GET /rest/api-keys/scopes` của chính n8n.

**Việc đã làm — `packages/bundle-core/src/n8n.ts`, build sạch + test thật:**

1. 7 tool: `n8n_list_workflows`, `n8n_get_workflow`, `n8n_validate_workflow` (cục bộ,
   không gọi API — check field/type/tham chiếu node hợp lệ), `n8n_upsert_workflow` (tạo
   luôn `active: false` — n8n tự đảm bảo field này `readOnly` khi tạo, không phải điều ta
   tự kiểm; PUT để update), `n8n_activate_workflow` (qua `ctx.approval.request()`, dùng lại
   answerer đã xây ở Phase 2 — test thật: outcome `rejected` → tool throw đúng, không gọi
   API), `n8n_run_workflow`, `n8n_get_execution`.
2. Đúng quy tắc bắt buộc: tag `agent-generated` + `session:<id>` sau khi tạo — nhưng việc
   gắn tag là dance 2 bước thật của n8n (tag là entity có `id` riêng — `POST /tags` tạo,
   `GET /tags` tra cứu theo tên vì không có filter theo tên — rồi `PUT
   /workflows/{id}/tags` với mảng `[{id}]` mới thật sự gắn; không có cách gắn tag theo tên
   ngay trong body tạo/sửa workflow).
3. **Phát hiện thật lúc test, đã tự sửa:** `getOrCreateTag` (đọc-rồi-tạo) dính race thật —
   n8n's tag-create endpoint từ chối một cái tên là trùng ("Tag already exists") ngay cả
   khi `GET /tags` KHÔNG BAO GIỜ liệt kê tên đó (tái hiện nhiều lần với tên tag hoàn toàn
   mới, không phải do test cũ để lại) — nghi là index unique mồ côi phía n8n, không phải
   lỗi phía ta. Sửa bằng cách: bắt lỗi "already exist", re-fetch một lần; nếu vẫn không
   thấy, log warning qua `ctx.logger.warn` và **tiếp tục tạo workflow mà không có đúng cái
   tag đó** thay vì làm hỏng cả lần tạo workflow — tag là tiện ích thêm, không phải điều
   kiện để workflow tồn tại an toàn (`active: false` đã tự n8n đảm bảo).
4. Response của `POST /workflows` chưa có tag (tag gắn ở bước SAU) — sửa để trả lại tag
   thật đọc được từ chính response của `PUT .../tags`, không trả nguyên object cũ.
5. `n8n_run_workflow`: đọc workflow qua `GET /workflows/{id}`, kiểm `active` (báo lỗi rõ
   ràng nếu chưa activate — khớp đúng hành vi 404 thật của n8n), tìm node
   `n8n-nodes-base.webhook` đầu tiên, đọc `parameters.path`/`parameters.httpMethod`, POST
   thẳng — không qua `/api/v1`, không cần API key (xác nhận thật: webhook URL của n8n
   không yêu cầu auth trừ khi node tự thêm).
6. Webhook ngược (n8n → ta): route `POST /api/v1/hooks/n8n` qua `ctx.webServer.register()`
   (raw handler, không qua `ctx.connection.fetch` — đúng vì n8n không phải trình duyệt,
   không có cookie). Khác bản nháp: n8n không có chữ ký HMAC sẵn có như GitHub
   (`X-Hub-Signature-256`), nên xác thực bằng **shared secret** qua header
   `x-n8n-webhook-secret`, so sánh bằng `crypto.timingSafeEqual` (constant-time), đọc secret
   qua credential reference (`ctx.credentials`, không phải hằng số) — cùng tinh thần với
   HMAC (không dò được qua timing) nhưng khớp đúng thứ n8n's HTTP Request node thực sự gửi
   được. `WebhookRule` đọc `event.workflowId` từ payload, map sang `config.routes[workflowId]`
   → dựng `WorkspaceSessionRequest`, prompt = title + payload gắn nhãn "UNTRUSTED".
7. **Phát hiện thật khi boot:** `@deepseek-ai/dsh-webhook` (chính service cung cấp
   `ctx.webhookRuntime`) KHÔNG nằm trong composition mặc định của `dsh-base`/`dsh-web-app`
   — chỉ thêm plugin tiêu thụ (`@cordis-app/bundle-core/n8n`) là chưa đủ, boot fail thật:
   `waiting for service: webhookRuntime`. Phải insert CẢ HAI row
   (`@deepseek-ai/dsh-webhook` rồi `@cordis-app/bundle-core/n8n`) cùng lúc.

**Quyết định thiết kế: n8n KHÔNG nằm trong `packages/bundle-core/cordis.patch.yml` mặc
định** (khác với `cordis-ui`/`cordis-gateway`) — plugin `n8n_*`'s `Config.baseURL` là
`required()`, một `insert` không kèm config hợp lệ sẽ fail validate ngay lúc load. n8n là
tích hợp CẦN hạ tầng ngoài (một n8n instance thật), nên bật theo đúng mô hình opt-in của
Phase 5/`docs/patch-cookbook.md`: operator tự insert 2 row đó + `config.baseURL`/
`config.routes` qua `data/harness/profiles/cordis-app/cordis.patch.yml`, không phải sẵn có
trong image.

**Test thật đã chạy (container n8n riêng + profile dsh cô lập, không đụng harness thật của
máy dev):**
- Tạo workflow thật qua `n8n_upsert_workflow` (tag `agent-generated` gắn đúng, `active:
  false`), `n8n_get_workflow`/`n8n_list_workflows` (lọc theo tag) đọc lại đúng.
- `n8n_activate_workflow` với approval `allowed-once` → `active: true` thật; với approval
  `rejected` → throw đúng, không gọi n8n.
- `n8n_run_workflow` → POST vào webhook thật của workflow, n8n trả "Workflow was started",
  `n8n_get_execution('1')` đọc lại đúng `status: "success"`, `mode: "webhook"`.
- Webhook ngược qua `curl` thật vào `dsh --profile cordis-app` đang chạy: thiếu header →
  401; sai secret → 401; đúng secret + `workflowId` không có route cấu hình → vẫn 202
  (đúng thiết kế fire-and-forget) nhưng KHÔNG tạo session; đúng secret + route cấu hình →
  202 VÀ một session mới xuất hiện thật ở `GET /api/v1/sessions`, đọc lại `GET
  /api/v1/session-events` thấy đúng `source.kind: "webhook"`, prompt chứa payload gắn nhãn
  untrusted, `permission/preset` đúng preset đã cấu hình.

**Còn nguyên giới hạn đã ghi trong README `dsh-webhook` (chưa cần giải quyết cho MVP):**
fire-and-forget process-local, không có queue/replay; không dedupe delivery lặp — n8n retry
có thể tạo nhiều session trùng, tự thêm idempotency theo `deliveryId` nếu cần sau này.

**Test thật LẦN HAI — `docker compose up` với CẢ HAI service `core`+`n8n` cùng lúc, qua
network compose nội bộ (không phải `127.0.0.1` giữa hai container):**

- Build image sạch (`docker compose build`, ~4 phút do registry chậm lúc test, không phải
  vấn đề của project), `docker compose up -d` cả hai service, boot sạch không lỗi.
- Xác nhận `core` gọi `n8n` qua đúng tên service: `docker exec` vào container `core`,
  `fetch('http://n8n:5678/healthz')` trả `{"status":"ok"}` — DNS nội bộ compose hoạt động
  đúng, không cần `127.0.0.1` hay port publish nào giữa hai container.
- Sửa `data/harness/profiles/cordis-app/cordis.patch.yml` **trên host** (đúng quy trình
  operator thật của Phase 5) để insert `webhook-runtime`
  (`@deepseek-ai/dsh-webhook`) + `cordis-n8n` trỏ `baseURL: http://n8n:5678`,
  `docker compose restart core` — patch có hiệu lực, `--dump-config` bên trong container
  xác nhận đúng.
- Set `N8N_API_KEY`/`N8N_WEBHOOK_SECRET` thật qua `POST /api/v1/credentials` (Phase 4) qua
  cổng publish `3080` — hoạt động đúng y hệt test cô lập trước đó.

**Phát hiện thật thứ ba, quan trọng, CHƯA có trong tài liệu trước đó — xác nhận bằng cách
tạm thời thêm `console.error` thẳng vào bản build TRONG container đang chạy (không sửa
source) để lần theo lỗi thật, vì lỗi bị nuốt im lặng qua `ctx.logger.warn` (không hiện ra
`docker logs` ở log level mặc định):**

`WebhookSessionRequest.workspacePath` **phải là một thư mục ĐÃ TỒN TẠI SẴN** —
`@deepseek-ai/dsh-webhook`'s `createWebhookSession()` gọi thẳng `dsh-workspace`'s
`create()`, mà bên trong dùng `fs.realpath()` để chuẩn hoá đường dẫn — `realpath` trên một
đường dẫn CHƯA TỒN TẠI ném `ENOENT` ngay lập tức. README của `dsh-webhook` viết "resolves
or creates the canonical Workspace" dễ gây hiểu lầm là tự tạo thư mục trên đĩa — thực tế
"creates" chỉ nói tới việc tạo BẢN GHI Workspace (metadata) cho một thư mục CÓ SẴN, không
phải `mkdir -p`. Test thật: trigger webhook với `workspacePath: /workspace/n8n-triggered`
chưa tồn tại → thất bại âm thầm (202 vẫn trả về vì đó là tầng HTTP, nhưng
`GET /api/v1/sessions` không có gì mới); `mkdir -p` đúng thư mục đó rồi trigger lại → session
tạo thành công ngay, đọc lại đúng `cwd: /workspace/n8n-triggered`, prompt/preset/tags đều
đúng như test cô lập trước đó.

**Hệ quả vận hành cần ghi rõ cho operator (đã thêm vào `docs/patch-cookbook.md` Ví dụ 3):**
mỗi `workspacePath` khai trong `config.routes` phải được tạo trước (`docker compose exec
core mkdir -p <path>`, hoặc dùng một thư mục con đã tồn tại sẵn của volume `workspace`)
TRƯỚC KHI workflow đó có thể trigger thành công lần đầu — không có cơ chế tự tạo.

**Test thật lại toàn bộ chiều xuôi (cordis → n8n) qua compose network** (không chỉ qua
container n8n độc lập như lượt trước): `n8n_list_workflows` (rỗng, n8n mới), tạo workflow
+ activate + `n8n_run_workflow` qua `http://127.0.0.1:5678` (cổng publish, tương đương từ
phía `core` sẽ là `http://n8n:5678`) — chạy đúng y hệt, kể cả tái hiện lại đúng cảnh báo
"phantom tag" đã sửa ở lượt trước (`session:compose-e2e-session` báo "already exists" dù
`GET /tags` không liệt kê — code xử lý đúng, log warning, vẫn tạo workflow thành công với
tag `agent-generated`).

**FE `/automations` — ĐÃ LÀM XONG, build sạch + test thật:**

Read-only theo đúng thiết kế (agent tạo/sửa/activate/run qua chat, trang này chỉ hiển thị):
`GET /api/v1/automations` (lọc `tags=agent-generated`, route mới trong `n8n.ts` — KHÁC với
`n8n_list_workflows` là tool cho model gọi, đây là REST route riêng cho browser, cùng
convention path tĩnh + `ctx.connection.fetch.register()` như `gateway.ts`) và
`GET /api/v1/automations-executions?workflowId=` — cả hai test thật: seed một workflow qua
tool trực tiếp (không qua model, dùng harness ctx giả như đã làm ở phần backend), boot
`dsh` thật, curl hai route trên qua HTTP thật, nhận đúng dữ liệu (workflow + tag +
execution). Route KHÔNG đăng ký khi `cordis-n8n` chưa được insert (test thật: 404 sạch,
không lỗi 500) — đúng thiết kế opt-in, trang FE vẫn load bình thường (Next.js static, không
phụ thuộc backend có bật n8n hay không), chỉ query rỗng/lỗi nếu chưa bật.

FE dùng chung route `/` qua `?view=automations` (đúng convention đã xác nhận ở Phase 4 —
route con sẽ 404 vì `serveStatic()` không fallback), file mới
`apps/web/components/automations.tsx`: danh sách workflow (tên, active/inactive, tag),
click để xem execution gần nhất. Link điều hướng thêm cạnh "Model & credentials" ở
`SessionPicker`.

**Definition of Done — đạt toàn bộ (backend + FE + compose):** tool CRUD + approval-gated
activate + run-qua-webhook + audit trail đã chạy thật với n8n thật (qua container riêng lẫn
qua `docker compose` với 2 service thật); webhook ngược tạo session thật đã chạy thật qua
dsh boot thật VÀ qua `docker compose` thật, root-caused và sửa xong
`workspacePath`-phải-tồn-tại-sẵn; FE `/automations` build sạch (`tsc`+`next build`) và đọc
đúng dữ liệu thật qua HTTP thật. Phase 6 hoàn tất.

---

## 9. Phase 7 — Audit (P5) — ĐÃ XONG, build sạch + test thật

**Sửa lại so với bản nháp v1 sau khi tra API thật — cả hai chi tiết kỹ thuật trong bản
nháp đều sai:**

1. **`telemetry/*` không tồn tại.** Đã tìm khắp `node_modules` (mọi `.d.ts` của mọi
   package `@deepseek-ai/dsh-*`) — không có event nào tên `telemetry/*` trong vocabulary
   Cordis thật. Cái gần giống nhất, `@deepseek-ai/dsh-session-telemetry-otel`, là một thứ
   HOÀN TOÀN khác: export OTel log **chỉ sau khi có feedback rõ ràng từ người dùng** (rating/
   note/text feedback), phục vụ mục đích product analytics opt-in, không phải audit trail
   vận hành nội bộ ta cần.
2. **`tools/post-execute` sai loại event cho việc này.** Đây là waterfall dành cho bên
   THAM GIA TÍCH CỰC vào pipeline (có thể thay nội dung/kết quả, ví dụ spill policy) —
   dùng nó cho một logger thụ động nghĩa là phải tự gọi `next()` đúng cách và có nguy cơ
   làm hỏng pipeline nếu code sai. Event ĐÚNG là **`tools/result`** (`@mode emit`, thuần
   quan sát, không có `next()`, không thể phá pipeline).

**Việc thật đã làm — `packages/bundle-core/src/audit.ts`, mặc định BẬT trong
`packages/bundle-core/cordis.patch.yml` (không opt-in như n8n — mọi field config đều có
default hợp lệ, không như `n8n.ts`'s `baseURL` bắt buộc):**

1. `ctx.on('tools/result', (exec, result) => {...}, {global: true})` — ghi mỗi tool call:
   `sessionId` (từ `exec.agent?.session.id` — bỏ qua nếu không có agent, ví dụ một PTC
   sub-dispatch context trần trụi), `toolName`, `callId`, `arguments`/`result` đã
   redact+truncate.
2. `ctx.on('session/event', (session, event) => {...}, {global: true})` lọc
   `request/context` (học `provider`/`model` hiện tại của session — event này chỉ log khi
   route ĐỔI theo đúng doc comment thật của `dsh-session`, nên phải giữ last-known-good
   trong một `Map`, không phải đọc field mỗi lần) và `assistant/message` (`usage?:
   TokenUsage` nằm ngay trên event này — không có event usage riêng nào khác, xác nhận từ
   type thật `dsh-session/types.ts`).
3. Redact: quét đệ quy (giới hạn 6 tầng), field nào tên khớp
   `/token|secret|password|api[-_]?key|credential/i` bị thay bằng `"[redacted]"` — heuristic
   theo tên field, KHÔNG phải bảo đảm tuyệt đối (giới hạn đã ghi rõ trong code, không giấu).
   Truncate mỗi field còn lại về tối đa `maxFieldBytes` (mặc định 2000).
4. Cost: `config.prices` map `"provider/model"` → `{inputPerMillion, outputPerMillion}` —
   KHÔNG có bảng giá built-in nào trong dsh (đã kiểm `dsh-token-meter`: chỉ đo TOKEN, không
   biết giá tiền). Không có entry khớp → chỉ log token, không có field `costUsd` — tránh
   bịa giá.
5. Ghi `$DSH_HOME/audit/audit-<YYYY-MM-DD>.jsonl` (một file/ngày) qua
   `@deepseek-ai/dsh-home-paths`'s `dshHomePath('audit')` — thư viện thuần, không phải
   service `ctx.<key>` (đúng theo README của chính nó: "not through cordis.yml").

**Phát hiện thật lúc test, đã tự sửa:** insert `cordis-audit` KHÔNG kèm `config:` nào
(khác n8n luôn có `config:` tường minh) → boot fail thật `Cannot read properties of
undefined (reading 'auditRoot')` vì lúc đầu chỉ khai `interface Config` (kiểu TypeScript
thuần, KHÔNG có tác dụng runtime) mà quên `export const Config: z<Config> = z.object({...})`
— thiếu schema thật thì Cordis loader gọi `apply(ctx, undefined)` thẳng, không tự áp default
nào. Sửa bằng cách export đúng schema schemastery (giống `n8n.ts` đã làm đúng từ đầu), mọi
field có `.default(...)` hợp lệ. Bug này đáng ghi nhớ cho mọi plugin sau này có config toàn
optional.

**Test thật đã chạy:**
- Boot thật với `cordis-audit` trong composition mặc định (không cấu hình gì thêm) — sạch,
  không lỗi, xác nhận `Config(undefined)` tự resolve đúng `{maxFieldBytes: 2000, prices:
  {}}`.
- Test trực tiếp logic (mock `ctx.on` bắt listener, gọi tay với payload giả lập đúng hình
  dạng event thật): field tên `apiKey` bị redact đúng thành `"[redacted]"`; kết quả tool
  5000 byte bị truncate đúng kèm `…(truncated)`; tool call thiếu `agent` bị bỏ qua đúng
  (không ghi dòng nào); usage có route đã biết tính đúng `costUsd` (`1000 input + 500
  output` ở giá `$3`/`$15` mỗi triệu token → `0.0105`, tính tay khớp); usage KHÔNG có route
  đã biết chỉ ghi token thô, không có `costUsd`.
- Ghi file JSONL thật, đọc lại bằng `jq` thật (`jq -s 'group_by(.sessionId) | map(...)'`) —
  đúng như kỳ vọng của architecture doc ("JSONL đọc bằng `jq` là đủ").

**Definition of Done — đạt:** truy được tool call + cost mỗi session qua file JSONL đọc
bằng `jq`, không cần OTLP/backend ngoài. Redaction/truncation/graceful-degradation-khi-
thiếu-giá đều xác nhận bằng test thật, không phải đọc code rồi tin.

---

## 10. Kiểm thử & vận hành xuyên phase

Không đổi so với v1 phần nội dung kiểm thử, nhưng **quy trình nâng cấp dsh đổi hẳn từ v5**
(không còn git-fork nên không còn `git fetch upstream && git merge`) — giờ là version bump
npm thuần:
```bash
# 1. Xem CLI mới nhất khai báo version nào cho từng dsh-* package con (đừng tin dist-tag
#    "latest" của từng package con riêng lẻ — có thể cũ, xem bài học ở đầu tài liệu §"v5").
npm view @deepseek-ai/dsh dependencies --json

# 2. Cập nhật version đó cho MỌI @deepseek-ai/dsh* trong package.json gốc core/package.json
#    (devDependencies dsh + dsh-agent, cordis, và toàn bộ dsh-* runtime deps).

# 3. Cài lại, build lại, dump config để diff xem patch có row nào bị đổi/mất không.
pnpm install
pnpm --dir packages/bundle-core run build
node_modules/.bin/dsh --profile cordis-app --dump-config > /tmp/new.yml
diff /tmp/old.yml /tmp/new.yml
```
Nếu registry 404 một package con giữa chừng (đã dính thật lúc dựng v5) — kiểm tra lại đúng
version tồn tại bằng `npm view "<pkg>" versions --json`, không suy đoán tăng patch version.

---

## 11. Việc tiếp theo

**Trạng thái thật tại thời điểm viết (sau v5):** Phase 0-3 đã xong và đã build lại/xác nhận
lại **toàn bộ** trên nền npm dependency mới (`core/`) — không phải chỉ đọc doc: bundle patch
(`--dump-config` sạch), UI static route che fallback dsh, gateway REST+SSE, approval
answerer, persistence qua restart, và Docker thật (`docker compose up`, đo được 513MB, socat
proxy hoạt động qua cổng publish). `core/` đã `git init` riêng, tách khỏi git-fork cũ
(`../local-base.gitfork-archive/`, giữ lại chỉ để tham khảo/rollback, không phải phần đang
chạy).

**Phase 4 — Model + credential (P3) đã xong thật, xem §6.** Route `GET`/`POST /api/v1/model`,
`/model-providers`, `/model-catalog`, `/credentials` đã thêm vào `gateway.ts`, build sạch
(`tsc` lẫn `next build`+`typecheck`), và xác nhận bằng boot thật + curl thật trên profile
test cô lập: đổi default model không cần restart, sống sót qua restart thật (đọc lại
`settings.yaml`), set/unset credential không rò giá trị, `/model-providers` trả đúng danh
sách sống + ~35 route pi-ai chưa cấu hình (test thật, không phải danh sách tay). FE
`/settings/models` dùng chung route `/` qua `?view=settings` (không phải path con — lặp lại
đúng constraint `serveStatic()` không fallback đã né ở §4.2), file mới
`apps/web/components/settings-models.tsx`.

**Phase 5 — Patch layer đã xong thật, xem §7 và `docs/patch-cookbook.md`.** Test thật trên
profile cô lập: tắt một row + restart có hiệu lực (xác nhận qua `--dump-config`), session
tạo trước patch không mất sau restart, file patch rỗng làm boot fail đúng như tài liệu ghi,
và patch tầng composition (`agent-default-model`) độc lập với settings tầng runtime
(Phase 4).

**Phase 6 — n8n (P4) đã xong thật, xem §8.** `packages/bundle-core/src/n8n.ts`: 7 tool
agent-facing (`n8n_list_workflows`/`n8n_get_workflow`/`n8n_validate_workflow`/
`n8n_upsert_workflow`/`n8n_activate_workflow` (approval-gated)/`n8n_run_workflow`/
`n8n_get_execution`), webhook ngược (n8n → tạo session, shared-secret qua
`x-n8n-webhook-secret`), 2 route REST cho FE (`/automations`, `/automations-executions`),
FE `apps/web/components/automations.tsx` qua `?view=automations`. Phát hiện thật quan
trọng nhất: n8n's public API không có endpoint "run workflow" nào (phải POST thẳng vào
Webhook node của chính workflow), `@deepseek-ai/dsh-webhook` phải tự insert (không có sẵn
trong composition mặc định), và `workspacePath` phải là thư mục có sẵn (không tự
`mkdir`). Test thật hai lần: container n8n độc lập, VÀ `docker compose up` với cả `core`+
`n8n` qua network compose thật (`http://n8n:5678`). `deploy/docker-compose.yml` đã có
service `n8n`. n8n integration là opt-in qua profile patch (`docs/patch-cookbook.md` Ví dụ
4), không nằm trong bundle patch mặc định vì `Config.baseURL` bắt buộc.

**Phase 7 — Audit (P5) đã xong thật, xem §9.** `packages/bundle-core/src/audit.ts`, mặc
định BẬT (khác n8n) trong `packages/bundle-core/cordis.patch.yml`. Hai chi tiết trong bản
nháp v1 đều sai và đã sửa sau khi tra API thật: `telemetry/*` không tồn tại trong vocabulary
Cordis thật (khác hẳn `@deepseek-ai/dsh-session-telemetry-otel`, một cơ chế feedback-gated
riêng); `tools/post-execute` là waterfall cho bên tham gia tích cực, event đúng cho một
logger thụ động là `tools/result` (`@mode emit`). Ghi `$DSH_HOME/audit/audit-<ngày>.jsonl`
qua `dsh-home-paths`, redact field tên khớp secret-pattern, truncate field quá dài, tính
`costUsd` khi có bảng giá cấu hình khớp provider/model (không có bảng giá built-in nào
trong dsh — đã kiểm `dsh-token-meter` chỉ đo token, không biết giá tiền). Bug thật tự dính
và tự sửa: quên export schema `schemastery` cho `Config` (chỉ khai `interface` TypeScript
thuần — không có tác dụng runtime) làm boot fail `Cannot read properties of undefined` khi
row insert không kèm `config:` nào. Test thật: boot với composition mặc định (không cấu
hình gì) chạy sạch; test logic trực tiếp (redact/truncate/cost/graceful-degradation) khớp
tính tay; ghi JSONL thật rồi đọc lại bằng `jq` thật, đúng ý architecture doc.

**Toàn bộ 8 phase (0-7) của kế hoạch đã hoàn tất và xác nhận bằng test thật — không phase
nào chỉ dừng ở viết code chưa chạy.** Việc còn lại là polish/vận hành, không phải phase mới:

- Rà lại toàn bộ tài liệu (`docs/cordis-agent-architecture.md`) xem có cần cập nhật để khớp
  với thực tế `core/` (v5, npm dependency) hay không — tài liệu đó chưa được sửa trong suốt
  quá trình build lại v5, có thể còn mô tả kiến trúc theo hướng git-fork cũ ở một số chỗ.
- `docs/patch-cookbook.md` đã có 4 ví dụ thật; có thể cần thêm ví dụ về audit (đổi
  `maxFieldBytes`/`prices` qua patch) nếu người vận hành cần.
- Cân nhắc commit toàn bộ `core/` lên git thật (hiện tại working tree có nhiều thay đổi
  chưa commit qua các phase 4-7 — người dùng đã chọn "chưa commit" ở checkpoint Phase 4,
  chưa hỏi lại từ đó).
- Không có ví dụ `docker-compose.yml` end-to-end nào bao gồm CẢ audit LẪN n8n LẪN model
  settings chạy cùng lúc trong một lần test duy nhất — mỗi phase được test cô lập với đúng
  phần của nó. Nếu cần một "smoke test toàn bộ" thật sự trước khi coi dự án là production-
  ready, đó sẽ là việc tiếp theo hợp lý nhất.
