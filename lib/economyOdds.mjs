export const ECONOMY_WIN_RATE_WEALTH_THRESHOLD = 200_000_000;
// This is a percentage-point deduction: e.g. 55% becomes 46%.
export const ECONOMY_WIN_RATE_PENALTY = 0.09;

export function economyWinRate(baseRate, user = {}) {
  const boundedRate = Math.max(0, Math.min(1, Number(baseRate) || 0));
  const walletAndBank = (Number(user.money ?? user.wallet ?? user.balance) || 0) +
    (Number(user.bank) || 0);
  const totalWealth = walletAndBank || Number(user.totalWealth) || 0;

  return totalWealth >= ECONOMY_WIN_RATE_WEALTH_THRESHOLD
    ? Math.max(0, boundedRate - ECONOMY_WIN_RATE_PENALTY)
    : boundedRate;
}
