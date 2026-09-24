# Getting Started — hướng dẫn khởi động cho user tự host

Dành cho người **nhận gói `fox-harness` này để tự chạy trên máy mình** (không phải người phát
triển repo). Nếu bạn là dev đang sửa code, xem `README.md` thay vì file này.

**Chạy app này bắt buộc phải có Docker** — không có cách nào khác để chạy trực tiếp bằng
Node/pnpm được hỗ trợ chính thức cho user. Lý do: Docker đảm bảo đúng version Node/pnpm/hệ điều
hành app cần mà không bắt user tự cài đặt/pin version thủ công — 1 nguồn lỗi rất phổ biến nếu để
user tự setup môi trường Node trên máy mình.

## 1. Lấy code

```sh
git clone https://github.com/tylerdo239/local-fox-harness-core.git fox-harness
cd fox-harness
```

(Nếu được gửi qua zip thay vì git, giải nén rồi `cd` vào thư mục đó là được — nhưng khuyên dùng
git clone nếu có thể, vì cập nhật sau này sẽ chỉ còn 1 lệnh `git pull`, xem `docs/upgrading.md`.)

## 2. Yêu cầu hệ thống

Chỉ cần **Docker + Docker Compose** (Docker Desktop trên Mac/Windows đã có sẵn Compose; Linux cài
qua `get.docker.com` cũng có sẵn `docker compose`). Không cần cài Node, pnpm, hay bất cứ gì khác.

## 3. Khởi động — đúng 1 lệnh

```sh
./scripts/start.sh
```

Script này tự lo mọi thứ theo thứ tự sau:

1. **Kiểm tra Docker.** Nếu máy đã có Docker và đang chạy → qua bước 2 ngay. Nếu **chưa cài
   Docker**, script **không tự ý cài giùm** (cài Docker cần quyền `sudo` và đổi cấu hình hệ
   thống máy bạn — việc này nên để bạn tự thấy và tự chạy, không nên để 1 script âm thầm làm) —
   thay vào đó nó in ra đúng 1 lệnh cài theo đúng hệ điều hành bạn đang dùng (Linux/Mac), bạn
   copy chạy lệnh đó, rồi chạy lại `./scripts/start.sh`.
2. **Hỏi nhanh cấu hình** (chỉ lần đầu tiên, khi chưa có file `.env`):

   ```
   ==> Chưa có .env — nhập nhanh để bắt đầu (Enter để bỏ qua, sửa .env sau):
       OPENAI_API_KEY (bắt buộc để chat hoạt động): sk-xxxxxxxxxxxxxxxx
       OPENAI_BASE_URL (Enter = dùng OpenAI thật, hoặc dán URL server của bạn): https://proxy-cua-ban.example.com/v1
       OPENAI_MODEL_ID (vd gpt-4o-mini — Enter để cấu hình sau): gpt-4o-mini
   ```

   Trả lời xong, script tự ghi vào file `.env` — **không cần tự tạo hay mở file nào bằng tay**.
   Bỏ trống (Enter) vẫn chạy được: `OPENAI_BASE_URL` trống → dùng OpenAI thật;
   `OPENAI_API_KEY`/`OPENAI_MODEL_ID` trống → chat sẽ báo lỗi rõ ràng cho tới khi bạn điền sau.
   **Chỉ hỏi đúng 1 lần** — từ lần chạy `./scripts/start.sh` thứ 2 trở đi (đã có `.env`), script
   bỏ qua bước này và khởi động thẳng.
3. **Build + khởi động nền (detached)** qua `docker compose up --build -d` (lần đầu build image
   sẽ mất vài phút). Chạy nền nghĩa là **đóng terminal, mất kết nối SSH... app vẫn tiếp tục
   chạy** — không giống lệnh chạy trực tiếp bị dừng theo terminal.

Xong, mở trình duyệt vào `http://127.0.0.1:3080`. Script tự in ra 2 lệnh hữu ích sau khi khởi
động xong:

```sh
docker compose -f deploy/docker-compose.yml logs -f core   # xem log trực tiếp, Ctrl-C để thoát xem log (KHÔNG dừng app)
docker compose -f deploy/docker-compose.yml down           # dừng hẳn app
```

Muốn đổi lại cấu hình sau này: sửa trực tiếp file `.env` (không cần xoá), rồi chạy lại
`./scripts/start.sh` — hoặc xoá hẳn `.env` để được hỏi lại từ đầu. **`./scripts/start.sh` cũng
chính là lệnh cập nhật lên code mới** (sau `git pull`) — xem mục 7.

