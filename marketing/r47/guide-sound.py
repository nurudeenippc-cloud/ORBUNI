# Orbuni guide soundtrack: synthesised music bed + sound effects, timed to the
# recorder's marks/events, with the narrator ducking the music.
#   python3 sound.py student|partner out.wav [voice_aligned.wav]
import json, sys, numpy as np, soundfile as sf
from scipy import signal

SR = 48000
which, out = sys.argv[1], sys.argv[2]
voice_path = sys.argv[3] if len(sys.argv) > 3 else None
M = json.load(open(f'vid/{which}_marks.json'))
mk, ev = M['marks'], M.get('events', [])
s0 = mk['start'] / 1000.0
T = lambda ms: ms / 1000.0 - s0                       # recorder ms -> seconds on the final timeline
L = (mk['end'] - mk['start']) / 1000.0 + 0.5
N = int(L * SR)
rng = np.random.default_rng(7)
t_title, t_outro = T(mk['titleEnd']), T(mk['outro'])
chs = [T(c) for c in mk['ch']]
voiced = voice_path is not None

def env_adsr(n, a, r):
    e = np.ones(n); A = max(1, int(a * SR)); R = max(1, int(r * SR))
    e[:A] = np.linspace(0, 1, A); e[-R:] *= np.linspace(1, 0, R); return e
def lp(x, fc, order=2): b, a = signal.butter(order, min(fc, SR / 2 - 100) / (SR / 2), 'low'); return signal.lfilter(b, a, x)
def hp(x, fc, order=2): b, a = signal.butter(order, fc / (SR / 2), 'high'); return signal.lfilter(b, a, x)
def bp(x, lo, hi): b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); return signal.lfilter(b, a, x)
def place(buf, x, t, pan=0.0, g=1.0):
    i = int(t * SR)
    if i >= len(buf) or i + len(x) <= 0: return
    if i < 0: x = x[-i:]; i = 0
    x = x[: len(buf) - i] * g
    buf[i:i + len(x), 0] += x * np.sqrt(0.5 * (1 - pan)); buf[i:i + len(x), 1] += x * np.sqrt(0.5 * (1 + pan))
def reverb(x, sec=2.6, mix=0.3):
    n = int(sec * SR); ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n)); ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir ** 2))
    out = np.zeros_like(x)
    for c in range(2): out[:, c] = (1 - mix) * x[:, c] + mix * signal.fftconvolve(x[:, c], ir[::-1] if c else ir)[: len(x)]
    return out
NOTE = lambda n: 440.0 * 2 ** ((n - 69) / 12)        # MIDI -> Hz

