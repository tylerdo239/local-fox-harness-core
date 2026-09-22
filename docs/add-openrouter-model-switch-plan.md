# Plan — thêm OpenRouter + cho người dùng tự config và tự switch model trên chat

> **Trạng thái: ĐÃ TRIỂN KHAI VÀ VERIFY THẬT (2026-09-22).** Đúng theo thiết
> kế bên dưới, không lệch đáng kể. Verify thật đã làm (boot dev instance riêng
> trên port 3090 — không đụng container Docker thật đang chạy trên 3080 — qua
> `curl`, có cookie thật từ token exchange):
> - `GET /api/v1/model-catalog` trả đúng shape, `routableProviders` có cả
>   `openai-compat`/`deepseek-official`/`openrouter`, `failures: []`.
> - `POST /api/v1/session-select-model` với provider/model thật
>   (`openrouter`/`anthropic/claude-haiku-4.5`) trả `{"selected":{...}}` đúng.
> - Test lỗi: model không tồn tại → 400 kèm message rõ ràng từ chính pi-ai
>   ("has no configured model ..."), session không tồn tại → 404 — không có
>   trường hợp nào 500/crash.
> - `GET /api/v1/credentials` đã liệt kê `OPENROUTER_API_KEY` với
>   `configured: false` — đúng route có sẵn, không cần sửa gì thêm.
> - `pnpm run build` + `pnpm run typecheck` sạch cho cả backend lẫn
>   `apps/web`; grep trực tiếp trong static export xác nhận `modelPicker`/
>   `OPENROUTER` có mặt trong bundle build ra.
> - **Chưa verify bằng mắt trên trình duyệt thật** (Claude in Chrome bị từ
>   chối cài trong phiên này) — dropdown mở/đóng, click chọn model, badge
>   optimistic update... mới chỉ đúng về mặt code review + build, chưa thấy
>   chạy thật trên UI. Bạn nên tự mở `pnpm run dev` (hoặc dùng lại container
>   Docker sau khi rebuild) và thử tay 1 lượt trước khi coi tính năng này
>   xong hẳn.

## Quyết định sản phẩm cần xác nhận trước

Đọc lại `settings-dialog.tsx` (comment Đợt 6) xác nhận: việc bỏ model picker
khỏi UI trước đây là **chủ đích**, lý do ghi rõ trong code — *"an end user has
no business choosing the route"*. Yêu cầu hiện tại đảo ngược đúng quyết định
đó. Không chặn plan này (bạn đã xác nhận ở lượt trước), chỉ ghi lại để không
ai đọc code sau này hiểu nhầm đây là quên sót.

## Phần 1 — Backend: 2 route mới, dùng service đã có sẵn

Đã xác nhận thật (đọc trực tiếp `.d.ts`, không đoán): `ctx.sessionController`
(`@deepseek-ai/dsh-api-session-controller`, đã mount sẵn qua `dsh-web-app`,
không bị tắt ở đâu trong repo) có 2 method public dùng thẳng được:

```ts
sessionController.selectModel(request: {
  sessionId: SessionId
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
}): Promise<{ selected: ModelSelection }>

sessionController.modelCatalog(): Promise<{
  default: ModelSelection                         // default hiện tại của deployment
  routableProviders: readonly string[]             // provider nào đang sống
  groups: readonly {                                // catalog theo provider, group sẵn
    id: string; name: string
    models: readonly { id: string; name: string; description?: string; reasoning?: unknown }[]
  }[]
  failures: readonly { id: string; name: string; message: string }[]  // provider lỗi + lý do
}>
```

`modelCatalog()` đã group sẵn theo provider, có cả `failures` (ví dụ
OpenRouter chưa set API key sẽ xuất hiện ở đây kèm message lỗi thật) — dựng
picker trên FE không cần tự ráp gì thêm.

### Sửa `packages/bundle-core/src/gateway.ts`

1. Thêm `'sessionController'` vào mảng `inject` (dòng 51).
2. **Thay** 2 route cũ `/model-providers` + `/model-catalog?provider=`
   (dùng `ctx.llm.listProviders()`/`listConfigurableProviders()`/`listModels()`,
   không session-aware, không group, không báo failure theo provider) **bằng
   một route duy nhất**:
   ```ts
   registerRoute(ctx, '/model-catalog', {
     GET: async () => json(await ctx.sessionController.modelCatalog()),
   })
   ```
   An toàn để thay hẳn (không phải thêm route song song): đã kiểm tra
   `apps/web/lib/api.ts` — `listModelProviders`/`listModelCatalog` phía FE đã
   bị gỡ từ Đợt 6, không còn chỗ nào gọi 2 route cũ. Giữ lại chỉ tổ tăng diện
   tích code chết.
