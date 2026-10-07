# Cài đặt và bàn giao Campus Together

## 1. Chọn đúng loại dữ liệu

| Mục tiêu | Dữ liệu / lệnh | Điều kiện |
|---|---|---|
| Chạy, sửa, kiểm thử game | Source Git + `npm ci`, `npm run build` | Node/npm, registry hoặc npm cache đầy đủ |
| Chạy runtime đã đóng gói | `artifacts/sha256/<SHA>.tar.gz` trong snapshot | Xác minh `tools/verify-runtime.mjs`, cài production dependencies |
| Khôi phục dữ liệu làm việc/lịch sử | Full snapshot + manifest + parts + SHA256SUMS | Giải nén vào nơi mới; đọc chính sách runtime bên dưới |
| Dựng lại GLB | `assets/source/*.py` và `.blend` | Blender 5.2.1; không cần cho chạy game |
| Public HTTPS/WSS | Runbook `docs/cloudflare.md` hoặc Caddy | Operator được cấp quyền triển khai, cấu hình mới theo máy đích |

**Repository PRIVATE:** https://github.com/15tuanluongk46-code/campus-together.
Quyền riêng tư đã được xác minh ngày 2026-10-07. Source và backup là hai phần bàn giao:
source lấy qua Git; snapshot đầy đủ lấy từ Release `full-backup-2026-10-07` khi
Release được công bố. Xem `publication-report.md` và `RECOVERY.md` đính kèm Release
để biết SHA, kết quả upload/download và cách khôi phục đã kiểm chứng. Các file local
trong `artifacts/` và `releases/` tự chúng không chứng minh đã upload thành công.

## 2. Yêu cầu

- Linux được dùng để xác minh: Node **v22.23.2**, npm **10.9.8**, Python **3.12.3**.
- `package.json` yêu cầu Node **>=22.12.0**. Dùng npm 10+ và giữ `package-lock.json`.
- Game dùng WebGL2, keyboard/mouse, Pointer Lock; không có giao diện cảm ứng.
- Browser tests dùng Playwright trong lockfile và Chromium. Hệ điều hành phải có
  thư viện chạy Chromium; máy đích khác Linux chưa được xác minh.
- Unix-socket / `/proc` operator tests đặc thù Linux. Không suy ra Windows hỗ trợ
  tunnel operator chỉ vì frontend chạy trên browser.
- Công cụ full snapshot: Python standard library + Git + **gitleaks 8.30.1** trong PATH.
  Cần dung lượng cho staging, archive và kiểm tra lại; tool preflight từ chối nếu thiếu.
- Không cần MCP, dịch vụ AI hay cấu hình cá nhân để build/run/test game.

## 3. Lấy source và cài dependency

Dùng tài khoản đã được cấp quyền truy cập repository PRIVATE:

```sh
git clone https://github.com/15tuanluongk46-code/campus-together.git campus-together
cd campus-together
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

Xác thực bằng Git credential helper hoặc `gh`; không đặt PAT
vào URL. Không xóa checkout đang có dữ liệu để clone đè. Workspace gồm
`apps/client`, `apps/server`, `packages/shared`. GLB, fonts và provenance cần cho
game đã có trong `apps/client/public/assets`; build không cần Blender hay tải font.
Snapshot có `node_modules` lịch sử nhưng không dùng chúng thay cho `npm ci` khi
chuyển OS/CPU hoặc cần chứng minh build sạch.

## 4. Cấu hình và chạy

`.env.example` là tài liệu defaults, root `.env` **không được server tự đọc**.
Server lấy biến từ process. Với một origin, để `VITE_SERVER_URL` không được đặt.
Client khác origin cần biến đó **tại build time**; giá trị sẽ nằm trong bundle.

```sh
# Dev: server 2567 + client 5173; sửa shared thì build:server lại.
npm run dev

# Production local sau build:
HOST=127.0.0.1 PORT=2567 npm start

