export const TAX_WEALTH_THRESHOLD = 300_000_000;
export const STANDARD_TAX_RATE = 0.10;
export const HIGH_WEALTH_TAX_RATE = 0.20;
export const TAX_INTERVAL_MS = 48 * 60 * 60 * 1000;

/**
 * Automatic collection is opt-in. A newly enabled scheduler waits one full
 * interval before its first collection rather than taxing everyone at once.
 */
export function nextTaxRunAt(config, now = Date.now()) {
  if (config?.enabled !== true) return null;

  const scheduled = Number(config.nextRunAt);
  if (Number.isFinite(scheduled) && scheduled > 0) return scheduled;

  const lastRun = Number(config.lastRun);
  if (Number.isFinite(lastRun) && lastRun > 0) {
    return lastRun + TAX_INTERVAL_MS;
  }

  return now + TAX_INTERVAL_MS;
}

export function taxRateForWealth(wealth, isLeaderboardTopTwo = false) {
  return isLeaderboardTopTwo || Number(wealth) >= TAX_WEALTH_THRESHOLD
    ? HIGH_WEALTH_TAX_RATE
    : STANDARD_TAX_RATE;
}

export function wealthTaxExpression(topTwoIds = []) {
  return {
    $cond: [
      {
        $or: [
          {
            $gte: [
              {
                $add: [
                  { $ifNull: ["$money", 0] },
                  { $ifNull: ["$bank", 0] },
                ],
              },
              TAX_WEALTH_THRESHOLD,
            ],
          },
          { $in: ["$_id", topTwoIds] },
        ],
      },
      HIGH_WEALTH_TAX_RATE,
      STANDARD_TAX_RATE,
    ],
  };
}
