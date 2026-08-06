/**
 * Generate and download an .ics calendar event for a thawing completion.
 */

function toICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}@lodestar`;
}

export function downloadThawingReminder(opts: {
  lockedUntil: number;   // Unix timestamp (seconds)
  amountGRT: number;
  indexerName: string;
}) {
  const { lockedUntil, amountGRT, indexerName } = opts;
  const completionDate = new Date(lockedUntil * 1000);
  const endDate = new Date(completionDate.getTime() + 3600_000); // 1h window
  const now = new Date();

  const amtStr = amountGRT.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lodestar Dashboard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(completionDate)}`,
    `DTEND:${toICSDate(endDate)}`,
    `SUMMARY:GRT Thawing Complete: Withdraw ${amtStr} GRT`,
    `DESCRIPTION:Your undelegation of ${amtStr} GRT from ${indexerName} is ready to withdraw on Lodestar Dashboard (lodestar-dashboard.com/profile).`,
    // Reminder 24h before
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:GRT thawing from ${indexerName} completes tomorrow`,
    'END:VALARM',
    // Reminder at completion
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${amtStr} GRT ready to withdraw from ${indexerName}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grt-thaw-${indexerName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
