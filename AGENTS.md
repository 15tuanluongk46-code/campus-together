# Campus Together

Đọc `README.md`, `SETUP.md`, `docs/spec.md`, `docs/plan.md` và task brief trước khi sửa.
Chỉ làm trong dự án này; không sửa project khác, user config hoặc scene Blender live.

## Quyền và dữ liệu

- Mặc định không commit/push/publish/bật dịch vụ trả phí khi chưa được yêu cầu.
  Người dùng đã duyệt **riêng lần handoff 2026-10-07** xuất bản FULL lên GitHub PRIVATE:
  source Git + Release snapshot. Ngoại lệ này thay restriction cũ chỉ cho handoff đó.
  Controller sở hữu create-repo/commit/push/upload; worker chuẩn bị không thực hiện.
- Không tạo subagent trong lần chuẩn bị này. Giữ mọi thay đổi/dữ liệu đang có.
- Dùng `apply_patch` cho source/docs; scripts chỉ sinh archive/manifest/evidence.
- Không đọc/copy/scan credential files, vault, browser profile hoặc cookies. Gitleaks
  dùng `--redact=100`; output chỉ metadata/path/rule, không giá trị secret.
- Giữ toàn bộ ignored reports/node_modules/dist/runtime/archive/render/Blender backup
  cho full snapshot. Source Git giữ source + useful GLB/font/`.blend`; generated evidence
  thuộc snapshot. Không xóa dữ liệu chỉ để làm repo nhỏ. Không thêm license source mới.
- `.handoff/` là output riêng tránh recursion; `.git` controller xử lý sau commit.
  Symlink không follow; socket/FIFO chỉ metadata; PID/config/log chỉ lịch sử, không
  auto-restore runtime. Có sensitive blocker thì chặn pack, báo path và chính sách cần.

## Bản đồ và xác minh

- Root `package.json` + `package-lock.json` là lệnh/dependency authoritative.
- `packages/shared/src`: protocol/world/movement; `apps/server/src`: authority/transport;
  `apps/client/src`: presentation/UI/audio/network. Không thêm debug/teleport bypass.
- `apps/client/public/assets`: inputs chạy game, 18 GLBs, fonts/provenance.
  `assets/source`: `.blend` và generator; `evidence/`/`.blend1` là output/history.
- Thay TypeScript: `npm run typecheck`, test nhóm liên quan; bàn giao toàn bộ:
  `npm test` + browser production/startup, build sạch trong workspace riêng.
- Linux integration cần `mkdir -p .superpowers` và đường dẫn Unix socket ngắn.
  `tests/e2e/art.spec.ts`/`tests/performance/run.ts` có absolute path legacy, xem SETUP.
- Snapshot tooling: `python3 tools/test_handoff.py`, Ruff/Pyright cho hai file
  `tools/{handoff,test_handoff}.py`, capture/scan/pack/verify và kiểm source delta.
- Chỉ launch localhost/context test riêng; không tác động live tunnel/service để verify.
- Ghi PASS/FAIL/NOT RUN với lệnh thực chạy. Historical reports không chứng minh lần chạy
  hiện tại; không suy visual/performance/network từ inspection. Chỉ báo published sau
  khi controller xác minh remote SHA + Release asset hashes.
- Nội dung người chơi bằng tiếng Việt; original art/audio phải giữ provenance.