# LAN: chủ động mở interface, URL chia sẻ phải dùng IP của host.
HOST=0.0.0.0 PORT=2567 npm start
```

`npm run dev` / `dev:client` dùng Vite bind **0.0.0.0**, không chỉ localhost.
Nếu chỉ muốn loopback, chạy hai terminal sau build server:

```sh
# terminal 1
HOST=127.0.0.1 PORT=2567 npm run dev:server
# terminal 2
npx vite apps/client --host 127.0.0.1
```

Mở `http://localhost:5173` (dev), `http://localhost:2567` (production).
`/health` là liveness; `/ready` là aggregate simulation readiness. Ctrl-C chỉ ở
terminal/process mình vừa chạy. Room nằm trong RAM, restart kết thúc phiên.
Xem `docs/backend-operations.md` cho validation/admission/shutdown.

## 5. Kiểm tra tái lập

```sh
npm run typecheck
npm run test:unit
npm run test:client
npm run test:integration
npm test                         # build + toàn bộ Vitest; các vòng chơi real-time
npm run build

# Chromium do Playwright quản lý hoặc binary có sẵn; profile mới do test sở hữu.
npx playwright install chromium
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome npm run test:e2e:production
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome npm run test:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome npm run test:e2e:startup
```

Không cần chạy cả từng nhóm Vitest lẫn `npm test` nếu chỉ cần một lần toàn suite.
Browser server mặc định dùng 2667/5273; đổi `CAMPUS_TEST_PORT` và
`CAMPUS_CLIENT_PORT` khi bận. Không reuse server live. Tests tự tạo context/profile.
Một số integration tests cần thư mục `.superpowers` tồn tại và Unix socket path
ngắn hơn 104 bytes; trong clone sạch, tạo `mkdir -p .superpowers` trước `npm test`.
Chọn checkout có đường dẫn ngắn cho Linux socket tests.

**Giới hạn portability hiện hữu:** `tests/e2e/art.spec.ts` và harness chẩn đoán
`tests/performance/run.ts` có đường dẫn `/home/sss/...` hardcode. Art audit chưa thể
được coi là portable chỉ từ build; không chạy harness đó ở máy khác rồi lấy source
từ checkout cũ. Browser production/startup và các bài khác không cần profile cá nhân.
Các script thu thập evidence ngoài scripts trong `package.json` phải đọc cấu hình
trước khi chạy; chúng không phải điều kiện để chơi game.

Snapshot tool có test riêng:

```sh
python3 tools/test_handoff.py
ruff check tools/handoff*.py tools/test_handoff.py
pyright tools/handoff*.py tools/test_handoff.py
```

## 6. Tạo runtime và khôi phục snapshot

```sh
npm run package
# artifacts/campus-together-0.1.0.tar.gz và artifacts/sha256/<SHA>.tar.gz
```

`tools/package.mjs` cài/build source trong staging riêng, không lấy dist cũ và
không sửa dist checkout đang phục vụ. Runtime manifest kiểm tree/source hashes.
Giải nén runtime vào thư mục mới rồi chạy:

```sh
node tools/verify-runtime.mjs
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
HOST=127.0.0.1 PORT=2567 npm start
```

Gói runtime khác full snapshot: không chứa node_modules, render/evidence, `.blend`
hay trạng thái operator. Full snapshot giữ các dữ liệu đó kể cả archive/runtime lồng nhau.
Quy trình snapshot local (mỗi lần dùng tên run mới):

```sh
python3 tools/handoff.py inventory --run my-snapshot
python3 tools/handoff.py capture --run my-snapshot
python3 tools/handoff.py scan --run my-snapshot
# Nếu findings: review theo path/rule/line/hash; không blanket-ignore.
# --triage chỉ nhận các ID false-positive cụ thể đã review.
python3 tools/handoff_review.py my-snapshot --summary --save
# Tool triage chỉ chứa các SHA/rule/line đã review ở lần bàn giao này;
# vendor phải khớp lần npm ci sạch trong .handoff/t/src.
python3 tools/handoff_triage.py my-snapshot
python3 tools/handoff.py scan --run my-snapshot --triage .handoff/my-snapshot/triage-reviewed.json
python3 tools/handoff.py pack --run my-snapshot
python3 tools/handoff.py verify --run my-snapshot
python3 tools/handoff.py delta --run my-snapshot
```

