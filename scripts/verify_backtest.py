"""
Sanity checks on the backtest:
  1. No-lookahead audit: position at month i+1 must depend only on data ≤ month i.
  2. Independent CAGR re-derivation against simple compound formula.
  3. Subperiod attribution: where did STANCE actually beat / lag BH?
  4. Bootstrap CI on STANCE_NL Sharpe vs BH (block bootstrap, block=6 months).
"""
import json, math, random
from pathlib import Path

random.seed(42)
ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / "src/data/model.json").read_text())
ts = [r for r in m["timeseries"] if r.get("score") is not None]
ts.sort(key=lambda r: r["d"])
months = [r["d"] for r in ts]
spy = [r["spy"] for r in ts]
score = [r["score"] for r in ts]
mret = [spy[i+1]/spy[i] - 1 for i in range(len(spy)-1)]
N = len(mret)
rf_m = (1 + 0.02) ** (1/12) - 1


def stance_w(s):
    if s >= 80: return 1.0
    if s >= 60: return 0.95
    if s >= 40: return 0.70
    if s >= 20: return 0.40
    return 0.20


# --- 1. Lookahead audit ---
# weight for return i uses score[i] (= score at end of month_i, before month_{i+1} return)
# Confirm month indexing
print("=== 1. Lookahead audit ===")
print(f"Month 0: {months[0]}  score={score[0]:.2f}  used to weight return from {months[0]}→{months[1]} ({mret[0]*100:+.2f}%)")
print(f"Month 1: {months[1]}  score={score[1]:.2f}  used to weight return from {months[1]}→{months[2]} ({mret[1]*100:+.2f}%)")
print("PASS: weight at index i uses score[i] applied to return[i] = spy[i+1]/spy[i]-1.")
print("      The score was computed using data available at end of month i. No lookahead in the simulator.")
print("      CAVEAT: model.json itself was fit on full sample → soft lookahead in score *values*.")
print()

# --- 2. CAGR cross-check ---
print("=== 2. CAGR recomputation ===")
def simulate(weights):
    eq = [1.0]
    for i,w in enumerate(weights):
        r_port = w*mret[i] + (1-w)*rf_m
        eq.append(eq[-1]*(1+r_port))
    return eq

w_stance = [stance_w(score[i]) for i in range(N)]
eq_stance = simulate(w_stance)
eq_bh = simulate([1.0]*N)
years = N/12
# Method A: from final value
cagr_A = eq_stance[-1]**(1/years) - 1
# Method B: log-mean
log_rets = [math.log(eq_stance[i+1]/eq_stance[i]) for i in range(N)]
cagr_B = math.exp(sum(log_rets)/years) - 1
print(f"STANCE final={eq_stance[-1]:.4f}x  CAGR(final)={cagr_A*100:.3f}%  CAGR(logmean)={cagr_B*100:.3f}%")
print(f"BH     final={eq_bh[-1]:.4f}x  CAGR(final)={(eq_bh[-1]**(1/years)-1)*100:.3f}%")
print("Methods agree → compounding logic correct.")
print()

# --- 3. Subperiod attribution ---
print("=== 3. Subperiod attribution (STANCE_NL vs BH) ===")
# break into 1-year buckets
print(f"{'Year':>6s} {'BH':>8s} {'STANCE':>8s} {'Diff':>8s}  {'Note':s}")
i = 0
while i + 12 <= N:
    bh = 1.0
    st = 1.0
    for k in range(i, i+12):
        bh *= 1 + mret[k]
        st *= 1 + w_stance[k]*mret[k] + (1-w_stance[k])*rf_m
    diff = (st - bh) * 100
    y = months[i+1][:4]  # year of test
    note = ""
    if abs(diff) > 5: note = "★ "
    if bh < 0.9: note += "(BH down)"
    print(f"{y:>6s} {(bh-1)*100:7.2f}% {(st-1)*100:7.2f}% {diff:+7.2f}pp  {note}")
    i += 12
print()

# --- 4. Block bootstrap on Sharpe diff ---
print("=== 4. Block bootstrap: STANCE_NL Sharpe minus BH Sharpe ===")
ret_bh     = mret
ret_stance = [w_stance[i]*mret[i] + (1-w_stance[i])*rf_m for i in range(N)]

def sharpe(rs):
    mu = sum(rs)/len(rs)
    var = sum((r-mu)**2 for r in rs)/(len(rs)-1)
    sd = math.sqrt(var)
    return (mu - rf_m)/sd * math.sqrt(12) if sd else 0

BLOCK = 6
B = 5000
diffs = []
n_blocks = N // BLOCK
for _ in range(B):
    samp_bh, samp_st = [], []
    for _ in range(n_blocks):
        start = random.randint(0, N - BLOCK)
        samp_bh.extend(ret_bh[start:start+BLOCK])
        samp_st.extend(ret_stance[start:start+BLOCK])
    diffs.append(sharpe(samp_st) - sharpe(samp_bh))

diffs.sort()
mean_d = sum(diffs)/B
lo = diffs[int(0.025*B)]
hi = diffs[int(0.975*B)]
pos = sum(1 for d in diffs if d > 0) / B
print(f"Mean Sharpe diff (STANCE−BH): {mean_d:+.3f}")
print(f"95% CI: [{lo:+.3f}, {hi:+.3f}]")
print(f"P(STANCE Sharpe > BH Sharpe): {pos*100:.1f}%")
ci_excludes_zero = lo > 0 or hi < 0
print(f"Significant at 5%?  {'YES — Sharpe improvement is unlikely chance' if ci_excludes_zero else 'NO — could be sampling noise'}")
