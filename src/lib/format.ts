/** Map a 0-100 score to a tone class for coloring */
export type Tone = 'bear' | 'warn' | 'neut' | 'bull';

export function toneForScore(score: number): Tone {
  if (score < 30) return 'bear';
  if (score < 50) return 'warn';
  if (score < 65) return 'neut';
  return 'bull';
}

export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'bear': return 'var(--bear)';
    case 'warn': return 'var(--warn)';
    case 'bull': return 'var(--bull)';
    default:     return 'var(--text2)';
  }
}

export function regimeLabel(score: number): string {
  if (score < 30) return 'EXTREME CAUTION';
  if (score < 40) return 'CAUTION';
  if (score < 50) return 'BELOW AVERAGE';
  if (score < 60) return 'ABOVE AVERAGE';
  if (score < 70) return 'GOOD';
  return 'STRONG';
}

export function fmtPct(n: number, signed = true): string {
  const s = n.toFixed(2);
  return signed && n >= 0 ? `+${s}%` : `${s}%`;
}