### Toàn bộ biến trong `.env`

| Biến | Bắt buộc? | Mặc định nếu để trống | Ý nghĩa |
|---|---|---|---|
| `OPENAI_API_KEY` | **Có** | *(không có — chat sẽ báo lỗi thiếu credential)* | API key của server bạn dùng (OpenAI thật, hoặc bất kỳ server tương thích OpenAI: Azure OpenAI, vLLM, Ollama, LM Studio, OpenRouter, 1 proxy tự host...) |
| `OPENAI_BASE_URL` | Không | `https://api.openai.com/v1` | URL server, đến trước `/chat/completions` |
| `OPENAI_MODEL_ID` | Không (nhưng nên điền) | `unconfigured-model` (placeholder — chat sẽ lỗi rõ ràng nếu dùng giá trị này) | ID model thật, vd `gpt-4o-mini`, `hosted_vllm/Qwen/Qwen3.5-35B-A3B-FP8` |
| `OPENAI_EXTRA_BODY` | Không | *(không gửi thêm gì)* | JSON object gộp thêm vào mỗi request — dùng cho tham số riêng của server (vd tắt "thinking mode" của Qwen). **Phải là JSON hợp lệ nếu điền**, sai cú pháp sẽ làm app không khởi động được. Ví dụ: `{"chat_template_kwargs":{"enable_thinking":false}}`. Không hỏi trong wizard ở bước 3 (JSON gõ trên 1 dòng terminal dễ gõ sai) — điền bằng cách mở file `.env` sửa tay |
| `OPENAI_CONTEXT_WINDOW` | Không | *(không khai báo — tắt cơ chế tự nén ngữ cảnh chủ động)* | Số token context window thật của model, vd `20000`. Giúp hệ thống tự nén hội thoại trước khi bị server từ chối vì quá dài. Cũng điền bằng cách sửa `.env` tay, không có trong wizard |

### Các credential khác — cấu hình qua UI (khuyến nghị) hoặc cũng có thể qua `.env`

Những mục dưới đây **không bắt buộc để chat hoạt động** — chỉ cần khi bạn muốn dùng tính năng
tương ứng. Cách dễ nhất: mở app lên, vào **Settings → Config**, dán giá trị vào, bấm Lưu — set
1 lần, không cần restart.

| Credential | Dùng cho | Nơi cấu hình |
|---|---|---|
| `SERPER_API_KEY` | Tool tìm kiếm web (`web_search`) | Settings → Config, hoặc biến `.env` cùng tên |
| `OPENROUTER_API_KEY` | Chọn model OpenRouter (Claude, GPT, Llama...) ngay trong khung chat — nút cạnh nút Gửi, không đổi model mặc định của cả hệ thống | Settings → Config, hoặc biến `.env` cùng tên |
| `ZAI_API_KEY` | Chọn model Z.ai (GLM, ví dụ `glm-5.3`, context 1M) ngay trong khung chat, cùng chỗ với OpenRouter | Settings → Config, hoặc biến `.env` cùng tên |
| `N8N_API_KEY` | Tool tạo/sửa workflow n8n (opt-in, xem mục 6) | Settings → Config, hoặc biến `.env` cùng tên |
| `N8N_WEBHOOK_SECRET` | Xác thực webhook từ n8n gọi ngược vào app | Settings → Config, hoặc biến `.env` cùng tên |
| `ADMIN_PASSWORD` | Mật khẩu đăng nhập app (mặc định `12345678`) | Settings, hoặc biến `.env` cùng tên |

Chưa cấu hình `OPENROUTER_API_KEY`/`ZAI_API_KEY` thì bấm chọn model tương ứng
trong khung chat sẽ hiện thông báo lỗi (toast) và tự mở Settings để bạn điền —
không cần tự đi tìm chỗ cấu hình.

> **Lưu ý quan trọng:** nếu 1 credential đã được set qua biến môi trường thật (`.env`), nó sẽ
> **luôn thắng** giá trị lưu qua UI (biến môi trường có độ ưu tiên cao nhất) — form trong Settings
> lúc đó sẽ báo lỗi khi lưu vì không thể ghi đè được nữa. Chỉ set 1 trong 2 nơi cho mỗi
> credential, đừng làm cả hai để tránh nhầm lẫn.

## 4. Đăng nhập lần đầu

- Username: `admin`
- Password mặc định: `12345678` (nếu chưa set `ADMIN_PASSWORD`)

**Nên đổi ngay** qua Settings sau lần đăng nhập đầu tiên, nhất là nếu máy này có thể truy cập
từ mạng khác ngoài `127.0.0.1`.

