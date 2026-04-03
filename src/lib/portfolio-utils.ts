export interface PortfolioDataPoint {
  date: string;
  timestamp: number;
  value: number;
  rewards: number;
  principal: number;
}

export function generateMockPortfolioHistory(
  currentValue: number,
  currentRewards: number,
  days: number = 90
): PortfolioDataPoint[] {
  const data: PortfolioDataPoint[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const principal = currentValue - currentRewards;
  const dailyRewardRate = currentRewards / days;

  for (let i = days; i >= 0; i--) {
    const timestamp = now - i * dayMs;
    const date = new Date(timestamp);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

    const daysElapsed = days - i;
    const variance = 1 + (Math.random() - 0.5) * 0.1;
    const rewards = dailyRewardRate * daysElapsed * variance;
    const value = principal + rewards;

    data.push({ date: dateStr, timestamp, value, rewards, principal });
  }

  return data;
}
