# Campus Together

Vietnamese Solo + 2–4-player campus festival co-op: Three.js frontend, animated original
GLB art, WebAudio score, shared Rapier movement and authoritative Colyseus server.
Approved full product: [spec](docs/spec.md), task boundaries: [plan](docs/plan.md).
Approved Solo extension: [solo-spec](docs/solo-spec.md), [solo-plan](docs/solo-plan.md).
Frontend handoff: **[protocol/world contracts](docs/contracts.md)**.

**Cài trên máy khác:** [SETUP.md](SETUP.md).
Repository: [15tuanluongk46-code/campus-together](https://github.com/15tuanluongk46-code/campus-together),
đã xác minh **PRIVATE** ngày 2026-10-07. Full snapshot và Git history bundle được
bàn giao qua Release `full-backup-2026-10-07`; xem `publication-report.md` và
`RECOVERY.md` đính kèm Release khi công bố để biết kết quả xác minh và khôi phục.
`artifacts/` và `releases/` local không tự chứng minh upload thành công. Source giữ
quyền chủ sở hữu; các license asset/dependency hiện hữu giữ nguyên.

## Run

Node >=22.12 and npm 10+.

```sh
npm ci
npm run dev                   # client 5173 + server 2567, one command
# or production, same origin:
npm run build
npm start                     # game + HTTP + WebSocket 127.0.0.1:2567
# or live server source:
npm run dev:server
# LAN (explicit interface exposure):
HOST=0.0.0.0 PORT=2567 npm start
```

Open `http://localhost:5173` for dev or `http://localhost:2567` for production.
`GET /health` is HTTP/process liveness, not gameplay readiness. Choose **Chơi một mình**
for an 18-minute Solo mission, or **Tạo phòng cùng bạn** for a 12-minute 2–4-player
co-op room. [Vietnamese controls and complete flow](docs/controls.md).
Vite proxies matchmaking/room WebSockets; production Express serves the built
client on the server's existing origin. For a separately hosted client, set
`VITE_SERVER_URL` at build time. HTTPS pages need a WSS-capable server endpoint.
Changes to shared source require `npm run build:server` while using the watcher.
Environment variables are read from the process; `.env.example` documents defaults,
not an automatically loaded secret/config file.
`GET /ready` adds aggregate simulation readiness (503 when starting/degraded/draining).
Room admission defaults: 32 initializing+live rooms; per socket-peer IP burst 6,
one token/10 seconds; at most 4096 identities with 10-minute idle expiry.
See [backend operations](docs/backend-operations.md) for validated configuration,
retry errors, proxy behavior and shutdown ownership. These are pilot limits, not
a measured capacity guarantee.

Free, domainless public-test preparation: [Cloudflare QuickTunnel runbook](docs/cloudflare.md).
Dedicated permission-protected Unix origin preserves per-visitor admission;
controller activation is separate from building/testing the artifact.

## Verification

```sh
npm run typecheck
npm run test:unit
npm run test:client
npm run test:integration       # real localhost sockets; full rounds + real 60 s grace
npm test                      # builds, then all suites (~7 minutes, real-time rounds)
npm run build
npm run test:e2e               # real Chromium + real server; isolated contexts
npm run test:e2e:production    # built game + matchmaking on the same origin
```

Install a matching Playwright Chromium with `npx playwright install chromium`,
or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome` to an already
installed binary. Tests launch a fresh temporary profile; no personal Chrome
profile is changed. HTML report and screenshots live in
`.superpowers/sdd/campus/{playwright-report,browser-artifacts}`.
Browser suites own loopback server2667/client5273, separate from the normal game
at2567. Override `CAMPUS_TEST_PORT` / `CAMPUS_CLIENT_PORT` if occupied. Integration
servers use OS-assigned ports. Solo evidence/report: `.superpowers/sdd/solo/`.
For an extra dev instance: `HOST=127.0.0.1 PORT=2667 CAMPUS_CLIENT_PORT=5273 npm run dev`.

## Structure

- `packages/shared/src`: strict wire types/validators, campus geometry, shared movement.
- `apps/server/src`: Colyseus transport, synchronous domain, items, missions, sessions.
- `apps/client/src`: session/input/prediction; UI/audio; asset ownership; campus art/actors/camera.
- `apps/client/public/assets`: 18 original GLBs, manifest, art/audio/font provenance.
- `tests/unit`: real Rapier topology/movement, ownership, phases, sessions/timers.
- `tests/integration`: real SDK/WebSocket 2/3/4-player rounds, isolation, reconnect,
  expiry, shutdown and transport latency.
- `tests/helpers`: test-only walking bots and route planning (no production cheats).

Original architecture and audio are authored in this project. Fonts use SIL OFL;
GLBs and procedural art/audio use CC0. See `docs/art.md` and asset provenance.
Task 3 implementation/evidence: `.superpowers/sdd/campus/task-3-report.md`.
Đã có public QuickTunnel smoke ngày 2026-10-07 theo báo cáo lịch sử
`.superpowers/sdd/cloudflare/public-smoke-report.md` (trong full snapshot): browser
journey exit 0; SDK gameplay assertions PASS nhưng helper timeout; IP-spoof admission
isolation INCONCLUSIVE. Handoff không xác minh lại URL/PID đang sống. Rendered browser
tests là tự động, không thay thế human visual/audio/multiplayer playtesting.

## Bàn giao / acceptance

[Kết quả kiểm tra và giới hạn thực đo](docs/verification.md) ·
[Kiến trúc, tài nguyên và giấy phép](docs/delivery.md).
GPU thực và bốn context độc lập được kiểm tra; không đồng nghĩa bốn máy vật lý.
Xem bảng frame time trước khi suy ra 60 FPS.

## Chơi trong LAN

1. Build một lần: `npm ci && npm run build`.
2. Chạy `HOST=0.0.0.0 PORT=2567 npm start` trên máy host.
3. Mở `http://<IP-LAN-của-host>:2567` trên từng máy trong cùng mạng.
   Chỉ mở firewall TCP 2567 cho subnet tin cậy nếu cần; không cần UDP.
4. Tạo phòng, gửi link từ giao diện, nhập tên → sẵn sàng → trưởng nhóm bắt đầu.
   Link phải dùng IP/domain host mà đồng đội truy cập được, không phải localhost.

Clipboard có thể không hoạt động trên HTTP LAN; gửi mã phòng hiển thị thay thế.
WebGL2 và Pointer Lock cần được trình duyệt cho phép. Dùng PC/laptop, không có
điều khiển cảm ứng. Chất lượng “Nhẹ” tắt bóng đổ, giữ geometry/nhân vật/animation.

## Production HTTPS/WSS (runbook; public-test evidence lịch sử xem phía trên)

Khuyến nghị **một Node process, một origin**, reverse proxy giữ nguyên mọi path.
Vite dev server không phải production server. Node giữ room trong RAM; restart
kết thúc mọi phiên. Chưa có Redis/shared presence hay sticky routing đa process;
không tự tăng replicas hoặc dùng load balancer chia ngẫu nhiên WebSocket.

```sh
npm ci
npm run build                 # không đặt VITE_SERVER_URL cho cùng origin
NODE_ENV=production HOST=127.0.0.1 PORT=2567 npm start
```

- Node >=22.12; terminate TLS qua Caddy/Nginx. `deploy/Caddyfile` hỗ trợ tự động
  certificate HTTPS và WebSocket upgrade; operator đặt `CAMPUS_DOMAIN` là domain
  được phép sử dụng, cấu hình DNS và mở 80/443. Backend 2567 giữ loopback.
- Với Caddy đã cài: `CAMPUS_DOMAIN=campus.example.org caddy run --config deploy/Caddyfile`.
  Đây là lệnh triển khai do operator chạy sau khi được phép, không được chạy trong acceptance.
- `deploy/campus-together.service` là mẫu systemd: tạo service account `campus`,
  đặt runtime ở `/opt/campus-together`, kiểm lại `/usr/bin/node`, rồi operator mới
  cài/enable service. SIGTERM gửi thông báo kết thúc phiên và giải phóng room.
- Docker thay thế: `docker build -t campus-together:local .`, rồi
  `docker run --rm --name campus-together -p 127.0.0.1:2567:2567 campus-together:local`.
  Image chạy user `node`, healthcheck `/health`; đặt proxy HTTPS ở phía trước.
- Hosting client khác origin cần build với `VITE_SERVER_URL=https://<server-domain>`;
  HTTPS phải đi cùng WSS. Không đưa password/token/query vào biến này: bundle là công khai.
  Invalid URL hiển thị lỗi cấu hình rõ ràng, không tiếp tục tải vô hạn.
- Room code là lời mời/capability cho nhóm nhỏ, không phải tài khoản hay mật khẩu.
  Release chưa có account, moderation, persistence hoặc chống DDoS cấp dịch vụ;
  operator chịu trách nhiệm giới hạn truy cập/tải ở reverse proxy khi mở internet.
- Smoke sau triển khai: `/health` trả protocol 1, tạo phòng và tham gia từ context
  thứ hai, xác nhận WSS 101, ready/start/move, rồi thử reconnect. Không chỉ kiểm HTTP 200.
- Rollback: dùng archive trước, restart process, thông báo người chơi rằng room cũ
  không tồn tại sau restart. Không có database migration.

## Gói runtime

```sh
npm run package
# artifacts/campus-together-0.1.0.tar.gz + SHA-256
# Giải nén vào thư mục mới, rồi:
node tools/verify-runtime.mjs
npm ci --omit=dev
npm start
```

Gói gồm built server/shared/client, lockfile, assets/fonts, tài liệu và mẫu proxy/service.
`npm run package` và `node tools/package.mjs` đều build mới trong staging sạch từ
source +lockfile; không lấy dist/tsbuildinfo hiện tại, không ghi vào dist đang phục vụ.
Source build lỗi thì không thay gói tốt trước đó. Archive được giữ lâu dài theo
SHA trong `artifacts/sha256/<SHA>.tar.gz`; tên theo version chỉ là bản tiện dụng mới
nhất. `runtime-manifest.json` ghi hash source và cây runtime; verifier phát hiện
client/server bị tráo hoặc file thêm/bớt. Xem quy trình chuyển runtime chính xác ở
[`docs/delivery.md`](docs/delivery.md#chuyển-runtime-đồng-bộ-sau-packaging-fix).
Không cần Blender khi chạy; source Blender và generator được giữ trong checkout.
Archive không chứa node_modules, secrets hoặc evidence. `npm ci` cần registry/mirror
hoặc npm cache đã có dependency. Source checkout dùng `npm ci` đầy đủ để build/test.

Đây là **gói runtime**, khác full snapshot bàn giao. Full snapshot giữ cả node_modules,
dist, runtime đã giải nén, archive cũ, reports, từng render frame, `.blend1`, binary
cloudflared và operational config/log không bí mật. Inventory ghi mọi exclusion;
credential/profile/vault cần chính sách riêng, socket chỉ metadata, PID chỉ lịch sử.
Xem [quy trình capture/scan/pack/verify](SETUP.md#6-tạo-runtime-và-khôi-phục-snapshot).

## Kiểm tra bổ sung tái lập

```sh
npm run test:e2e:startup
npm run benchmark:server      # 1/5/10 phòng, 4 WS client/phòng, process riêng
CAMPUS_HARDWARE=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome \
  npx playwright test tests/e2e/acceptance.spec.ts
# Thêm CAMPUS_HEADED=1 để đo dưới desktop DISPLAY. Profile tạm riêng.
```

Benchmark tắt trace screencast để không mã hóa bốn màn hình 1080p trong phép đo;
JSON lưu renderer string, p50/p95, window và viewport. Không đổi driver/config hệ thống.
