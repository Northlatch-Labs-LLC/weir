// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
export function ago(nowMs: number, atMs: number): string {
  const s = Math.round((nowMs - atMs) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) {
    const n = Math.max(1, Math.round(s / 60));
    return `~${n} min ago`;
  }
  const d = new Date(atMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `read at ${hh}:${mm} UTC`;
}

export function posted(nowMs: number, atMs: number): string {
  const s = Math.round((nowMs - atMs) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d`;

  const d = new Date(atMs);
  const day = d.getUTCDate();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const sameYear = d.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return sameYear ? `${day} ${month}` : `${day} ${month} ${d.getUTCFullYear()}`;
}
