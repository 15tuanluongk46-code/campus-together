# Campus Together — hợp đồng tích hợp art / Task 2

## Bộ bàn giao

- `apps/client/public/assets/manifest.json`: URL, biến thể, thời lượng clip, tốc độ
  locomotion gốc, tên socket, bounds glTF, triangle count, byte size và SHA-256.
- `student-0.glb` … `student-3.glb`: nhân vật sinh viên original, armature + skin.
- 14 GLB prop: `crate`, `cable`, `fuse`, `module-sun`, `module-leaf`, `module-wave`,
  `banner`, `lantern`, `bunting`, `tree-round`, `tree-slender`, `bench`, `flower-pot`, `station`.
- `assets/source/campus-assets.blend`: nguồn chỉnh sửa; actions riêng trong Action
  Editor, mesh có vertex groups và Armature modifier. Props đang ẩn để xem nhân vật.
- `assets/source/campus-glb-review.blend`: bản import lại để kiểm tra; không dùng làm
  nguồn xuất tiếp. Các object review có thể đang ẩn sau khi chụp từng prop.
- `assets/source/*.py`: bộ sinh asset tái lập được; không có source script tạm bị mất.
- `apps/client/public/assets/PROVENANCE.md`: nguồn gốc original, CC0-1.0.

## Tạo hình và vật liệu

Ngôn ngữ cream / terracotta / teal / marigold. Sinh viên có mặt dựng bằng profile
jaw–cheek–brow, tai, mũi, mắt/iris/highlight, chân mày và miệng; tóc cap + chỏm tóc
vuốt lệch. Áo varsity có cổ/bo tay/bo eo, túi viền, khóa kéo, đường vai. Quần denim
có cổ gấu; sneaker có đế, thân giày, dây, stripe và heel patch. Balô có quai, buckle,
túi ngoài, zip, tay xách. Huy hiệu số là mesh segment tự thiết kế, có ở ngực và balô.

| `variant` server | File | Tên gợi ý | Áo/chi tiết | Huy hiệu |
|---|---|---|---|---|
| 0 | `student-0.glb` | Gió | teal | 1 |
| 1 | `student-1.glb` | Nắng | terracotta | 2 |
| 2 | `student-2.glb` | Mầm | marigold | 3 |
| 3 | `student-3.glb` | Sóng | indigo | 4 |

Đây là bốn tint của cùng một thiết kế, không phải bốn mẫu tóc/cơ thể khác nhau.
Balô terracotta và nền huy hiệu marigold được giữ nguyên giữa các bản. PBR
metallic/roughness thuần, không texture ngoài, shader thủ tục, alpha hair card hay
extension nén bắt buộc. Chất liệu vải/da/tóc/đế có roughness khác nhau. Màu trong
`palette.py` là linear; không áp dụng thêm sRGB conversion lên giá trị shader.

## Tọa độ và rig

- glTF: **metre, +Y up, +Z forward**; tương thích `facing=atan2(x,z)` của shared.
- Root origin là midpoint bàn chân, y≈0. Rest height **1.663 m**.
- Bounds nghỉ x≈±0.3744 m; z≈[-0.3196,0.2140] m. Tay/áo có thể rộng hơn capsule
  .32 m; không suy collider từ bbox art.
- Bounds nhân vật là extrema của vertex **đã evaluate skin/armature sau khi import
  lại GLB vào Blender**, chuyển sang tọa độ glTF; không lấy raw accessor POSITION
  hoặc bbox rest của skinned mesh để suy bounds animation. Validator sample từng
  frame của 11 clip, từng variant; manifest ghi bounds đã evaluate.
- Root/đế giày và một số prop có embed sàn có chủ ý khoảng **8–11 mm**, để tránh
  khe sáng ở mặt tiếp xúc. Không dùng đáy bbox âm nhỏ này làm độ cao capsule;
  contract physics vẫn feet y=0. Kiểm tra animation theo ground tolerance của validator.
- Blender authoring: +Z up, -Y forward; exporter đã chuyển trục, **không xoay thêm
  -90° X trong client**, scale giữ 1.
- 18 bones: root + pelvis/chest/head + 6 bone mỗi bên + 2 carry frame. Hierarchy
  deform intentionally flat dưới `DEF-root`: motion.py giải pose trong armature
  space, không phụ thuộc constraint/driver runtime. Root motion không dịch chuyển.
- Tay/chân dùng skin blend hai bone qua elbow/knee; phụ kiện, mặt và thân có rigid
  weight để giữ tạo hình. Đây là articulated/skinned game rig, không rig facial
  đầy đủ; không blendshape lip sync/blink. Mọi vertex đều có normalized weights.