3. Thêm route mới, theo đúng convention verb-suffixed POST đã dùng cho
   `/session-rename`/`/session-fork`:
   ```ts
   registerRoute(ctx, '/session-select-model', {
     POST: async (request) => {
       const body = await readJson(request)
       const sessionId = requireString(body, 'sessionId')
       const provider = requireString(body, 'provider')
       const model = requireString(body, 'model')
       if (sessionId === undefined || provider === undefined || model === undefined) {
         return badRequest('sessionId, provider and model are required')
       }
       const agent = await resolveAgent(ctx, SessionId(sessionId))   // helper đã có sẵn, xử lý cold-resume
       if (agent === undefined) return notFoundResponse(`session ${sessionId} not found`)
       try {
         const result = await ctx.sessionController.selectModel({
           sessionId: SessionId(sessionId), provider, model,
           ...requireString(body, 'reasoningEffort') !== undefined
             ? { reasoningEffort: ReasoningEffortId(requireString(body, 'reasoningEffort')!) }
             : {},
         })
         return json(result)
       } catch (error) {
         return badRequest(error instanceof Error ? error.message : String(error))
       }
     },
   })
   ```

Không đụng gì tới `ctx.agentDefaultModel`/`agent-default-model` — đó vẫn là
default cho session MỚI, độc lập hoàn toàn với route mới này (chỉ đổi model
của MỘT session đang sống).

## Phần 2 — Frontend: 2 luồng UI riêng biệt

### 2.1 Luồng CONFIG — Settings → Config tab (đã có sẵn khung, chỉ thêm field)

Đã đọc kỹ `settings-dialog.tsx` — có sẵn component `CredentialField` dùng
chung cho Serper/n8n, chỉ cần clone thêm 1 block, không cần logic mới:

```tsx
<CredentialField
  refName="OPENROUTER_API_KEY"          // đã có sẵn trong KNOWN_CREDENTIAL_REFS, không cần sửa backend
  title={t('settings.openrouterKeyTitle')}
  hint={(<>{t('settings.openrouterKeyHint')}{' '}
    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-accent-text underline">
      openrouter.ai/keys
    </a>
  </>)}
  placeholder={t('settings.openrouterKeyPlaceholder')}
/>
```

Đặt trong `ConfigTab()`, ngay sau block `OPENAI_BASE_URL` (nhóm các credential
"model" lại với nhau, trước Serper/n8n) — đúng thứ tự đọc đã có.

Thêm 3 key i18n (cả `vi`/`en` trong `translations.ts`, theo mẫu các key
`settings.n8nApiKey*` đã có):
`settings.openrouterKeyTitle`, `settings.openrouterKeyHint`,
`settings.openrouterKeyPlaceholder`.

**Không cần** thêm gì khác vào Settings — không có picker chọn model mặc định
ở đây, đúng ranh giới đã có: Settings chỉ giữ **secret**, việc **chọn dùng
model nào cho cuộc chat hiện tại** chuyển hẳn sang khung chat (mục 2.2). Giữ
ranh giới này rõ ràng để không lặp lại 2 chỗ chỉnh cùng một thứ.

### 2.2 Luồng SWITCH — trong khung chat, tại `composer.tsx`

**Vị trí**: đã đọc kỹ `composer.tsx` — có sẵn 1 hàng action
(`<div className="ml-auto flex items-center gap-2">`) ngay trước nút
Send/Stop. Thêm component mới `ModelPicker` vào **đầu** hàng action đó (bên
trái nút Send), không phải hàng riêng — giữ đúng tinh thần "không thêm chrome
kỹ thuật" đã ghi trong `conversation.tsx`'s header comment.

**Component mới**: `apps/web/components/features/conversation/model-picker.tsx`

**Cách xác định model hiện tại của session** — không cần route mới, không cần
sửa `store.ts`: đọc thẳng từ `useChatStore(state => state.events)` (đã có sẵn
trong mọi component khung chat), tìm event `request/context` **gần nhất**
(chính event `audit.ts` phía backend đã dùng để biết provider/model mỗi
step — cùng một nguồn sự thật, không thể lệch nhau). Session chưa chạy step
nào (session mới toanh) → fallback về `modelCatalog.default`.

**Luồng tương tác cụ thể**:

