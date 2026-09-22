# Plan — thêm OpenRouter làm route model thứ hai

> **Trạng thái: ĐÃ TRIỂN KHAI VÀ VERIFY THẬT (2026-09-22).** Patch nằm ở
> `packages/bundle-core/cordis.patch.yml` (tầng bundle, không phải Home tier
> như phác thảo ban đầu bên dưới — quyết định cuối: đây là tính năng sản
> phẩm, ship mặc định, không phải tuỳ chỉnh operator). Xác nhận thật qua
> `dsh --profile cordis-app --dump-config` + boot thật + `curl
> /api/v1/model-catalog`: **route `openrouter` có ngay 366 model thật, `
> failures: []`, KHÔNG cần khai tay `api`/`baseURL`/`models`** — pi-ai's
> installed catalog trả model list mà không cần network call hay API key
> (đúng như README của nó nói: "A route the installed catalog ships is
> answered from that catalog with no network call"). Mọi mục "Cần xác minh
> thật" bên dưới coi như đã trả lời — giữ nguyên phần phân tích gốc để biết
> lý do quyết định, nhưng đừng làm lại các bước verify đó nữa.
>
> Phần "switch thủ công trên chat" (route `/session-select-model`, UI picker)
> nằm ở `docs/add-openrouter-model-switch-plan.md` — cũng đã triển khai và
> verify thật cùng đợt này.

## Mục tiêu

Core hiện có đúng một route LLM đang mount: `@cordis-app/llm-openai-compat`
(provider id `openai-compat`, xem `packages/llm/openai-compat/cordis.patch.yml`).
Muốn thêm OpenRouter như một **provider chọn được song song**, không thay thế
route hiện tại — cả hai cùng tồn tại, model mặc định của deployment quyết định
dùng cái nào.

## Phát hiện quan trọng nhất: đã có sẵn cơ chế multi-provider, không cần viết package mới

Trong lúc research đã xác nhận thật (đọc trực tiếp file, không suy đoán) 3 điều:

1. **`@deepseek-ai/dsh-llm-pi-ai` đã được mount trong composition hiện tại**,
   ở tầng `dsh-base` (`node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`
   dòng 107-108, `id: llm-pi-ai`) — **dormant**: 0 route cho tới khi có
   `providers` config. Không package nào trong repo này (`bundle-core`,
   `dsh-web-app`) disable nó — đã grep cả hai, không có kết quả.
2. **Package này SINH RA để làm đúng việc "route nhiều provider OpenAI-compatible
   từ một config"** — README của nó (`node_modules/@deepseek-ai/dsh-llm-pi-ai/README.md`,
   mục "Use this package"): *"Choose this adapter when the same composition
   serves several providers... Both adapters can be mounted together because
   their route names do not collide"*. Đây chính xác là yêu cầu của bạn.
3. **OpenRouter là provider n8n... à nhầm, là provider pi-ai đã "biết" sẵn**,
   không phải gateway lạ phải khai báo tay hoàn toàn: file compiled
   `node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` có entry
   `"openrouter": true` trong bảng provider đã cài đặt, và README tự lấy
   "renaming an OpenRouter route" làm ví dụ minh hoạ (dòng 119) — tức OpenRouter
   là một trong các "installed pi-ai providers" có sẵn catalog (endpoint,
   protocol, danh sách model, context window mỗi model), không phải route
   "hand-declared" phải tự khai `api`/`baseURL`/`models` như route
   `acme-gateway` trong ví dụ của README.

Kết luận: **không cần viết code mới, không cần package mới** — chỉ cần một
dòng patch thêm `providers.openrouter` vào row `llm-pi-ai` đã có sẵn.

## Vì sao KHÔNG nhân bản `@cordis-app/llm-openai-compat` (phương án B, không khuyến nghị)

OpenRouter về mặt kỹ thuật cũng là OpenAI-compatible (`/chat/completions`),
nên mount thêm một instance thứ hai của package tự viết này (đổi `provider`,
`baseURL`, `apiKeyEnv` trong config) *trông* khả thi. Nhưng đọc kỹ
`packages/llm/openai-compat/src/adapter.ts` phát hiện một bug thật sẽ lộ ra
ngay khi làm vậy:

```ts
const BASE_URL_REF = 'OPENAI_BASE_URL'   // hardcoded module-level, KHÔNG đọc từ config

private async resolveBaseURL(): Promise<string> {
  const ref = credentialRef(BASE_URL_REF)
  const resolved = await this.ctx.credentials.resolve(ref)
  return resolved !== undefined && resolved.value !== '' ? resolved.value : this.config.baseURL
}
```

