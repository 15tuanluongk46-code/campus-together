import { distance, MOVEMENT, DROP_FIRST } from '@campus/shared';
import type { ErrorCode, IntentResult, Vec3 } from '@campus/shared';
import type { DomainContext, Player } from './model.js';

const messages: Record<ErrorCode, string> = {
  OK: 'Đã thực hiện.', INVALID: 'Yêu cầu không hợp lệ.', NOT_CONNECTED: 'Bạn chưa kết nối vào phòng.',
  RATE_LIMIT: 'Thao tác quá nhanh. Hãy thử lại.', REQUEST_CONFLICT: 'Mã yêu cầu đã dùng cho thao tác khác.',
  OLD_ROUND: 'Dữ liệu thuộc lượt chơi cũ. Hãy đồng bộ lại.', WRONG_PHASE: 'Chưa thể làm việc này trong giai đoạn hiện tại.',
  NOT_LEADER: 'Chỉ trưởng phòng có thể thực hiện.', NOT_READY: 'Chưa đủ người sẵn sàng. Kiểm tra trạng thái và chỗ đang giữ trong sảnh.', FULL: 'Phòng đã đủ người cho chế độ này.',
  UNKNOWN_ITEM: 'Không tìm thấy vật phẩm.', STALE_REVISION: 'Vật phẩm đã thay đổi. Hãy thử lại.', NOT_WORLD: 'Vật phẩm không còn ở đây.',
  HANDS_FULL: DROP_FIRST, NOT_HOLDER: 'Bạn không cầm vật phẩm này.', OUT_OF_REACH: 'Hãy đến gần hơn (1,6 m).',
  BLOCKED: 'Có vật cản ở giữa.', WRONG_TARGET: 'Vật phẩm không phù hợp vị trí này.', WRONG_ORDER: 'Chưa đúng thứ tự. Hãy xem gợi ý trong lớp học.',
  OCCUPIED: 'Vị trí này đã có vật phẩm.', UNSAFE_DROP: 'Chỗ đặt bị chắn. Hãy quay ra chỗ trống.',
};
export function result(roundId: number, requestId: string | null, code: ErrorCode): IntentResult {
  return { requestId, roundId, code, ok: code === 'OK', message: messages[code] };
}
export function reach(ctx: DomainContext, player: Player, position: Vec3): ErrorCode {
  if (distance(player.position, position) > MOVEMENT.reach) return 'OUT_OF_REACH';
  return ctx.world.hasLineOfSight(player.position, position) ? 'OK' : 'BLOCKED';
}
export function consume(player: Player, now: number, kind: 'intent' | 'input'): boolean {
  const elapsed = Math.max(0, now - player.tokensAt) / 1000;
  player.intentTokens = Math.min(24, player.intentTokens + elapsed * 12);
  player.inputTokens = Math.min(90, player.inputTokens + elapsed * 60);
  player.tokensAt = now;
  const key = kind === 'intent' ? 'intentTokens' : 'inputTokens';
  if (player[key] < 1) return false;
  player[key]--; return true;
}