## 5. Kiểm tra hoạt động

Sau khi đăng nhập, gửi 1 tin nhắn chat bất kỳ (vd "xin chào"). Nếu:
- Có phản hồi bình thường → cấu hình `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL_ID` đã đúng.
- Báo lỗi "no credential found for OPENAI_API_KEY" → chưa điền `OPENAI_API_KEY` trong `.env`.
- Báo lỗi liên quan đến model không tồn tại/404 từ server → `OPENAI_MODEL_ID` sai tên hoặc
  chưa điền (đang dùng placeholder `unconfigured-model`).

## 6. Tính năng tùy chọn — tự động hoá n8n

Tích hợp n8n (tạo/sửa/chạy workflow từ chat) **mặc định KHÔNG bật** — cần 1 bước cấu hình thủ
công 1 lần (thêm 1 đoạn vào `data/harness/profiles/cordis-app/cordis.patch.yml`). Xem hướng dẫn
đầy đủ, kèm ví dụ thật, tại `docs/patch-cookbook.md` → "Ví dụ 4 — Bật tích hợp n8n".

## 7. Tính năng có sẵn mặc định — Gmail qua trình duyệt thật

Khác n8n (phải bật thủ công), **tool Gmail (`gmail_list`, `gmail_read`, `gmail_send`...) đã bật
sẵn ngay từ lần chạy `./scripts/start.sh` đầu tiên** — không cần sửa `cordis.patch.yml`. Cơ chế:
app điều khiển 1 trình duyệt Chrome thật (chạy trong container `playwright-mcp`) đã đăng nhập sẵn
tài khoản Gmail của bạn.

**Bắt buộc phải làm 1 lần**: đăng nhập Google bằng tay qua giao diện VNC:

1. Mở `http://127.0.0.1:6080/vnc.html` trên trình duyệt.
2. Đăng nhập Gmail như bình thường trong cửa sổ đó.
3. Xong — phiên đăng nhập được lưu lại (volume `browser-profile`), sống sót qua mọi lần restart
   sau này, không cần đăng nhập lại trừ khi Google tự đăng xuất.

**Chưa đăng nhập thì sao?** App vẫn khởi động và chat bình thường — tool Gmail chỉ báo lỗi "browser
service unreachable"/"browser not ready" khi thực sự được gọi, không chặn gì khác. Không dùng tính
năng Gmail thì bỏ qua bước này hoàn toàn cũng không sao.

**Chạy máy chủ từ xa (VPS)?** Đừng mở port 6080 ra ngoài — dùng SSH tunnel:
```sh
ssh -L 6080:127.0.0.1:6080 <user>@<server>
```
rồi mở `http://127.0.0.1:6080/vnc.html` như bình thường trên máy của bạn.

## 8. Cập nhật lên bản mới

`git pull` rồi chạy lại `./scripts/start.sh` — dữ liệu (session, credential đã lưu, workflow
n8n...) không bị mất, xem chi tiết + checklist backup tại `docs/upgrading.md`.

## 9. Xử lý lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| Chạy `./scripts/start.sh` mà không thấy hỏi `OPENAI_API_KEY` | Terminal không tương tác được (vd chạy qua script khác, CI) — script tự bỏ qua bước hỏi, tự sửa `.env` bằng tay theo mục 3 |
| App không khởi động, log báo lỗi cú pháp JSON | `OPENAI_EXTRA_BODY` trong `.env` không phải JSON hợp lệ — kiểm tra lại dấu ngoặc/nháy |
| Chat báo "no credential found for OPENAI_API_KEY" | Chưa điền `OPENAI_API_KEY` trong `.env` |
| Sửa `.env` xong nhưng không có tác dụng | Cần chạy lại `./scripts/start.sh` (hoặc `docker compose -f deploy/docker-compose.yml restart core`) — `.env` chỉ được đọc lúc khởi động |
| Muốn đổi credential qua Settings nhưng lưu không được | Credential đó đang bị 1 biến môi trường thật trong `.env` ghi đè — xem lưu ý ở mục 3 |
| Vào `http://127.0.0.1:3080` không được | Kiểm tra `docker compose -f deploy/docker-compose.yml ps` xem container `core` có đang chạy không; xem log bằng `docker compose -f deploy/docker-compose.yml logs core` |
| Gọi tool Gmail báo "browser service unreachable"/"browser not ready" | Chưa đăng nhập Google qua VNC (xem mục 7), hoặc container `playwright-mcp` chưa chạy — kiểm tra `docker compose -f deploy/docker-compose.yml ps` |
