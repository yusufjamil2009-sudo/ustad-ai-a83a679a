/**
 * Academic-session engine. Derives the CURRENT session from the real date and the
 * board's session-start month (NCERT and UPMSP both start the academic year on
 * 1 April). This is deterministic — it never invents a session; it calculates the
 * live one from the calendar so the system never serves an old book as if it were
 * current.
 */
import type { BoardId, BoardInfo, SessionInfo } from "./types";

export const BOARD_INFO: Record<BoardId, BoardInfo> = {
  ncert: { boardId: "ncert", name: "NCERT", sessionStartMonth: 4, aliases: [] },
  upmsp: { boardId: "upmsp", name: "UP Board", sessionStartMonth: 4, aliases: [] },
};

const pad = (n: number) => String(n % 100).padStart(2, "0");

/** The academic session that contains `date` for a board. e.g. Oct 2026 -> 2026-27. */
export function currentSession(board: BoardId, date: Date = new Date()): SessionInfo {
  const startMonth = BOARD_INFO[board]?.sessionStartMonth ?? 4;
  const y = date.getFullYear();
  // If we are before the board's session-start month, we are in the session that
  // started LAST year. Otherwise the session started this year.
  const startYear = date.getMonth() + 1 >= startMonth ? y : y - 1;
  const endYear = startYear + 1;
  return {
    sessionId: `${board}:${startYear}-${pad(endYear)}`,
    boardId: board,
    startYear,
    endYear,
    label: `${startYear}-${pad(endYear)}`,
  };
}

/** Validate a user-supplied session label like "2026-27" against the current one. */
export function sessionFromLabel(label: string, board: BoardId): SessionInfo | null {
  const m = label.match(/^(20\d{2})\s*[-–/]\s*(\d{2})$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  const endYear = startYear + 1;
  return {
    sessionId: `${board}:${startYear}-${pad(endYear)}`,
    boardId: board,
    startYear,
    endYear,
    label: `${startYear}-${pad(endYear)}`,
  };
}

/** true if the given session is the currently running one for the board. */
export function isCurrent(session: SessionInfo, board: BoardId, date: Date = new Date()): boolean {
  return session.label === currentSession(board, date).label;
}
