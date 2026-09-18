# Cập nhật code mới cho user mà không mất dữ liệu đang chạy

Trả lời câu hỏi: gửi code mới cho user (đã tự host từ trước), họ cập nhật, nhưng **không được
mất** session chat, credential đã lưu, workflow n8n đã tạo... đang chạy.

## Tóm tắt: đã tự động, chỉ cần đúng cách cập nhật code

Toàn bộ dữ liệu runtime **không nằm trong image/code** — nó nằm ngoài, ở 2 chỗ:

| Dữ liệu | Nằm ở đâu | Có tự sống sót qua cập nhật không? |
|---|---|---|
| Session chat, credential đã lưu (API key, Serper, n8n...), settings, `cordis.patch.yml` đã chỉnh | `data/harness/` (bind mount) | **Có, tự động** — không nằm trong image |
| Workspace file của agent | volume Docker `workspace` | **Có, tự động** |
| Dữ liệu n8n (workflow, execution history) | volume Docker `n8n-data` | **Có, tự động** |

`deploy/docker-compose.yml` cố tình dùng **bind mount** cho `data/harness` (không phải named
volume) chính vì lý do này — build lại image mới, tạo lại container mới, volume/bind-mount vẫn
gắn lại y hệt, không ai đụng tới. Vậy quy trình cập nhật thật sự chỉ là:

```sh
# Trên máy user, trong thư mục fox-harness/ đã clone từ trước
git pull                                          # lấy code mới
./scripts/start.sh                                # rebuild + restart, dữ liệu giữ nguyên
```

(`./scripts/start.sh` chỉ hỏi lại cấu hình nếu `.env` không còn tồn tại — bình thường sẽ khởi
động thẳng, tương đương chạy tay `docker compose -f deploy/docker-compose.yml up --build -d`.)

**Vì sao khuyên dùng `git pull` làm cơ chế cập nhật, không phải gửi file zip:** `.gitignore` của
repo này đã loại trừ sẵn `/data/`, `/.dev-state/`, `/.env` — nghĩa là `git pull`/`git clone` **cấu
trúc không bao giờ đụng tới các đường dẫn chứa dữ liệu thật**, dù code có đổi bao nhiêu. Gửi zip
"code mới" và bảo user tự copy đè cũng được, nhưng rủi ro hơn — dễ lỡ tay copy đè cả `data/`/`.env`
nếu không cẩn thận loại trừ thủ công.

## 1 điều CẦN BIẾT: 2 tầng cấu hình khác nhau, sống sót khác nhau

Repo này có 2 tầng `cordis.patch.yml` (xem `docs/patch-cookbook.md`), và chúng **không** cập nhật
qua `git pull` theo cùng 1 cách:

- **Tầng package** (`packages/*/cordis.patch.yml`, vd `packages/llm/openai-compat/cordis.patch.yml`
  — nơi `contextWindow`/`extraBody`/model mặc định đang cấu hình): nằm trong code, được đọc lại
  MỚI HOÀN TOÀN mỗi lần khởi động. **Cập nhật qua `git pull` + rebuild là đủ, tự động áp dụng
  cho user đang chạy, không cần làm gì thêm.**
- **Tầng profile** (`data/harness/profiles/cordis-app/cordis.patch.yml` hoặc
  `.dev-state/harness/.../cordis.patch.yml`): file này chỉ được **copy từ template
  (`deploy/profile-template/cordis-app/cordis.patch.yml`) ĐÚNG 1 LẦN, lúc container/máy đó boot
  lần đầu tiên** (xem `deploy/entrypoint.sh`: `[ -f "$PROFILE_DIR/cordis.patch.yml" ] ||
  cp ...`). Nếu bạn sửa `deploy/profile-template/cordis-app/cordis.patch.yml` trong 1 bản cập
  nhật sau này, **user ĐANG CHẠY sẽ KHÔNG tự nhận được thay đổi đó** — file của họ đã tồn tại từ
  trước, script sẽ không ghi đè (đúng ý đồ: không được xoá mất chỉnh sửa tay của user). Chỉ máy
  hoàn toàn mới (chưa từng boot) mới nhận được nội dung template mới.

**Áp dụng vào thực tế:** vì lý do này, các thay đổi mặc định quan trọng của phiên này (bật
`tool-result-pruner`, cấu hình `agent-default-model`/`contextWindow`/`extraBody` qua env var) đều
cố tình đặt ở **tầng package**, không đặt ở tầng profile — để user đang chạy nhận được ngay qua
`git pull` + restart, không cần bạn hướng dẫn thêm bước thủ công nào. n8n/MCP vẫn ở tầng profile
vì bản chất là 1 tính năng opt-in, cấu hình riêng theo từng n8n instance của mỗi user — không có
giá trị mặc định chung nào hợp lý để tự động áp dụng.

Nếu 1 ngày bạn cần đẩy 1 thay đổi ở tầng profile cho user ĐANG CHẠY (hiếm khi cần), cách duy nhất
là ghi rõ trong changelog: "mở `data/harness/profiles/cordis-app/cordis.patch.yml`, thêm đoạn
sau..." — không có cách tự động nào khác mà vẫn tôn trọng nguyên tắc "không đè chỉnh sửa tay của
user".

## Checklist cập nhật an toàn (khuyên dùng lần đầu để yên tâm)

```sh
cd fox-harness
cp -r data data.backup.$(date +%Y%m%d)     # backup nhanh trước khi cập nhật
git pull
docker compose -f deploy/docker-compose.yml up --build -d
docker compose -f deploy/docker-compose.yml logs -f core   # xem log khởi động, Ctrl-C khi thấy ổn
```

Nếu có gì bất thường, khôi phục bằng `git checkout <commit cũ>` cho code + `mv data.backup.* data`
cho dữ liệu, rồi `docker compose up --build -d` lại.
