import { SignalSpec } from '../lib/scoring';
import { toneForScore, toneColor } from '../lib/format';

interface Props {
  signals: SignalSpec[];
}

export function SubScores({ signals }: Props) {
  return (
    <div className="subs">
      {signals.map((s) => {
        const tone = toneForScore(s.score);
        const color = toneColor(tone);
        const isAaii = s.key === 'aaii';
        const isBuffett = s.key === 'buffett';
        const cls = isAaii ? 'sub aaii-new' : isBuffett ? 'sub buffett-new' : 'sub';
        const nameCls = isAaii ? 'sub-name aaii-color' : isBuffett ? 'sub-name purple' : 'sub-name';
        const tagCls = isAaii ? 'new-tag aaii-color' : 'new-tag purple';
        return (
          <div key={s.key} className={cls}>
            {(isAaii || isBuffett) && <div className={tagCls}>NEW</div>}
            <div className={nameCls}>
              {isAaii && '★ '}
              {isBuffett && '★ '}
              {s.label}
            </div>
            <div className="sub-score" style={{ color }}>
              {Math.round(s.score)}
            </div>
            <div className="sub-raw">{s.raw}</div>
            <div className="sub-bar">
              <div className="sub-fill" style={{ width: `${s.score}%`, background: color }} />
            </div>
            <div className="sub-desc">{s.desc}</div>
          </div>
        );
      })}
    </div>
  );
}