- Clone skeleton riêng cho mỗi người chơi; không dùng bản sao scene giữ chung bones.
  Chia sẻ geometry/material bất biến; clone material nếu cần highlight cá nhân.

## Animation contract

Tên phân biệt hoa/thường. Tất cả clip baked 30 FPS, giữ endpoint trùng cho loop;
preview video bỏ endpoint cuối trùng để không khựng khi phát nối vòng.

| Clip | Giây | Loop | Sử dụng |
|---|---:|---|---|
| `idle` | 2.4 | Có | Thở, chuyển trọng tâm nhỏ |
| `walk` | 0.8 | Có | Đi bộ, tay đối pha, gối và foot clearance |
| `run` | 0.5333 | Có | Chạy, thân nghiêng nhẹ, có pha bay |
| `pickup` | 1 | Không | Cúi gối/hông, đưa tay, đứng lên thành carry |
| `drop` | 0.9333 | Không | Carry → cúi đặt → trở về idle |
| `carryIdle` | 2.4 | Có | Ôm crate hai tay |
| `carryWalk` | 0.8667 | Có | Bước khi ôm crate, giữ grip |
| `interact` | 1.3333 | Có | Đưa hai tay tương tác station/panel |
| `celebrate` | 2 | Có | Giơ hai tay ăn mừng, thân chuyển nhẹ |
| `carrySmallIdle` | 2.4 | Có | Bổ sung: giữ vật nhỏ trước thân |
| `carrySmallWalk` | 0.8 | Có | Bổ sung: đi bộ với vật nhỏ |

Locomotion in-place có stance foot đi lùi theo tốc độ gốc để triệt trượt khi root
được client dịch chuyển. Tốc độ gốc: walk 1.5 m/s, run 3.1, carryWalk 1.3,
carrySmallWalk 1.5. **Client đặt timeScale = tốc độ horizontal thực / authoredSpeed**:

| Trường hợp contract | timeScale nominal |
|---|---:|
| walk 3.5 m/s | 2.3333 |
| run 5.5 m/s | 1.7742 |
| crate 3 m/s | 2.3077 |
| vật nhỏ 3.5 m/s | 2.3333 |

Dùng vận tốc render đã làm mượt khi bị tường cản, không chỉ desired velocity. Giữ
phase khi chuyển giữa các locomotion clip; crossfade khoảng 0.12–0.20s. idle cần
crossfade để hông không nhảy tức thì giữa idle và chân co của locomotion. Không
play đồng thời carry và arm-swing clip full weight. Small-item sprint vẫn được
server cho phép: tiếp tục small carry, tăng timeScale theo tốc độ; chất lượng
cadence ở 5.5 m/s cần Task 3/4 review, chưa có clip small-carry-run riêng.

One-shot pickup/drop đặt LoopOnce, clamp cuối rồi fade sang state mới. Quyết định
ownership đến từ snapshot/result thành công, không từ animation event. Không trì
hoãn giao thức server để chờ hết clip. Nếu cần biểu diễn pickup từ world position,
blend vị trí art từ snapshot world về socket sau khi đã xác nhận ownership; chỉ
có một mesh item. Động tác là gesture game chung, không IK tới vị trí item bất kỳ.

## Carry sockets và grip

| Item | Socket | Clip |
|---|---|---|
| crate | `carryLarge` | `carryIdle` / `carryWalk` |
| cable, fuse, module, banner, lantern | `carrySmall` | `carrySmallIdle` / `carrySmallWalk` |

Socket là node/Empty xuất ra có orientation hợp trục glTF. Lấy bằng đúng tên,
không lấy `DEF-carryLarge` thay thế. Reparent root scene của item vào socket, đặt
local position `(0,0,0)`, quaternion identity, scale `(1,1,1)`. World props đều có
bottom origin; crate được đặt khớp side lip, item không phải rigid body tự do.
Socket chuyển động chung với khung cổ tay; dependency prop-led, không vòng IK.

Crate rộng .572 m tính cả grip, thân cao .301 m. Hands cách nhau .556 m, wrap ở
hai mặt bên; validator đo cả translation và orientation tương đối của palm frame
qua toàn clip. Small pose có khoảng tay .17 m; dùng như cầm/đỡ vật ở trước người,
không phải finger IK riêng cho từng loại. Các vật rất nhỏ như fuse có thể cần
art-only socket offset nhỏ khi review camera thực; không sửa snapshot position.
Không gọi ổn định socket là bằng chứng rằng từng ngón tay đã chạm chính xác mọi prop.

## Props và bố trí thế giới

