export interface PlayerScore {
  playerId: string;
  nickname: string;
  points: number;
  /** Sum of server-measured answer times; lower is better as a tie-break. */
  totalAnswerMs: number;
}

export interface RankedPlayer extends PlayerScore {
  rank: number;
}

/**
 * Orders by points (desc), then total answer time (asc), then nickname and id for a
 * fully deterministic order. Players equal on points AND answer time share a rank
 * (standard competition ranking: 1, 2, 2, 4).
 */
export function rankPlayers(players: readonly PlayerScore[]): RankedPlayer[] {
  const sorted = [...players].sort(
    (a, b) =>
      b.points - a.points ||
      a.totalAnswerMs - b.totalAnswerMs ||
      compareText(a.nickname, b.nickname) ||
      compareText(a.playerId, b.playerId),
  );

  const ranked: RankedPlayer[] = [];
  let previous: RankedPlayer | undefined;
  sorted.forEach((player, index) => {
    const tied =
      previous !== undefined &&
      previous.points === player.points &&
      previous.totalAnswerMs === player.totalAnswerMs;
    const rank = tied && previous ? previous.rank : index + 1;
    const entry: RankedPlayer = { ...player, rank };
    ranked.push(entry);
    previous = entry;
  });
  return ranked;
}

/** Positive = moved up. Returns 0 when the player had no previous rank. */
export function rankMovement(previousRank: number | undefined, currentRank: number): number {
  return previousRank === undefined ? 0 : previousRank - currentRank;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
