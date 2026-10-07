# Runtime, ownership và provenance

## Play-flow Task 1 — 2026-10-06 (chưa activation)

Candidate sau independent-review fixes được ghi trong
`.superpowers/sdd/play-flow/fix-report.md`; dùng SHA ở report đó thay candidate
Task1 ban đầu. Vẫn chưa activation2567. Giới hạn GPU/visual trước đó giữ nguyên.

Entry/activation/context/guidance/replay/leave đã cập nhật frontend + backend +
shared. Archive vẫn build từ source staging sạch; không dùng checkout dist.
`runtime-browser-smoke.mjs` dùng Esc thật, kiểm hủy rồi xác nhận rời lượt.
`package-smoke.ts` dùng cổng OS cấp riêng. Xem
`.superpowers/sdd/play-flow/implementation-report.md` để lấy hash/evidence/giới hạn.
Runtime2567 giữ release cũ; controller review/activate theo Task2/3.

## Solo extension — 2026-10-05

Chế độ server bất biến: Solo một chỗ/18 phút hoặc co-op bốn chỗ/12 phút.
Solo có cổng giữ1s/mở15s, trạm A rồi B mỗi trạm3s, gợi ý riêng khôi phục qua
reconnect, cả hai việc phụ và replay. `docs/contracts.md` và `docs/controls.md`
đã cập nhật. Báo cáo thực thi mới: `.superpowers/sdd/solo/implementation-report.md`.
Toàn bộ asset và provenance giữ nguyên; các globe cùng thông số chia sẻ material/
geometry, không thay màu hay emissive. Test shader/resource và browser được chạy lại.

Build server/shared/client phải được triển khai cùng nhau. Quá trình Solo dùng cổng
test riêng; process người dùng đang chạy tại2567 không được dừng/restart. Archive
mới được smoke trong thư mục giải nén riêng; operator chọn lúc chuyển runtime.
Public admission cap và security headers nằm ngoài patch đã duyệt.

## Chuyển runtime đồng bộ sau packaging fix

`npm run package` gọi trực tiếp `tools/package.mjs`: copy source/lock/config theo
allowlist vào staging mới, `npm ci --ignore-scripts`, build cả shared/server/client,
kiểm manifest rồi mới xuất archive. Không dùng hoặc ghi checkout dist; kể cả khi
checkout client đang được restore về bản cũ vẫn tạo đúng cặp mới. Gói là same-origin;
`VITE_SERVER_URL` trong shell bị loại khỏi build staging. Build lỗi giữ nguyên
archive tốt trước đó. SHA-addressed archive không ghi đè; convenience version path
chỉ trỏ bằng nội dung tới lần build thành công gần nhất.

**Controller thực hiện sau khi cho phép activation; không chạy restart trong đợt fix:**

1. Tại source checkout: `npm run package`. Lấy SHA từ output và chọn chính xác
   `artifacts/sha256/<SHA>.tar.gz` (không dùng tên mutable cho lịch sử/rollback).
2. Kiểm từ thư mục `artifacts/sha256`: `sha256sum -c <SHA>.tar.gz.sha256`.
3. Tạo thư mục release mới, ví dụ `<project>/releases/<SHA>`; giải nén bằng
   `tar -xzf <absolute-archive-path> -C <absolute-release-directory>`.
4. Trong release mới: `node tools/verify-runtime.mjs`, rồi `npm ci --omit=dev`.
   Không copy/merge dist sang checkout cũ. `runtime-manifest.json` kiểm toàn cây
   runtime trước cài; verifier bỏ qua `node_modules` khi dùng sau cài.