- Hai cây có root flare, nhánh và nhiều khối tán màu; dùng variation yaw/scale
  0.85–1.15 để tránh lặp. Đặt trong footprint planter hoặc ngoài đường đi đã định.
- Bench cao mặt ghế .4825 m; chỉ đặt ở vùng trang trí không chắn đường/doorway.
- Chậu hoa marigold: terracotta rim, đất, cuống và cánh hoa riêng.
- Crate: ván gỗ, đai màu, rivet, nắp, nhãn và grip lip.
- Cable: cuộn nhiều vòng, dây buộc, tail và chân cắm; fuse: casing/window/pins.
- Ba module có silhouette casing đồng nhất, icon sun/leaf/wave bằng geometry.
- Lantern có paper body tạo múi, rib, cap và loop; banner là cuộn buộc dây.
- `bunting.glb` có bbox string/pennant **1.6565–2.3085 m** so với origin mặt đất. Đây
  là span 3 m treo giữa các anchor do client tạo; bbox minY không bằng 0 là có chủ ý.
- `station.glb` là pedestal/button trang trí cao .908 m; orient mặt có indicator
  về người dùng. Props target nên nhỏ, không thêm collider tự ý.
- Architecture, roofs/cutaway, gate và stage surface do client tạo từ shared
  `COLLIDERS`/`BUILDINGS`. Không dùng kích thước của art làm nguồn collision mới.
  Stage không tạo bậc; giữ y=0 như contract.

## Hiệu năng

18 GLB tổng **4,139,720 bytes**. Bốn student 10,504 / 10,672 / 10,672 / 10,616
triangles, khoảng .734–.738 MB mỗi file. Props 400–5,524 triangles, cây 2,616.
Character gồm body và badge, 17 material primitives tổng; dự kiến tối đa 17 draw
calls/nhân vật trước shadow pass. Đây là số primitive từ asset, **không phải đo FPS**.
Không có LOD hoặc Draco. Cache GLB, dùng instancing theo material cho cây/props
lặp nếu profile runtime cần; quản lý lifetime để không dispose shared resources sớm.

## Tái tạo và xác minh

Từ root repo, thay đường dẫn Blender bằng bản 5.2.1 tương ứng:

```sh
BLENDER=/home/sss/Applications/blender-5.2.1-linux-x64/blender
"$BLENDER" --background --factory-startup --python-exit-code 1 --python assets/source/build.py
"$BLENDER" --background --factory-startup --python-exit-code 1 --python assets/source/validate.py
"$BLENDER" --background --factory-startup --python-exit-code 1 --python assets/source/evidence.py
python3 assets/source/contact_sheets.py
python3 assets/source/verify_delivery.py
```

Pillow + ffmpeg/ffprobe dùng cho contact sheet/video; build không cần tải package
hay tài nguyên internet. Background guard bảo vệ scene live. `validate.py` thực
sự import 18 GLB, sample toàn bộ 11 animation mỗi variant, kiểm bounds/weights,
finite accessors, PBR, sockets, clip names, loop seam, floor, virtual-ground stance
và grip frame. Manifest chỉ nhận bounds/hash sau khi PASS.

## Evidence và giới hạn

Trong `assets/source/evidence/`:

- `validation.json`, `delivery-check.json`: machine-readable PASS và số đo.
- `variants-glb.png`, `student-face.png`, `student-back.png`.
- `carry-grip-glb.png`, `small-grip-glb.png`, `motion-contact-sheet.jpg`.
- `props-contact-sheet.jpg`, `*-detail.png`, `props-glb.png`.
- 11 `<clip>.mp4` 30 FPS và full-frame PNG sequences; đã ffprobe đủ frame count.
- `.vision.txt`: nhận xét từ model vision cục bộ qua HTTP localhost, không subagent.

MCP đã xác nhận Campus scene 27 object và chụp screenshot, sau đó restore scene
gốc `VANTA-FORM01` 186 object, không save đè file người dùng. Chat model không
đọc được image attachment; sử dụng qwen2.5vl local đọc actual render thay thế.
Vision xác nhận dáng người/đồ mặc, grip crate và props đọc được; có nhận xét chưa
nhất quán về seam/quai và vật nhỏ hơi nổi. Không coi các câu nhận xét chung như
"thiếu realism" hoặc thiếu chân trong ảnh crop mặt là lỗi đã được chứng minh.

**Còn cần acceptance:** xem playback ở 1× với game speed, bàn tay/vật nhỏ ở camera
thật, transition và camera clipping, renderer lighting/shadows, FPS/draw calls.
Đã tạo/render toàn bộ animation nhưng chưa có human temporal/aesthetic acceptance.