# ------------------------------------------------------------------ music
bpm = 92.0; beat = 60 / bpm; bar = 4 * beat
prog = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]     # Am  F  C  G
music = np.zeros((N, 2))
tt = np.arange(N) / SR
# intensity curve: low on the title, builds through the chapters, drops for the outro
inten = np.interp(tt, [0, t_title, chs[len(chs) // 2] if chs else t_title, t_outro - 0.4, t_outro, L], [0.35, 0.55, 0.85, 1.0, 0.5, 0.0])
# pad: detuned saw-like voices, filter opens with intensity
pad = np.zeros(N)
nb = int(np.ceil(L / (2 * bar))) + 1
for k in range(nb):
    t_a = k * 2 * bar; seg_n = int((2 * bar + 1.2) * SR); st = int(t_a * SR)
    if st >= N: break
    chord = prog[k % 4] if t_a < t_outro else [53, 57, 60, 64, 72]                   # outro: warm Fmaj7 lift
    ts = np.arange(seg_n) / SR; v = np.zeros(seg_n)
    for n in chord:
        for det in (-0.12, 0.0, 0.11):
            f = NOTE(n - 12) * 2 ** (det / 12)
            for h in range(1, 7): v += np.sin(2 * np.pi * f * h * ts + rng.random() * 6.28) / (h * 1.6)
    v *= env_adsr(seg_n, 0.9, 1.3); e = min(N, st + seg_n); pad[st:e] += v[: e - st]
cut = 500 + 2200 * inten
pad_f = np.zeros(N); blk = 4800
for i in range(0, N, blk):                            # time-varying low-pass in blocks
    b, a = signal.butter(2, cut[i] / (SR / 2), 'low'); seg = signal.lfilter(b, a, pad[max(0, i - 2000):i + blk])
    pad_f[i:i + blk] = seg[-len(pad_f[i:i + blk]):]
pad_f *= 0.018 * (0.6 + 0.4 * inten)
music[:, 0] += pad_f * (1 + 0.15 * np.sin(2 * np.pi * 0.07 * tt)); music[:, 1] += pad_f * (1 - 0.15 * np.sin(2 * np.pi * 0.07 * tt))
# tension pulse: plucked bass eighths on the chord root, from the first chapter
start_pulse = chs[0] - 0.05 if chs else t_title
step = beat / 2; t = start_pulse
while t < t_outro - 0.2:
    k = int(t // (2 * bar)); root = prog[k % 4][0] - 24; n = int(0.32 * SR)
    ts = np.arange(n) / SR; x = (np.sin(2 * np.pi * NOTE(root) * ts) + 0.4 * np.sin(2 * np.pi * NOTE(root) * 2 * ts)) * np.exp(-ts * 9)
    acc = 1.0 if int(round((t - start_pulse) / step)) % 2 == 0 else 0.6
    place(music, lp(x, 900), t, 0, 0.11 * acc * np.interp(t, tt, inten)); t += step
# heartbeat kick on beats 1 and 3, from the second chapter
t = chs[1] if len(chs) > 1 else start_pulse
while t < t_outro - 0.3:
    n = int(0.45 * SR); ts = np.arange(n) / SR; f = 48 + 70 * np.exp(-ts * 30)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-ts * 7)
    place(music, x, t, 0, 0.16 * np.interp(t, tt, inten)); t += 2 * beat
# ticking hats on the off-beats in the second half: the "clock" under the tension
t = chs[len(chs) // 2] + beat / 2 if chs else L
while t < t_outro - 0.3:
    n = int(0.05 * SR); x = hp(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR * 90)
    place(music, x, t, 0.35 if int(t / beat) % 2 else -0.35, 0.03); t += beat
# high tremolo string: sustained A5 that swells into each chapter's middle
for c0, c1 in zip(chs, chs[1:] + [t_outro]):
    n = int((c1 - c0) * SR); ts = np.arange(n) / SR
    x = np.sin(2 * np.pi * NOTE(81) * ts + 0.004 * np.sin(2 * np.pi * 5.5 * ts) * 80) * (0.6 + 0.4 * np.sin(2 * np.pi * 6 * ts))
    place(music, lp(x, 3000) * np.sin(np.pi * ts / max(ts[-1], 0.1)) ** 2, c0, 0, 0.006)
# soft piano arpeggio over the chords: the "guide" melody, a touch brighter as it builds
pat = [0, 2, 1, 3, 2, 1, 3, 2]
t = start_pulse; j = 0
while t < t_outro - 0.2:
    k = int(t // (2 * bar)); chord = prog[k % 4]; n_ = chord[pat[j % 8] % len(chord)] + 12
    n = int(1.1 * SR); ts = np.arange(n) / SR; f = NOTE(n_)
    x = sum(np.sin(2 * np.pi * f * h * ts) * np.exp(-ts * (3 + 2.2 * h)) / h for h in range(1, 6)) * (1 - np.exp(-ts * 400))
    lvl = (0.030 if not voiced else 0.016) * (0.55 + 0.45 * np.interp(t, tt, inten))
    place(music, lp(x, 4200), t, -0.3 + 0.6 * ((j % 4) / 3), lvl); t += beat / 2; j += 1
# outro: a bright resolving chime
for i, n_ in enumerate([72, 76, 79, 84]):
    n = int(2.5 * SR); ts = np.arange(n) / SR; f = NOTE(n_)
    x = sum(np.sin(2 * np.pi * f * h * ts) * np.exp(-ts * (1.2 + h)) / h for h in (1, 2, 3)) * (1 - np.exp(-ts * 300))
    place(music, x, t_outro + 0.25 + i * 0.16, -0.4 + 0.27 * i, 0.05)
music = reverb(music, 1.1, 0.10)   # short, light room only: a long tail under the narrator reads as echo

# ------------------------------------------------------------------ sound effects
fx = np.zeros((N, 2))
def whoosh(dur=0.7, lo=250, hi=4200):
    n = int(dur * SR); x = rng.standard_normal(n); out = np.zeros(n); blk = 480
    for i in range(0, n, blk):
        p = i / n; f0 = lo * (hi / lo) ** p
        out[i:i + blk] = bp(x[max(0, i - 960):i + blk], f0, min(f0 * 1.8, SR / 2 - 200))[-len(out[i:i + blk]):]
    return out * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.6
def riser(dur):
    n = int(dur * SR); ts = np.arange(n) / SR
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(110, 880, n)) / SR) * 0.4 + whoosh(dur, 200, 6000) * 0.8
    return sweep * np.linspace(0, 1, n) ** 2.2
def impact():
    n = int(2.2 * SR); ts = np.arange(n) / SR; f = 38 + 60 * np.exp(-ts * 18)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-ts * 2.2)
    crack = lp(rng.standard_normal(n), 2500) * np.exp(-ts * 14) * 0.5
    return boom + crack
def click():
    n = int(0.05 * SR); ts = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2300 * ts) * np.exp(-ts * 160) + hp(rng.standard_normal(n), 3000) * np.exp(-ts * 400) * 0.6)