Output `.handoff/<run>`: `manifest.json`, `preflight.json`, `archive-composition.json`,
`scan.json`, `source-delta.json`, `parts.json`, `SHA256SUMS`, `verification.json`.
Parts mặc định tối đa **950.000.000 bytes**. Download đủ parts + manifest/checksums,
kiểm `sha256sum -c SHA256SUMS`, ghép đúng thứ tự trong `parts.json`, giải nén vào
thư mục trống do operator chọn. Tool `verify` đọc lại từng member/hash/mode/symlink,
không chạy nội dung archive. Không giải nén đè project live.

Manifest lưu path/type/mode/bytes/SHA-256; symlink lưu target, không đi theo target.
Nguồn được copy khi stat trước/sau ổn định, kiểm hash staging, ghi thời gian từng file.
Đây là snapshot theo file của một cây đang sống, **không phải snapshot nguyên tử**.
`source-delta-latest.json` liệt kê nguồn đổi/thêm/mất sau capture.

Snapshot không đóng gói `.git`. Release bổ sung `campus-together-history.bundle`
sau commit để khôi phục lịch sử Git mà không chứa credential/config local; xem
`RECOVERY.md` và checksum sidecar trước khi sử dụng.
`.handoff` loại để không tự nhân bản. Known credentials/vault/profile chỉ metadata,
không đọc/copy/scan; nếu có thì block archive chờ chính sách mã hóa. Socket/FIFO/device
chỉ metadata, không restore. `.cloudflare/tunnel-process.json`, PID/log/config là
**lịch sử**, không dùng PID để signal hoặc tự start tunnel. Tạo private socket directory
mới và config đúng absolute path máy đích. Không bảo đảm tunnel hostname cũ còn sống.

## 7. Asset rebuild tùy chọn

Giữ cả `assets/source/campus-assets.blend` (nguồn) và `campus-glb-review.blend`
(reimport review). `.blend1`, `.blend2`, render sequences và evidence nằm trong full
snapshot. Chạy Blender background trên bản copy nếu không muốn thay asset hiện có:

```sh
BLENDER=/absolute/path/to/blender
"$BLENDER" --background --factory-startup --python-exit-code 1 --python assets/source/build.py
"$BLENDER" --background --factory-startup --python-exit-code 1 --python assets/source/validate.py
"$BLENDER" --background --factory-startup --python-exit-code 1 --python assets/source/evidence.py
python3 -m venv .handoff/art-venv
.handoff/art-venv/bin/pip install Pillow
.handoff/art-venv/bin/python assets/source/contact_sheets.py
python3 assets/source/verify_delivery.py
```

Pipeline gốc dùng Blender **5.2.1**, ffmpeg/ffprobe cho video và Pillow cho contact
sheet. `inspect_images.py` là trợ lý review tùy chọn cần dịch vụ local riêng; không
cần cho game/build. Không chạy `live_preview.py` lên scene người dùng khi handoff.

## 8. Deployment, lỗi thường gặp và giấy phép

- Lịch sử 2026-10-07: public browser smoke HTTPS/WSS đã PASS theo báo cáo snapshot;
  SDK assertions pass nhưng helper timeout, IP-spoof admission inconclusive. Phiên
  handoff không tái kiểm public endpoint. Xem README và `docs/cloudflare.md`.
- Caddy/systemd/Docker là template: xem `deploy/`, `Dockerfile`; sửa domain, user,
  absolute path và Node path theo máy. Không tự bật service hay nhân replicas.
- Thiếu dependency / registry: dùng đúng lockfile và registry hoặc npm cache đầy đủ;
  không dựa vào node_modules của OS/CPU khác. Thiếu Chromium: cài revision phù hợp
  hoặc truyền `PLAYWRIGHT_CHROMIUM_EXECUTABLE` tới binary thực.
- Port bận: chọn port khác, không kill process live. Unix socket quá dài: rút ngắn
  đường dẫn checkout/workspace; không xóa socket lạ.
- Source Git PRIVATE giữ quyền của chủ sở hữu, **không cấp giấy phép source mới**.
  Giữ nguyên các giấy phép đã có cho GLB/procedural art/audio (CC0 theo provenance),
  fonts SIL OFL và dependency licenses. PRIVATE không hủy các giấy phép asset đã có.