5. Smoke bản archive đã chọn từ source checkout:
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome npx tsx tools/package-smoke.ts <absolute-archive-path>`.
   Script tự giải nén mới, xác minh SHA/tree, cài dependency, dùng port OS cấp,
   kiểm co-op+Solo socket và browserSolo, rồi chỉ tắt process do nó tạo.
6. Khi controller phê duyệt cutover: xác minh PID/cwd/listener2567 cũ, dừng đúng
   process đó qua cơ chế quản lý đang dùng, đợi port rảnh. Đổi working directory
   của launch sang **release mới**, chạy `HOST=127.0.0.1 PORT=2567 npm start` ở đó.
   Không chạy trực tiếp từ checkout mixed-dist; không restore client cũ vào release.
7. Kiểm `/health` (liveness) và browserSolo/co-op tạo/join/start/reconnect. Các room
   cũ không tồn tại sau restart. Rollback dùng một **release nguyên cặp** đã giữ theo
   SHA và smoke; bản pre-Solo đầy đủ ban đầu không còn archive, không coi backup
   client-only là một release rollback hợp lệ.

Preservation provenance: `pre-solo-runtime/source.json` gọi đường dẫn và SHA cũ là
**historical**; original archive đã bị ghi đè ở đợt trước. Hash cây file được seal
cho surviving extraction, không giả vờ tái xác minh với archive đã mất. `verify`
phát hiện cây bị sửa; không tự reseal. `restore --server-stopped` kiểm trước,
copy vào staging sạch rồi thay cả cây (không merge), từ chối khi2567 còn nghe.
Không cần restore trong workflow packaging mới. Không chạy clean restore trên
process đang phục vụ; các asset dư từ lần restore cũ giữ nguyên đến cutover.

## Luồng và lifetime

Browser UI/input → Session/Colyseus → CampusRoom → Game domain → shared Rapier.
Server nhận input/intent, giữ authority về collision, timers, ownership và mission.
Snapshot 15 Hz; simulation 30 Hz. Client prediction có correction, remote interpolation.
`docs/contracts.md` mô tả giao thức v1. Không có endpoint teleport/force-complete.

Mỗi room sở hữu một WASM collision world, được dispose khi room đóng. Mỗi trang
sở hữu renderer/assets/audio; actor clone sở hữu mixer và skeleton texture, nhưng
chia sẻ geometry/material bất biến. Rời phòng giữ cache static có giới hạn; pagehide
dispose toàn bộ. Reconnect giữ private token trong memory, không có trong link mời.
Scene teardown có guard idempotent; highlight thuộc scene traversal (geometry và
material được dispose đúng một lần). InstancedMesh tự giải phóng instance attributes;
sun shadow target được dispose riêng. Sau renderer.dispose, forceContextLoss đóng
lifetime của các tài nguyên nội bộ còn lại. Test phân biệt explicit delete và
context loss, không coi việc xóa scene node là giải phóng GPU.

Khi đứt mạng, action chưa có ACK được hủy ở client; sau snapshot đồng bộ có thông
báo kiểm tra trạng thái hiện tại rồi thao tác lại nếu cần. Không tự phát lại hold,
movement hoặc hành động cũ. Ping cũ trong snapshot đầu/reconnect không phát âm lại.
Server vẫn trả cache miễn phí cho retry cùng ID/payload/current round; malformed,
stale round và payload-conflict đều tiêu budget và không đổi authority.

## Ma trận nguồn gốc

| Thành phần | Nguồn / giấy phép | Bằng chứng |
|---|---|---|
| 18 GLB / 4 variants / 11 clips | Original procedural Blender; CC0-1.0 | `apps/client/public/assets/PROVENANCE.md`, `manifest.json`, `assets/source/` |
| Kiến trúc, dấu hiệu, campus art | Original TypeScript geometry/palette | `apps/client/src/world-art.ts`, shared world; không dùng map bên ngoài |
| Nhạc và SFX | Original WebAudio synthesis; CC0-1.0 | `apps/client/public/assets/AUDIO-PROVENANCE.md`, `apps/client/src/audio.ts` |
| Baloo 2 / Be Vietnam Pro | Bundled Fontsource fonts; SIL Open Font License | `apps/client/public/assets/FONT-LICENSES.txt` |
| Three.js, Colyseus, Rapier, Zod, Express… | Third-party packages, licenses trong từng package | `package-lock.json` pin dependency; `npm ci` giữ LICENSE của packages |

Không có audio sample, texture ảnh, mocap hay character bên ngoài. Public-domain
dedication của art/audio không thay đổi giấy phép dependency. Application code
chưa được chủ dự án cấp một public redistribution license riêng; không tự suy
CC0 của asset thành giấy phép toàn bộ application.

## Các artifact

- `npm run build`: `packages/shared/dist`, `apps/server/dist`, `apps/client/dist`.
- `npm run package`: runtime tar.gz deterministic metadata + SHA-256 trong `artifacts/`.
- `Dockerfile`, `deploy/Caddyfile`, `deploy/campus-together.service`: operator templates,
  không được tự cài hoặc public trong quá trình build/acceptance.
- `docs/verification.md`: kết quả thực đo và giới hạn.
- `.superpowers/sdd/campus/task-4-report.md`: handoff để independent review.
- `.superpowers/sdd/campus/final-fix-report.md`: các ruling, RED/GREEN, full72tests,
  headless20E2E + affected4test rerun (21test hiện hành), production/startup và
  bằng chứng shader/resource cuối. `final-fix-browser-report/index.html` là báo cáo.
- `artifacts/package-smoke.json`: kết quả chạy từ archive giải nén mới; checksum
  cạnh tar.gz. Archive gồm tài liệu mới nhưng không mang development evidence.

## Trạng thái acceptance trước Solo (lịch sử)

Chức năng được kiểm tra tự động; **stable1080p60 và nghiệm thu nghe âm thanh,
chuyển động/camera, mức độ vui bởi con người còn chưa hoàn thành**. Diagnostic
headed cuối28,98FPS, desktop đổi unlocked→locked, GPU56–83%; không sửa hệ thống
hay dừng ứng dụng GPU của người dùng để lấy số đẹp. Bốn context dùng chung GPU
không tương đương bốn máy vật lý. Xem `docs/verification.md` để phân biệt hiện tại
và số liệu lịch sử.