def shimmer():
    n = int(0.9 * SR); ts = np.arange(n) / SR; x = np.zeros(n)
    for f, g in ((1760, 1), (2637, 0.6), (3520, 0.35)): x += g * np.sin(2 * np.pi * f * ts)
    return x * (1 - np.exp(-ts * 60)) * np.exp(-ts * 4.5)
def fan():
    n = int(0.6 * SR); ts = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(np.linspace(500, 1600, n)) / SR) * np.exp(-ts * 4) * (1 - np.exp(-ts * 50)) + shimmer()[:n] * 0.5
def key():
    n = int(0.03 * SR); ts = np.arange(n) / SR
    return bp(rng.standard_normal(n), 1500, 5000) * np.exp(-ts * 250)

if t_title > 1.0: place(fx, riser(min(2.4, t_title - 0.3)), t_title - min(2.4, t_title - 0.3), 0, 0.10 if voiced else 0.16)
place(fx, impact(), t_title, 0, 0.30 if voiced else 0.42)
for i, c in enumerate(chs[1:]): place(fx, whoosh(), c - 0.32, -0.6 + 1.2 * (i % 2), 0.10 if voiced else 0.16)
place(fx, whoosh(1.1, 150, 3000), t_outro - 0.5, 0, 0.12 if voiced else 0.18)
place(fx, impact() * 0.6, t_outro + 0.15, 0, 0.18 if voiced else 0.26)
for kind, ms in ev:
    t = T(ms)
    if kind == 'click': place(fx, click(), t + 0.05, 0.2, 0.09)
    elif kind == 'ring': place(fx, shimmer(), t + 0.15, -0.2, 0.020 if voiced else 0.028)
    elif kind == 'fan': place(fx, fan(), t + 0.05, 0.4, 0.06)
    elif kind == 'key': place(fx, key(), t + rng.random() * 0.03, 0.1, 0.035)
fx = reverb(fx, 0.7, 0.06)

# ------------------------------------------------------------------ mix
mix = music + fx
if voiced:
    v, vsr = sf.read(voice_path)
    if v.ndim > 1: v = v.mean(axis=1)
    v = signal.resample_poly(v, SR, vsr)[:N]; v = np.pad(v, (0, N - len(v)))
    v = hp(v, 80)                                        # clean rumble, a touch of presence
    v = v + 0.25 * bp(v, 2500, 6000)
    al = np.exp(-1 / (0.12 * SR))                          # voice loudness, ~120 ms window
    envv = np.sqrt(signal.lfilter([1 - al], [1, -al], v ** 2))
    thr = 0.25 * np.percentile(envv, 99)
    duck = 1 - 0.50 * np.clip(envv / thr, 0, 1)            # music down ~6 dB while she speaks
    ar = np.exp(-1 / (0.25 * SR)); duck = signal.lfilter([1 - ar], [1, -ar], duck - 1) + 1   # smooth swells back
    mix *= duck[:, None]
    vv = v * 0.9; vs = np.stack([vv, vv], 1)   # dry narrator: no room, no echo
    sp = envv > thr * 0.6
    bed = mix.mean(1)[sp]; vo = vs.mean(1)[sp]
    print('music+fx under the voice:', round(20 * np.log10(np.sqrt(np.mean(bed ** 2)) / np.sqrt(np.mean(vo ** 2))), 1), 'dB relative to the voice')
    mix += vs
mix /= max(1e-9, np.abs(mix).max()) / 0.89
fade = int(1.2 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
sf.write(out, mix.astype('float32'), SR)
print(out, round(L, 1), 's', len(ev), 'events')
