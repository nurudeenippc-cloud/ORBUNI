# Original score for the ORBUNI launch film (36 s), synthesised from scratch.
#   python3 launch_sound.py out.wav
import sys, numpy as np, soundfile as sf
from scipy import signal
SR = 48000; L = 36.6; N = int(L * SR)
rng = np.random.default_rng(11)
mix = np.zeros((N, 2))
NOTE = lambda n: 440.0 * 2 ** ((n - 69) / 12)
def lp(x, fc, o=2): b, a = signal.butter(o, min(fc, SR/2-200)/(SR/2), 'low'); return signal.lfilter(b, a, x)
def hp(x, fc, o=2): b, a = signal.butter(o, fc/(SR/2), 'high'); return signal.lfilter(b, a, x)
def bp(x, lo, hi): b, a = signal.butter(2, [lo/(SR/2), hi/(SR/2)], 'band'); return signal.lfilter(b, a, x)
def env(n, a, r, sustain=True):
    e = np.ones(n); A = max(1, int(a*SR)); R = max(1, int(r*SR)); e[:A] = np.linspace(0, 1, A)
    if R < n: e[-R:] *= np.linspace(1, 0, R)
    return e
def dec(n, tau): return np.exp(-np.arange(n) / (tau * SR))
def put(x, t, g=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N: return
    x = x[: N - i] * g
    mix[i:i+len(x), 0] += x * np.sqrt(.5 * (1 - pan)); mix[i:i+len(x), 1] += x * np.sqrt(.5 * (1 + pan))
def saw(f, n, det=0.0):
    t = np.arange(n) / SR; out = np.zeros(n)
    for d in (-det, 0, det): out += signal.sawtooth(2*np.pi*f*(1+d)*t + rng.uniform(0, 6))
    return out / 3
def sine(f, n): return np.sin(2*np.pi*f*np.arange(n)/SR)
def reverb(x, sec=2.8, mix_=.35):
    n = int(sec*SR); ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n)); ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir**2))
    y = np.zeros_like(x)
    for c in range(2): y[:, c] = (1-mix_)*x[:, c] + mix_*signal.fftconvolve(x[:, c], ir if c == 0 else ir[::-1])[:len(x)]
    return y

# ---------------------------------------------------------------- 1. dream (0-4.5)
n = int(5.0*SR)
drone = (saw(NOTE(33), n, .004) * .6 + saw(NOTE(45), n, .006) * .4)
drone = lp(drone, 380) * env(n, 2.2, 1.0)
put(drone, 0.0, .22)
for t0, nt in [(0.6, 69), (1.5, 76), (2.4, 72), (3.2, 74), (3.9, 76)]:
    m = int(2.6*SR); x = (sine(NOTE(nt), m) + .35*sine(NOTE(nt)*2, m) + .12*sine(NOTE(nt)*3, m)) * dec(m, .7) * env(m, .004, .4)
    put(x, t0, .10, pan=rng.uniform(-.4, .4))
# heartbeat before the problem
for t0 in (3.75, 4.05):
    m = int(.35*SR); k = sine(48*np.exp(-np.arange(m)/(.06*SR))+38, m) * dec(m, .09); put(k, t0, .5)

# ---------------------------------------------------------------- 2. problem (4.5-10.3)
n = int(5.9*SR)
tens = lp(saw(NOTE(33), n, .01), 260) * np.linspace(.4, 1, n)
put(tens, 4.45, .2)
# ticking clock + rising 16th pulse
bpm = 132; step = 60 / bpm / 4
t = 4.5
while t < 10.15:
    m = int(.03*SR); tick = hp(rng.standard_normal(m), 5000) * dec(m, .006); put(tick, t, .12 + .1*(t-4.5)/5.6, pan=.3 if int(t/step) % 2 else -.3)
    m = int(step*SR); pul = lp(saw(NOTE(45), m), 300 + 2200*((t-4.5)/5.6)**2) * dec(m, .07)
    put(pul, t, .10 + .10*(t-4.5)/5.6)
    t += step
