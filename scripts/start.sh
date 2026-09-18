#!/bin/sh
# THE single entry point for an end user self-hosting this app — Docker is
# mandatory by design (no alternate non-Docker path is offered here): it's
# the only way to guarantee the exact Node/pnpm versions this app needs
# without asking a non-developer to install and pin them by hand.
# (scripts/dev.sh still exists for US, the developers, iterating on the
# actual code locally — it is not part of the shipped user experience and
# is deliberately never mentioned to the user from here.)
#
# Detects whether Docker is usable and, if not, PRINTS the exact install
# command for their OS instead of running it: installing system packages
# needs sudo and changes machine-wide state, and this script runs on end
# users' own machines we've never seen — silently `curl | sudo sh`-ing on
# someone else's box on their behalf is exactly the kind of action that
# should stay an explicit, visible step THEY run, not something a script
# decides for them. Once Docker is confirmed working, everything else IS
# fully automatic: a one-time interactive .env wizard (skipped after the
# first run), then `docker compose up --build -d` (detached — a self-hosted
# app should survive the terminal/SSH session that launched it closing, not
# stop with it). Re-running this same command after a `git pull` is also the
# correct update path: `up --build` rebuilds the image and Compose recreates
# the running container automatically when the image changed — confirmed
# via a real experiment (build, edit source, re-run without `down` first:
# the container was torn down and recreated with a new ID, running the new
# code), not assumed.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/deploy/docker-compose.yml"
ENV_FILE="$REPO_ROOT/.env"

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

if ! docker_ready; then
  echo "==> Chưa dùng được Docker trên máy này — bắt buộc phải có Docker để chạy app này." >&2
  if ! command -v docker >/dev/null 2>&1; then
    case "$(uname -s 2>/dev/null || echo unknown)" in
      Linux)
        echo "    Docker chưa được cài. Chạy lệnh cài chính thức từ Docker rồi chạy lại ./scripts/start.sh:" >&2
        echo "" >&2
        echo "        curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker \"\$USER\"" >&2
        echo "" >&2
        echo "    Sau đó đăng xuất/đăng nhập lại (hoặc chạy 'newgrp docker') để dùng docker không cần sudo." >&2
        ;;
      Darwin)
        echo "    Docker chưa được cài. Cài Docker Desktop cho Mac rồi mở app đó lên 1 lần:" >&2
        echo "        https://www.docker.com/products/docker-desktop" >&2
        echo "    (hoặc nếu có Homebrew: brew install --cask docker)" >&2
        echo "    Xong thì chạy lại ./scripts/start.sh." >&2
        ;;
      *)
        echo "    Docker chưa được cài. Cài Docker Desktop rồi chạy lại ./scripts/start.sh:" >&2
        echo "        https://www.docker.com/products/docker-desktop" >&2
        ;;
    esac
  else
    echo "    Docker đã cài nhưng chưa chạy được (daemon chưa lên). Mở app Docker Desktop" >&2
    echo "    (Mac/Windows), hoặc chạy 'sudo systemctl start docker' (Linux), rồi chạy lại" >&2
    echo "    ./scripts/start.sh." >&2
  fi
  exit 1
fi

# One-time interactive setup — only these 3 plain-string fields (not
# OPENAI_EXTRA_BODY/OPENAI_CONTEXT_WINDOW: those are advanced/JSON-shaped,
# a typo on a single terminal line would only surface as a hard boot crash
# later — see .env.example's own comment; better left to a deliberate file
# edit). OPENAI_BASE_URL is asked here too, not just OPENAI_API_KEY: most
# real deployments of this app point at a self-hosted/proxy endpoint, not
# real OpenAI, so asking up front avoids a silent wrong-default that only
# surfaces as a confusing later error. `[ -t 0 ]` skips this silently in a
# non-interactive shell (CI, piped stdin) instead of hanging on `read`.
if [ ! -f "$ENV_FILE" ] && [ -t 0 ]; then
  echo "==> Chưa có .env — nhập nhanh để bắt đầu (Enter để bỏ qua, sửa $ENV_FILE sau):" >&2
  printf '    OPENAI_API_KEY (bắt buộc để chat hoạt động): ' >&2
  read -r start_sh_api_key || true
  printf '    OPENAI_BASE_URL (Enter = dùng OpenAI thật, hoặc dán URL server của bạn): ' >&2
  read -r start_sh_base_url || true
  printf '    OPENAI_MODEL_ID (vd gpt-4o-mini — Enter để cấu hình sau): ' >&2
  read -r start_sh_model_id || true
  {
    echo "OPENAI_API_KEY=$start_sh_api_key"
    echo "OPENAI_BASE_URL=$start_sh_base_url"
    echo "OPENAI_MODEL_ID=$start_sh_model_id"
    echo "OPENAI_EXTRA_BODY="
    echo "OPENAI_CONTEXT_WINDOW="
  } > "$ENV_FILE"
  if [ -z "$start_sh_api_key" ]; then
    echo "    (chưa nhập OPENAI_API_KEY — chat sẽ báo lỗi thiếu credential tới khi bạn điền vào $ENV_FILE)" >&2
  fi
  echo "==> Đã lưu $ENV_FILE — sửa lại bất kỳ lúc nào rồi chạy lại ./scripts/start.sh để áp dụng." >&2
fi

echo "==> Docker sẵn sàng — khởi động (lần đầu sẽ build image, có thể mất vài phút)..." >&2
# -d (detached), không phải chạy foreground: app tự host này cần sống sót
# qua việc đóng terminal / mất SSH, không nên bị dừng chỉ vì phiên đó kết
# thúc. `up --build` (có --build hay không) tự phát hiện image mới và
# recreate đúng container đang chạy — xác nhận thật bằng thực nghiệm (build
# lại 1 image test, đổi code, chạy lại đúng lệnh này KHÔNG `down` trước:
# container cũ tự bị Recreate/Recreated/Started với ID mới, phản ánh đúng
# code mới) — không cần `docker compose down` trước mỗi lần cập nhật.
docker compose -f "$COMPOSE_FILE" up --build -d
echo "" >&2
echo "==> Đang chạy ở http://127.0.0.1:3080 (chạy nền, đóng terminal không sao)." >&2
echo "    Xem log:  docker compose -f deploy/docker-compose.yml logs -f core" >&2
echo "    Dừng lại: docker compose -f deploy/docker-compose.yml down" >&2