`resolveBaseURL()` luôn ưu tiên credential ref tên cứng `OPENAI_BASE_URL`,
bất kể instance nào gọi nó. Nếu mount thêm một instance thứ hai cho OpenRouter
(`config.baseURL: https://openrouter.ai/api/v1`), nhưng người dùng từng set
credential `OPENAI_BASE_URL` qua Settings (ví dụ trỏ vào một gateway nội bộ cho
route đầu tiên) — giá trị đó sẽ **âm thầm ghi đè luôn cả baseURL của
OpenRouter instance**, gửi request sang sai chỗ. Đây là bug thật, không phải
lý thuyết, vì `apiKeyEnv` đã được tham số hoá đúng cách (`this.config.apiKeyEnv`)
nhưng `baseURL` thì bị bỏ sót — có thể là một lỗ hổng chưa từng lộ ra vì tới
giờ package chỉ được mount đúng một lần.

Muốn đi hướng B an toàn phải sửa code trước (thêm `baseURLEnv` vào `Config`,
threading qua `adapter.ts`, bỏ constant cứng) — tốn công hơn, không có test
tự động cho package này để bắt regression, và không có gì package tự viết làm
tốt hơn `dsh-llm-pi-ai` (catalog model/context-window/retry-policy của pi-ai
đều xịn hơn bản tự viết: 1 context window tĩnh cho *cả* route, so với
per-model context window thật của pi-ai). **Chỉ quay lại phương án B nếu**
thực nghiệm ở phương án A cho thấy catalog OpenRouter trong pi-ai thiếu hụt
gì đó không khai báo tay được.

## Phương án A — các bước triển khai

### Bước 0 — môi trường dev cần Node 22+ (đã phát hiện lệch)

`node -v` trong máy hiện tại là `v21.7.1`, trong khi `.nvmrc` pin `22.23.2` và
`package.json.engines` đòi `^22.19.0 || >=24.0.0`. Thử chạy
`dsh --profile cordis-app --dump-config` để xác minh thật row `llm-pi-ai`
bị thất bại **âm thầm** (exit 0, output rỗng, không cả lỗi) — đúng loại lỗi
`scripts/dev.sh` đã có sẵn guard cho (`NODE_MAJOR -lt 22`) nhưng chạy `dsh`
trực tiếp qua `node_modules/.bin/dsh` thì bỏ qua guard đó. Trước khi verify
thật bất cứ bước nào dưới đây: `nvm use` (đọc `.nvmrc`) hoặc
`nvm install 22 && nvm use 22`.

### Bước 1 — xác nhận trạng thái hiện tại (chỉ đọc, không sửa)

```sh
nvm use   # hoặc nvm install 22 && nvm use 22
DSH_HOME="$(pwd)/.dev-state/harness" node_modules/.bin/dsh --profile cordis-app --dump-config > /tmp/before.yml
grep -n -A15 "id: llm-pi-ai" /tmp/before.yml
```

Kỳ vọng: row tồn tại, `providers: {}` hoặc field rỗng — xác nhận đúng "dormant,
0 route". Nếu `pnpm run dev` đã từng chạy trước đó, có thể check trực tiếp qua
API đang sống thay vì CLI:

```sh
curl -s http://127.0.0.1:3080/api/v1/model-providers | jq
```

README của `dsh-llm-pi-ai` nói adapter "declares every installed catalog
provider it can authenticate in the configurable-provider directory... so
configuration surfaces can offer the full catalog before any route exists" —
nghĩa là **`openrouter` có thể ĐÃ xuất hiện trong `configurable` của response
này ngay cả trước khi patch**, chỉ chưa có route thật. Xác nhận điều này
trước khi patch để biết chắc pi-ai thật sự nhận diện `openrouter` như một
catalog có sẵn, không phải suy đoán từ README.

### Bước 2 — patch thêm route (Home tier — không rebuild)

Sửa `data/harness/profiles/cordis-app/cordis.patch.yml` (prod/Docker) hoặc
`.dev-state/harness/profiles/cordis-app/cordis.patch.yml` (dev cục bộ) — đúng
quy trình 3 bước của `docs/patch-cookbook.md`:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        # Chỉ thêm baseURL/api/models nếu Bước 1 cho thấy pi-ai KHÔNG tự có
        # catalog cho "openrouter" (tức phải hand-declare như ví dụ
        # "acme-gateway" trong README):
        # api: openai-completions
        # baseURL: https://openrouter.ai/api/v1
        # models:
        #   - id: <model id thật trên openrouter.ai/models>
        #     contextWindow: <số thật>
```

`OPENROUTER_API_KEY` **đã có sẵn** trong danh sách credential ref của gateway
(`packages/bundle-core/src/gateway.ts:68`, `KNOWN_CREDENTIAL_REFS`) — không cần
sửa code, `GET /api/v1/credentials` và Settings UI đã hiển thị đúng ref này rồi
(comment tại chỗ khai báo nói rõ nó được thêm sẵn "phòng trước" cho đúng nhu cầu
này, chưa từng được wire tới adapter nào).

### Bước 3 — set API key thật

```sh
curl -s -X POST http://127.0.0.1:3080/api/v1/credentials \
  -H 'content-type: application/json' \
  -d '{"ref":"OPENROUTER_API_KEY","value":"sk-or-v1-..."}'