def hit(t0, g=1.0):
    m = int(1.6*SR)
    sub = sine(55*np.exp(-np.arange(m)/(.18*SR))+34, m) * dec(m, .45)
    nz = lp(rng.standard_normal(m), 1800) * dec(m, .12)
    glitch = signal.square(2*np.pi*90*np.arange(m)/SR) * dec(m, .05) * .3
    put(sub*.9 + nz*.5 + glitch, t0, .55*g)
for s in (5.7, 7.3, 8.9): hit(s)
# riser into the reveal
m = int(1.9*SR); tt = np.arange(m)/SR
rise = bp(rng.standard_normal(m), 400, 9000) * (tt/tt[-1])**2.2
tone = np.sin(2*np.pi*np.cumsum(np.linspace(110, 880, m))/SR) * (tt/tt[-1])**3 * .4
put(rise*.5 + tone*.3, 8.45, .35)

# ---------------------------------------------------------------- 3. reveal (10.3)
m = int(5.5*SR)
braam = 0
for nt, g in ((33, 1), (40, .7), (45, .6), (52, .35)):
    braam = braam + saw(NOTE(nt), m, .008) * g
cut = 200 + 3200*np.exp(-np.arange(m)/(.5*SR))
# time-varying filter, done in blocks
out = np.zeros(m); blk = 2048; zi = None
for i in range(0, m, blk):
    b, a = signal.butter(2, min(cut[i], SR/2-200)/(SR/2), 'low')
    seg = braam[i:i+blk]
    if zi is None: zi = signal.lfilter_zi(b, a) * seg[0]
    y, zi = signal.lfilter(b, a, seg, zi=zi); out[i:i+blk] = y
put(out * dec(m, 1.6), 10.3, .42)
m = int(2.2*SR); put(sine(60*np.exp(-np.arange(m)/(.25*SR))+30, m) * dec(m, .7), 10.3, .9)
m = int(4*SR); crash = hp(rng.standard_normal(m), 3000) * dec(m, 1.1); put(crash, 10.3, .16)
for i, nt in enumerate((81, 88, 93, 100)):           # the logo chime
    m = int(2.5*SR); x = (sine(NOTE(nt), m) + .25*sine(NOTE(nt)*2.01, m)) * dec(m, .9) * env(m, .002, .3)
    put(x, 10.95 + i*.11, .07, pan=-.5 + i*.33)
m = int(3.2*SR); put(lp(saw(NOTE(57), m, .01) + saw(NOTE(64), m, .01), 1500) * env(m, 1.0, 1.2), 10.6, .07)

# ---------------------------------------------------------------- 4. product (13.2-25.3): Am F C G at 120 bpm
T0 = 13.2; BAR = 2.0; beat = .5
chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)] * 2 + [(57, 60, 64), (53, 57, 60)]
roots = [45, 41, 36, 43] * 2 + [45, 41]
for ci, ch in enumerate(chords):
    t0 = T0 + ci*BAR
    if t0 > 25.4: break
    m = int(BAR*SR + .3*SR)
    pad = sum(saw(NOTE(n_), m, .007) for n_ in ch)
    put(lp(pad, 1600) * env(m, .15, .35), t0, .045)
    for k in range(8):                                 # pluck arpeggio, 8ths
        nt = ch[k % 3] + (12 if k % 4 == 3 else 0) + 12
        mm = int(.45*SR); x = (signal.sawtooth(2*np.pi*NOTE(nt)*np.arange(mm)/SR) * .5 + sine(NOTE(nt), mm)) ; x = lp(x, 3000) * dec(mm, .12)
        put(x, t0 + k*beat/2, .05, pan=(-.35 if k % 2 else .35))
    mm = int(BAR*SR); put(lp(saw(NOTE(roots[ci] - 12), mm), 220) * env(mm, .01, .1), t0, .2)   # bass
