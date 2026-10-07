import { ROUND_MS, type RoomMode } from './protocol.js';

export const roomCapacity = (mode: RoomMode) => mode === 'solo' ? 1 : 4;
export const roundDuration = (mode: RoomMode) => mode === 'solo' ? 18 * 60_000 : ROUND_MS;
/** Includes reserved disconnected seats: UI and authority must agree on eligibility. */
export function startEligibility(mode: RoomMode, players: readonly { connected: boolean; ready: boolean }[]) {
  if (players.some(p => !p.connected)) return { allowed: false, reason: 'Đang giữ chỗ cho bạn mất kết nối. Chờ bạn nối lại hoặc hết thời gian giữ chỗ.' };
  if (players.length < (mode === 'solo' ? 1 : 2)) return { allowed: false, reason: 'Gửi lời mời cho ít nhất một người bạn để bắt đầu.' };
  if (!players.every(p => p.ready)) return { allowed: false, reason: 'Mỗi bạn bấm “Sẵn sàng”. Trưởng nhóm sẽ bắt đầu.' };
  return { allowed: true, reason: mode === 'solo' ? 'Sẵn sàng cho lễ hội của riêng bạn!' : 'Đã đủ những bàn tay. Vào sân thôi!' };
}