```
1. Component mount
   → useQuery(['model-catalog'], getModelCatalog)   // GET /api/v1/model-catalog
   → derive "current" từ events (request/context gần nhất) hoặc modelCatalog.default

2. Render: 1 nút nhỏ dạng pill, text = "<tên provider> · <tên model>"
   (ví dụ "OpenAI-compat · gpt-4o-mini"), click mở dropdown

3. Dropdown (style giống SkillMenu đã có trong composer.tsx — absolute,
   role="listbox", cùng ngôn ngữ thị giác):
   - Group theo modelCatalog.groups[].name (tên provider)
   - Mỗi model 1 dòng: tên + description (nếu có)
   - Model đang chọn: highlight (bg-bg-hover, giống active state MenuItem)
   - Provider nằm trong modelCatalog.failures: hiện dòng disabled màu muted,
     kèm message lỗi thật làm tooltip (ví dụ "OPENROUTER_API_KEY chưa cấu
     hình — vào Settings > Config") — KHÔNG ẩn hẳn, để người dùng biết vì
     sao không chọn được thay vì thấy danh sách thiếu provider một cách
     khó hiểu

4. Click 1 model:
   → useMutation(() => selectSessionModel(sessionId, {provider, model}))
     (POST /api/v1/session-select-model)
   → optimistic: lưu kết quả trả về ({selected}) vào local state của
     component để badge đổi NGAY LẬP TỨC, không đợi round-trip
     request/context tiếp theo (turn chưa chạy thì event đó chưa xuất
     hiện — nếu chỉ dựa vào events, badge sẽ đứng im gây hiểu lầm "chưa
     đổi được")
   → event request/context thật (khi turn kế tiếp chạy) sẽ ghi đè lại giá
     trị optimistic bằng giá trị thật từ log — đúng nguồn sự thật lâu dài,
     optimistic chỉ là cầu nối UX trong lúc chờ

5. Lỗi (ví dụ chọn phải model một provider vừa mất credential giữa chừng):
   hiện text-error ngay dưới picker, giữ nguyên lựa chọn cũ (không tự rollback
   badge về provider trước đó, tránh nhấp nháy)
```

**Disable khi nào**: khi turn đang chạy (`running`, biến đã có sẵn trong
`composer.tsx` từ `runningState(events)`) — không chặn về mặt framework
(docs xác nhận "a concurrent switch takes effect on a later step", đổi giữa
turn không lỗi), nhưng disable để tránh người dùng hiểu nhầm "vừa đổi mà câu
trả lời đang chạy vẫn dùng model cũ" ngay trước mắt họ.

**Phạm vi hiệu lực**: chỉ đổi model của **session đang mở**, không phải default
cho session mới — session mới vẫn dùng `ctx.agentDefaultModel` như cũ. Nói rõ
điều này trong hint/tooltip của picker (ví dụ: "Chỉ áp dụng cho cuộc trò
chuyện này") để không ai tưởng nhầm đây là đổi default toàn hệ thống.

### Sửa `apps/web/lib/api.ts` (thêm, không sửa gì cũ)

```ts
export interface ModelCatalogModel { readonly id: string; readonly name: string; readonly description?: string }
export interface ModelProviderGroup { readonly id: string; readonly name: string; readonly models: readonly ModelCatalogModel[] }
export interface ModelCatalogFailure { readonly id: string; readonly name: string; readonly message: string }
export interface ModelCatalog {
  readonly default: { provider: string; model: string }
  readonly routableProviders: readonly string[]
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly ModelCatalogFailure[]
}

export function getModelCatalog(): Promise<ModelCatalog> {
  return request('/model-catalog')
}

export function selectSessionModel(sessionId: string, selection: { provider: string; model: string }): Promise<{ selected: { provider: string; model: string } }> {
  return request('/session-select-model', { method: 'POST', body: JSON.stringify({ sessionId, ...selection }) })
}
```

## Rủi ro cần lưu ý (không phải lỗi kỹ thuật, chỉ là thứ nên biết trước)

- **Trộn model giữa 1 conversation vẫn còn rủi ro đã nêu ở phân tích trước**
  (translate.ts có patch riêng cho quirk tool-call của model hiện tại —
  model khác qua OpenRouter có thể lộ quirk mới chưa từng tune). UI không
  giải quyết được việc này, chỉ nên có 1 dòng cảnh báo nhẹ trong tooltip
  picker, ví dụ "Đổi model giữa cuộc trò chuyện có thể ảnh hưởng cách agent
  gọi tool".
- **`OPENROUTER_API_KEY` chưa set thì provider xuất hiện trong `failures`**,
  không phải `groups` — nghĩa là ngay sau khi patch xong `llm-pi-ai` (theo
  plan cũ), nếu chưa vào Settings set key, picker vẫn hiện được OpenRouter
  (dạng disabled + lý do) chứ không biến mất — hành vi đúng, không phải bug,
  nhưng cần test thật để chắc `failures` thật sự render đúng chứ không bị bỏ
  sót lúc build UI.

## Definition of Done

- [ ] `GET /api/v1/model-catalog` trả về đúng shape `ModelCatalog`, có
  OpenRouter trong `groups` sau khi set key, trong `failures` khi chưa set.
- [ ] `POST /api/v1/session-select-model` đổi model một session đang sống,
  xác nhận qua `request/context` event của turn kế tiếp đúng provider/model
  mới chọn.
- [ ] Settings > Config có field OpenRouter API key, dùng chung
  `CredentialField`, không có code riêng.
- [ ] Picker trong composer hiện đúng model hiện tại (kể cả trường hợp session
  chưa chạy turn nào — fallback default), disable khi đang chạy turn, hiện
  provider lỗi ở dạng disabled kèm lý do thay vì ẩn.
- [ ] Switch không ảnh hưởng session MỚI khác — default toàn hệ thống
  (`agent-default-model`) không đổi.
