import type { ErrorCode, GameSnapshot } from './protocol.js';
import type { TargetDefinition } from './world.js';

export const DROP_FIRST = 'Nhấn G để đặt vật đang cầm xuống trước.';
export const STATION_A_FIRST = 'Giữ E ở trạm A đủ 3 giây trước, rồi đến trạm B.';
export const STATION_A_DONE = 'Trạm A đã hoàn thành. Đến trạm B và giữ E 3 giây.';
type Progress = Pick<GameSnapshot, 'mode' | 'phase' | 'stationAComplete'>;
/** Public eligibility only. Reach/LOS and hidden symbol order remain server-owned. */
export function interactionEligibility(s: Progress, held: boolean, target: TargetDefinition): { code: ErrorCode; status: 'actionable' | 'blocked' | 'completed'; message: string } {
  if (s.phase === 'lobby' || s.phase === 'results' || target.phase !== 'any' && target.phase !== s.phase)
    return { code: 'WRONG_PHASE', status: 'blocked', message: 'Chưa thể làm việc này trong giai đoạn hiện tại.' };
  if (held) return { code: 'HANDS_FULL', status: 'blocked', message: DROP_FIRST };
  if (s.mode === 'solo' && target.id === 'station-b' && !s.stationAComplete)
    return { code: 'WRONG_ORDER', status: 'blocked', message: STATION_A_FIRST };
  if (s.mode === 'solo' && target.id === 'station-a' && s.stationAComplete)
    return { code: 'OCCUPIED', status: 'completed', message: STATION_A_DONE };
  return { code: 'OK', status: 'actionable', message: target.label };
}
export function targetCompleted(s: GameSnapshot, target: TargetDefinition): boolean {
  return !!s.targets.find(t => t.id === target.id)?.itemId || s.mode === 'solo' && target.id === 'station-a' && s.stationAComplete;
}