```

**Không bao giờ đặt giá trị thật trong `cordis.patch.yml`** — đúng nguyên tắc
đã áp dụng nhất quán toàn repo (credential luôn qua route `/credentials`).

### Bước 4 — restart + verify thật

```sh
docker compose -f deploy/docker-compose.yml restart core   # hoặc restart pnpm run dev nếu chạy local
curl -s http://127.0.0.1:3080/api/v1/model-providers | jq '.providers[] | select(.provider=="openrouter")'
curl -s "http://127.0.0.1:3080/api/v1/model-catalog?provider=openrouter" | jq
```

Kỳ vọng: `model-providers` liệt kê `openrouter` là route sống; `model-catalog`
trả danh sách model thật kèm context window — nếu danh sách rỗng hoặc lỗi,
quay lại Bước 2 và hand-declare `api`/`baseURL`/`models`.

### Bước 5 — chọn model mặc định

Hai cách, không loại trừ nhau:

- **Runtime, không restart** (test nhanh một model cụ thể):
  ```sh
  curl -s -X POST http://127.0.0.1:3080/api/v1/model \
    -H 'content-type: application/json' \
    -d '{"provider":"openrouter","model":"<model id từ Bước 4>"}'
  ```
  Lưu ý (đã đọc `apps/web/lib/api.ts` — comment tại đó): tab Settings hiện KHÔNG
  còn UI chọn model nữa (bị gỡ ở một đợt trước, giờ là "operator-set, deploy-time
  value") — route backend `/model` vẫn sống, chỉ gọi qua curl/API trực tiếp,
  không có nút bấm trong app.
- **Deploy-time cố định** (patch tầng Home, sống qua restart/upgrade):
  ```yaml
  - id: agent-default-model
    name: '@deepseek-ai/dsh-agent-default-model'
    config:
      provider: openrouter
      model: <model id thật>
  ```
  Row này hiện đang bị `packages/llm/openai-compat/cordis.patch.yml` ghi
  `provider: openai-compat` — patch tầng Home (ngoài cùng) sẽ thắng, không cần
  sửa package đó.

### Bước 6 — test end-to-end thật

Tạo session mới, gửi 1 tin nhắn, xác nhận:
- Trả lời stream về bình thường.
- `GET /api/v1/session-events` có `request/context` event với
  `provider: "openrouter"` đúng model đã chọn.
- `data/harness/audit/audit-<ngày>.jsonl` (hoặc `.dev-state/...`) có dòng
  `usage` — cost sẽ KHÔNG có field `costUsd` trừ khi thêm giá vào
  `cordis-audit`'s `prices` config (key dạng `"openrouter/<model>"`) — optional,
  không chặn tính năng chạy được.

## Cần xác minh thật (chưa làm được trong phiên research này)

- [ ] Bước 1 — `openrouter` có nằm sẵn trong `configurable` list của
  `/api/v1/model-providers` trước khi patch không? (cần Node 22+, chưa chạy được)
- [ ] Bước 4 — catalog model của `openrouter` trong pi-ai có tự đầy đủ
  (baseURL/models/context window) hay cần hand-declare? Quyết định trực tiếp
  việc Bước 2 có cần thêm `api`/`baseURL`/`models` hay không.
- [ ] Header đề xuất của OpenRouter (`HTTP-Referer`, `X-Title` — dùng cho bảng
  xếp hạng/attribution phía OpenRouter, không bắt buộc để chạy) — pi-ai's
  README nhắc tới field `headers` cấp route nhưng ví dụ cụ thể chưa thấy show
  form đầy đủ; cần đọc `docs/config-catalog.md` phía dsh (không có trong
  node_modules đã cài, chỉ có trong source checkout của dsh) nếu muốn thêm.

## Quyết định cần bạn chọn trước khi triển khai

1. **OpenRouter trở thành model mặc định mới, hay chỉ là route phụ để chọn khi
   cần?** Ảnh hưởng có sửa `agent-default-model` (Bước 5) hay không.
2. **Model cụ thể nào trên OpenRouter?** (OpenRouter phục vụ 200+ model — nếu
   catalog pi-ai không tự đủ, cần bạn chỉ định danh sách muốn hand-declare).
3. **Áp dụng ở đâu**: chỉ `.dev-state/harness` (dev cá nhân), hay cả
   `data/harness/profiles/cordis-app/cordis.patch.yml` (Docker đang chạy), hay
   cả `deploy/profile-template/cordis-app/cordis.patch.yml` (mẫu cho deployment
   mới từ đầu)? Ba nơi độc lập, không tự đồng bộ.

## Definition of Done (khi chuyển thành "Ví dụ 5" trong patch-cookbook.md)

- [ ] Patch áp dụng thật qua `docker compose restart core`, xác nhận qua
  `--dump-config` có dòng `patched by`.
- [ ] `GET /api/v1/model-providers` liệt kê `openrouter` với ít nhất 1 model.
- [ ] Một turn chat thật hoàn thành qua route `openrouter`, `request/context`
  event xác nhận đúng provider.
- [ ] `.env.example` cập nhật thêm `OPENROUTER_API_KEY=` kèm comment hướng dẫn
  (đồng bộ với cách `N8N_API_KEY` đã được tài liệu hoá ở đó).