for i in range(int((25.25 - T0) / beat)):            # drums
    t0 = T0 + i*beat
    m = int(.4*SR); kick = sine(52*np.exp(-np.arange(m)/(.045*SR))+46, m) * dec(m, .16); put(kick, t0, .55)
    if i % 2 == 1:
        m = int(.3*SR); clap = bp(rng.standard_normal(m), 900, 4000) * dec(m, .07); put(clap, t0, .17, pan=.1)
    for h in (0, .25):
        m = int(.06*SR); hat = hp(rng.standard_normal(m), 7000) * dec(m, .012); put(hat, t0 + h, .05 if h else .035, pan=-.2)
def whoosh(t0, g=.18):
    m = int(.9*SR); tt = np.arange(m)/SR; x = bp(rng.standard_normal(m), 500, 6000) * np.sin(np.pi*tt/tt[-1])**2; put(x, t0, g)
for t0 in (13.0, 16.0, 18.9, 22.0): whoosh(t0)

# ---------------------------------------------------------------- 5. founders (25.3-30.6): warm, no drums
m = int(5.8*SR)
put(lp(saw(NOTE(53), m, .006) + saw(NOTE(57), m, .006) + saw(NOTE(60), m, .006) + saw(NOTE(64), m, .006), 1200) * env(m, 1.0, 1.2), 25.0, .05)
for t0, nt in [(25.6, 72), (26.4, 76), (27.2, 79), (28.0, 77), (28.8, 76), (29.6, 72)]:
    mm = int(2.4*SR); x = (sine(NOTE(nt), mm) + .3*sine(NOTE(nt)*2, mm)) * dec(mm, .8) * env(mm, .003, .4); put(x, t0, .09, pan=rng.uniform(-.3, .3))
m = int(1.6*SR); tt = np.arange(m)/SR; put(bp(rng.standard_normal(m), 300, 8000) * (tt/tt[-1])**2.5, 29.0, .25)

# ---------------------------------------------------------------- 6. call to action (30.6-36)
m = int(1.8*SR); put(sine(58*np.exp(-np.arange(m)/(.2*SR))+33, m) * dec(m, .6), 30.6, .8)
m = int(3.5*SR); put(hp(rng.standard_normal(m), 3500) * dec(m, 1.0), 30.6, .1)
for ci, (ch, rt) in enumerate([((53, 57, 60, 64), 41), ((55, 59, 62, 67), 43), ((57, 60, 64, 69), 45)]):
    t0 = 30.6 + ci*1.35; mm = int((1.6 if ci < 2 else 5.4)*SR)
    put(lp(sum(saw(NOTE(n_), mm, .007) for n_ in ch), 2200) * env(mm, .08, .9 if ci < 2 else 3.2), t0, .06)
    put(lp(saw(NOTE(rt - 12), mm), 230) * env(mm, .01, .5 if ci < 2 else 3.0), t0, .2)
for i in range(6):
    t0 = 31.0 + i*.5; mm = int(.4*SR); put(sine(52*np.exp(-np.arange(mm)/(.045*SR))+46, mm) * dec(mm, .16), t0, .45)
m = int(2.8*SR); put(sine(60*np.exp(-np.arange(m)/(.25*SR))+30, m) * dec(m, .9), 33.3, .7)
for i, nt in enumerate((81, 88, 93, 100, 105)):
    mm = int(3.0*SR); x = (sine(NOTE(nt), mm) + .25*sine(NOTE(nt)*2.01, mm)) * dec(mm, 1.1) * env(mm, .002, .5); put(x, 33.35 + i*.09, .06, pan=-.6 + i*.3)

mix = reverb(mix, 2.6, .28)
fade = np.ones(N); fs_ = int(35.4*SR); fade[fs_:] = np.linspace(1, 0, N - fs_) ** 1.5
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) + 1e-9; mix *= .89
sf.write(sys.argv[1] if len(sys.argv) > 1 else 'launch.wav', mix.astype('float32'), SR)
print('ok', L)
