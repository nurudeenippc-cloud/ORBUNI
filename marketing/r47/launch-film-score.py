# Original score, sound design and dry voice mix for the Orbuni launch film.
import json, re, numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy import signal
TL = json.load(open('tl.json')); T, LEN, END, WD = TL['T'], TL['L'], TL['END'], TL['W']
SR = 48000; N = int((END + .5) * SR); rng = np.random.default_rng(5)
mus = np.zeros((N, 2)); sfx = np.zeros((N, 2))
def norm(s): return re.sub(r"[^a-z0-9']", '', s.lower())
def C(li, w, n=1):
    k = 0
    for x in WD:
        if x[3] == li and norm(x[2]) == w:
            k += 1
            if k == n: return x[0]
    raise SystemExit('cue miss %s %s' % (li, w))
NOTE = lambda n: 440.0 * 2 ** ((n - 69) / 12)
def lp(x, fc, o=2): b, a = signal.butter(o, min(fc, SR/2-200)/(SR/2), 'low'); return signal.lfilter(b, a, x)
def hp(x, fc, o=2): b, a = signal.butter(o, fc/(SR/2), 'high'); return signal.lfilter(b, a, x)
def bp(x, lo, hi): b, a = signal.butter(2, [lo/(SR/2), hi/(SR/2)], 'band'); return signal.lfilter(b, a, x)
def env(n, a, r):
    e = np.ones(n); A = max(1, int(a*SR)); R = max(1, int(r*SR)); e[:A] = np.linspace(0, 1, A)
    if R < n: e[-R:] *= np.linspace(1, 0, R)
    return e
def dec(n, tau): return np.exp(-np.arange(n) / (tau * SR))
def put(x, t, g=1.0, pan=0.0, bus=None):
    bus = mus if bus is None else bus
    i = int(t * SR)
    if i >= N: return
    if i < 0: x = x[-i:]; i = 0
    x = x[: N - i] * g
    bus[i:i+len(x), 0] += x * np.sqrt(.5 * (1 - pan)); bus[i:i+len(x), 1] += x * np.sqrt(.5 * (1 + pan))
def saw(f, n, det=.006):
    t = np.arange(n) / SR; o = np.zeros(n)
    for d in (-det, 0, det): o += signal.sawtooth(2*np.pi*f*(1+d)*t + rng.uniform(0, 6))
    return o / 3
def sine(f, n): return np.sin(2*np.pi*f*np.arange(n)/SR)
def pad(ch, t0, dur, g=.05, fc=1500, att=.6):
    m = int(dur*SR); put(lp(sum(saw(NOTE(n), m) for n in ch), fc) * env(m, min(att, dur/3), min(.9, dur/3)), t0, g)
def bass(n, t0, dur, g=.18): m = int(dur*SR); put(lp(saw(NOTE(n), m, .002), 220) * env(m, .01, .12), t0, g)
def piano(n, t0, g=.07, pan=0):
    m = int(3*SR); f = NOTE(n)
    x = (sine(f, m) + .45*sine(2*f, m)*dec(m, .5) + .18*sine(3*f, m)*dec(m, .25) + .06*sine(4.01*f, m)*dec(m, .15)) * dec(m, 1.0) * env(m, .003, .5)
    put(x, t0, g, pan)
def pluck(n, t0, g=.045, pan=0):
    m = int(.5*SR); x = signal.sawtooth(2*np.pi*NOTE(n)*np.arange(m)/SR) * .4 + sine(NOTE(n), m); put(lp(x, 3400) * dec(m, .13), t0, g, pan)
def kick(t, g=.5): m = int(.42*SR); put(sine(50*np.exp(-np.arange(m)/(.04*SR))+44, m) * dec(m, .17), t, g)
def clap(t, g=.15): m = int(.3*SR); put(bp(rng.standard_normal(m), 900, 4200) * dec(m, .07), t, g, .1)
def hat(t, g=.035): m = int(.06*SR); put(hp(rng.standard_normal(m), 7500) * dec(m, .012), t, g, -.2)
def shaker(t, g=.03): m = int(.09*SR); put(bp(rng.standard_normal(m), 4000, 11000) * env(m, .02, .06), t, g, .25)
def hit(t, g=1.0):
    m = int(2.2*SR)
    put(sine(54*np.exp(-np.arange(m)/(.2*SR))+31, m) * dec(m, .6), t, .75*g, bus=sfx)
    put(lp(rng.standard_normal(m), 2000) * dec(m, .14), t, .3*g, bus=sfx)
    m2 = int(3*SR); put(hp(rng.standard_normal(m2), 3500) * dec(m2, .9), t, .08*g, bus=sfx)
def slam(t, g=.8):
    m = int(.9*SR); put(sine(70*np.exp(-np.arange(m)/(.08*SR))+40, m) * dec(m, .2) + bp(rng.standard_normal(m), 200, 3000) * dec(m, .05) * .6, t, .45*g, bus=sfx)
def glitch(t, g=.3):
    m = int(.35*SR); x = signal.square(2*np.pi*rng.uniform(80, 300)*np.arange(m)/SR) * (rng.random(m) > .5) * dec(m, .12); put(bp(x, 300, 6000), t, g, bus=sfx)
def whoosh(t, g=.16, d=.8):
    m = int(d*SR); tt = np.arange(m)/SR; x = bp(rng.standard_normal(m), 400, 7000) * np.sin(np.pi*tt/tt[-1])**2
    put(x, t - d/2, g, pan=-.3, bus=sfx); put(x[::-1] * .6, t - d/2, g, pan=.3, bus=sfx)
def riser(te, d=2.0, g=.22):
    m = int(d*SR); tt = np.arange(m)/SR; x = bp(rng.standard_normal(m), 500, 9000) * (tt/tt[-1])**2.4 * .6 + np.sin(2*np.pi*np.cumsum(np.linspace(140, 1100, m))/SR) * (tt/tt[-1])**3 * .25
    put(x, te - d, g, bus=sfx)
def revcym(te, d=1.4, g=.18): m = int(d*SR); x = hp(rng.standard_normal(m), 4000) * np.linspace(0, 1, m)**3; put(x, te - d, g, bus=sfx)
def pop(t, g=.12, f=880):
    m = int(.12*SR); x = sine(f*np.exp(-np.arange(m)/(.03*SR))*0+f*(1+np.exp(-np.arange(m)/(.01*SR))), m) * dec(m, .03); put(x, t, g, bus=sfx)
def ding(t, g=.1):
    for i, n in enumerate((88, 95)):
        m = int(1.4*SR); put((sine(NOTE(n), m) + .2*sine(NOTE(n)*2.76, m)) * dec(m, .45) * env(m, .002, .3), t + i*.09, g, bus=sfx)
def chime(t, notes=(81, 88, 93, 100), g=.06):
    for i, n in enumerate(notes):
        m = int(2.6*SR); put((sine(NOTE(n), m) + .25*sine(NOTE(n)*2.01, m)) * dec(m, .9) * env(m, .002, .4), t + i*.1, g, -.5 + i*.3, bus=sfx)
def buzz(t, g=.12, d=.7):
    m = int(d*SR); x = signal.square(2*np.pi*170*np.arange(m)/SR) * (np.sin(2*np.pi*22*np.arange(m)/SR) > 0) * env(m, .01, .05); put(lp(x, 900), t, g, bus=sfx)
def ring(t, g=.05):
    for k in range(2):
        m = int(.42*SR); x = (sine(NOTE(84), m) + sine(NOTE(88), m)) * (np.sin(2*np.pi*18*np.arange(m)/SR) > -.2) * env(m, .01, .05); put(x, t + k*.5, g, bus=sfx)
def tick(t, g=.05): m = int(.025*SR); put(hp(rng.standard_normal(m), 3000) * dec(m, .004), t, g, bus=sfx)
def heart(t, g=.45):
    for d in (0, .28):
        m = int(.35*SR); put(sine(46*np.exp(-np.arange(m)/(.06*SR))+36, m) * dec(m, .09), t + d, g)
def drone(n, t0, dur, g=.12, fc=300): m = int(dur*SR); put(lp(saw(NOTE(n), m, .01) + .6*saw(NOTE(n+7), m, .01), fc) * env(m, 1.2, 1.2), t0, g)

# cues
c = dict(nothing=C(0, 'nothing'), n1=C(0, 'not', 1), n2=C(0, 'not', 2), n3=C(0, 'not', 3), so1=C(1, 'so'), this1=C(1, 'this'), orb=C(1, 'orbuni'), by=C(1, 'by'),
         lived=C(2, 'lived'), scan=C(2, 'scanning'), wait=C(2, 'waiting'), univ=C(2, 'universities'), schol=C(2, 'scholarships'), fees=C(2, 'fees'),
         calls=C(3, 'calls'), how=C(3, 'how'), can=C(3, 'can'), so3=C(3, 'so'), but=C(4, 'but'), the2=C(4, 'the', 2), closer=C(4, 'closer'),
         agents=C(5, 'agents'), fees5=C(5, 'fees'), no1=C(5, 'no', 1), no2=C(5, 'no', 2), no3=C(5, 'no', 3), and5=C(5, 'and'),
         we6=C(6, 'we', 2), middle=C(6, 'middleman'), accr=C(7, 'accredited'), official=C(7, 'official'), faster=C(7, 'faster'), better=C(7, 'better'), paper=C(7, 'paper'),
         built=C(8, 'built'), portal=C(8, 'portal'), rfees=C(8, 'fees'), rsch=C(8, 'scholarships'), where2=C(8, 'where', 2), lands=C(8, 'lands'),
         named=C(9, 'named'), two=C(9, 'two'), room=C(9, 'room'), airport=C(9, 'airport'), here=C(10, 'here'), nofee=C(10, 'no'), youpay=C(10, 'you'), costs=C(10, 'costs'),
         live=C(11, 'live'), nur=C(11, 'nurudeen'), god=C(11, 'godfrey'), small=C(11, 'small'), every=C(11, 'every'), take=C(12, 'take'), my=C(12, 'myorbunicom'), send=C(12, 'send'))
cuts = [T[1]-.15, c['so1']-.05, c['this1']-.15, T[2]-.2, c['scan']-.1, T[3]-.3, c['so3']-.1, T[4]-.35, T[5]-.25, c['and5']-.1, T[6]-.4, T[7]-.2, c['faster']-.1, T[8]-.25, c['portal']-.25, c['where2']-.15, T[9]-.3, c['room']-.5, T[10]-.35, T[11]-.3, T[12]-.3]

# 1 HOOK: phone buzz, sub, heartbeat pulse
buzz(.05, .14); hit(.02, .55); drone(33, 0, T[1] + .5, .1, 260)
t = .4
while t < T[1] - .2: heart(t, .32); t += 1.15
slam(c['nothing'], 1.0); [slam(c[k], .75) or glitch(c[k] + .02, .18) for k in ('n1', 'n2', 'n3')]
# 2 LEAD: emotional piano, swell into the logo, open-loop tension
PA = [((57, 60, 64), 45), ((53, 57, 60), 41), ((48, 52, 55), 36), ((55, 59, 62), 43)]   # Am F C G
t, i = T[1] - .3, 0
while t < c['this1'] - .1:
    ch, rt = PA[i % 4]; d = 2.6; pad(ch, t, d + .4, .03, 1100); bass(rt - 12, t, d, .08)
    for k, n in enumerate([ch[0]+12, ch[2]+12, ch[1]+24, ch[2]+12]): piano(n, t + k*.65, .055, -.3 + .2*k)
    t += d; i += 1
riser(c['this1'], 1.4, .16); chime(c['this1'] + .1); pad((60, 64, 67, 71), c['this1'], T[2] - c['this1'] + .3, .04, 2400, .3)
for k in range(10): pluck(84 + [0, 4, 7, 11, 12, 7, 4, 11, 7, 12][k], c['this1'] + .3 + k * .22, .03, -.4 + k*.08)
drone(38, c['by'] - .2, T[2] - c['by'] + .4, .07, 420); [pop(c['this1'] + .4 + k*.35, .07, 1200 + k*200) for k in range(3)]
# 3 JOURNEY: warm groove 96 bpm, piano arps, UI pops, phone rings
B = 60/96; t, i = T[2] - .2, 0
PB = [((48, 52, 55), 36), ((55, 59, 62), 43), ((57, 60, 64), 45), ((53, 57, 60), 41)]
while t < T[4] - .45:
    ch, rt = PB[i % 4]; d = 4*B; pad(ch, t, d + .2, .032, 1500); bass(rt - 12, t, d, .12)
    for k in range(8):
        tk = t + k*B/2
        if tk < T[4] - .45:
            piano(ch[k % 3] + 12 + (12 if k % 4 == 3 else 0), tk, .035, -.3 if k % 2 else .3); shaker(tk + B/4, .022)
            if k % 4 == 0: kick(tk, .3)
            if k % 4 == 2: clap(tk, .07)
    t += d; i += 1
for k in ('scan', 'wait', 'univ', 'schol', 'fees'): pop(c[k], .1, 950); whoosh(c[k], .05, .5)
for k in range(4): ring(c['calls'] + k*.32, .04); buzz(c['calls'] + k*.32, .05, .35)
pop(c['how'], .1, 1300); pop(c['can'], .1, 1450); slam(c['lived'], .45)
# 4 LOOP 2: drop to drone + typewriter + riser
drone(33, T[4] - .35, T[5] - T[4] + .2, .13, 200)
txt1, txt2 = 30, 14
for k in range(txt1): tick(c['but'] + k / 22, .05)
for k in range(txt2): tick(c['the2'] + k / 14, .05)
glitch(c['closer'], .3); riser(T[5] - .25, 2.4, .2)
# 5 WHAT WE FOUND: dark pulse, impacts per card, then grief pad
t = T[5] - .25
while t < c['and5'] - .2:
    m = int(.25*SR); put(lp(saw(NOTE(26), m, .02), 380) * dec(m, .12), t, .2); tick(t + .125, .03); t += .25
for k in ('agents', 'fees5', 'no1', 'no2', 'no3'): slam(c[k], .9); glitch(c[k] + .05, .15)
heart(c['and5'], .3); pad((50, 53, 57), c['and5'] - .1, T[6] - c['and5'] + .6, .045, 700, .4); drone(26, c['and5'], T[6] - c['and5'] + .4, .08, 250)
# 6 DECISION: silence, reverse cymbal, BIG hit
drone(29, T[6] - .4, T[7] - T[6], .06, 180); revcym(c['middle'], 1.6, .22); hit(c['middle'], 1.25); chime(c['middle'] + .2, (69, 76, 81), .05)
# 7 BUILD: uplifting 120 bpm groove, plucks, UI sounds
B = .5; PC = [((48, 52, 55), 36), ((55, 59, 62), 43), ((57, 60, 64), 45), ((53, 57, 60), 41)]
t, i = T[7] - .2, 0
while t < T[10] - .5:
    ch, rt = PC[i % 4]; d = 2.0; pad(ch, t, d + .2, .035, 1900); bass(rt - 12, t, d, .17)
    for k in range(8):
        tk = t + k*.25
        if tk >= T[10] - .5: break
        pluck(ch[k % 3] + 24 + (12 if k % 4 == 3 else 0), tk, .035, -.35 if k % 2 else .35)
    for k in range(4):
        tk = t + k*B
        if tk >= T[10] - .5: break
        kick(tk, .42); hat(tk + .25, .045)
        if k % 2 == 1: clap(tk, .12)
    t += d; i += 1
for k in range(7): whoosh(T[7] + k*.42, .09, .5)
slam(c['accr'], 1.0); ding(c['accr'] + .1, .06); pop(c['official'], .1, 1100)
for k in ('faster', 'better', 'paper'): pop(c[k], .1, 1250)
pop(c['rfees'], .08, 1000); pop(c['rsch'], .08, 1150); ding(c['lands'], .12)
for k in range(14): m = int(.08*SR); put(sine(2000 + rng.uniform(0, 3000), m) * dec(m, .02), c['lands'] + k*.05, .02, rng.uniform(-.6, .6), bus=sfx)
ding(c['two'] - .2, .07); pop(c['named'], .1, 1300); pop(c['room'], .1, 1100); ding(c['airport'], .08)
# 8 THE RULE: beat drops, tension, lock rattle, the reveal
drone(36, T[10] - .4, c['nofee'] - T[10] + .5, .1, 320); riser(c['nofee'] - .05, c['nofee'] - T[10] + .2, .26)
for k in range(5): m = int(.05*SR); put(bp(rng.standard_normal(m), 1500, 6000) * dec(m, .015), c['here'] + k*.08, .12, bus=sfx)
hit(c['nofee'] - .05, 1.35); chime(c['nofee'] + .1, (72, 79, 84, 88, 91), .07)
pad((60, 64, 67, 72, 76), c['nofee'] - .05, T[11] - c['nofee'] + .5, .05, 2600, .1); pad((48, 55), c['nofee'] - .05, T[11] - c['nofee'] + .5, .05, 400, .1)
pop(c['costs'], .08, 900)
# 9 RESULT: anthem
PD = [((53, 57, 60, 64), 41), ((55, 59, 62, 67), 43), ((57, 60, 64, 69), 45), ((48, 52, 55, 60), 36)]
t, i = T[11] - .3, 0
while t < END - 3.3:
    ch, rt = PD[i % 4]; d = 2.0; pad(ch, t, d + .25, .042, 2300); bass(rt - 12, t, d, .18)
    for k in range(8):
        tk = t + k*.25
        if tk >= END - 3.3: break
        pluck(ch[k % 4] + 24, tk, .03, -.3 if k % 2 else .3)
        if k % 2 == 0: kick(tk, .45)
        hat(tk + .125, .03)
        if k % 4 == 2: clap(tk, .13)
    t += d; i += 1
hit(T[11] - .3, .7); pop(c['live'], .1, 1200); whoosh(c['nur'], .08); whoosh(c['god'], .08)
pop(c['take'], .1, 1200); pop(c['send'], .1, 1350)
# 10 END: logo chime + final hit + tail
hit(END - 3.2, .9); chime(END - 3.0, (81, 88, 93, 100, 105), .07); pad((60, 67, 72, 76), END - 3.2, 3.6, .045, 2200, .05)
for x in cuts: whoosh(x, .1, .7)

# voice: dry, high-passed, gently compressed. No reverb anywhere on the voice.
voice = np.zeros(N); venv = np.zeros(N)
for i in range(13):
    a, sr = sf.read('vo/%02d.wav' % (i + 1))
    if sr != SR: a = signal.resample_poly(a, SR, sr)
    a = hp(a, 75, 2)
    j = int(T[i] * SR); voice[j:j+len(a)] += a[:N - j]; venv[max(0, j - int(.12*SR)):j+len(a)+int(.1*SR)] = 1
def comp(x, thr=.25, ratio=3.0):
    e = np.abs(x); b, a = signal.butter(1, 30/(SR/2)); e = signal.filtfilt(b, a, e)
    g = np.where(e > thr, (thr + (e - thr)/ratio) / np.maximum(e, 1e-9), 1.0); return x * g
voice = voice / (np.max(np.abs(voice)) + 1e-9); voice = comp(voice, .3, 2.5)
# presence lift (2-5 kHz) for clarity on phone speakers
voice = voice + .18 * bp(voice, 2200, 5200)
# music bus: short dark room on music only, then sidechain under the voice
def room(x, sec=1.6, wet=.18):
    n = int(sec*SR); ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 8, n)); ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir**2))
    y = np.zeros_like(x)
    for ch in range(2): y[:, ch] = (1-wet)*x[:, ch] + wet*signal.fftconvolve(x[:, ch], ir if ch == 0 else ir[::-1])[:len(x)]
    return y
mus = room(mus); mus /= np.max(np.abs(mus)) + 1e-9
duck = lp(venv, 4); mus *= (0.5 - 0.33*np.clip(duck, 0, 1))[:, None]
sfx /= np.max(np.abs(sfx)) + 1e-9; sfx *= .55 * (1 - .35*np.clip(duck, 0, 1))[:, None]
mix = mus + sfx + voice[:, None] * .82
fade = np.ones(N); fs_ = int((END - .8)*SR); fade[fs_:] = np.linspace(1, 0, N - fs_)**1.4; mix *= fade[:, None]
meter = pyln.Meter(SR); lufs = meter.integrated_loudness(mix); mix = pyln.normalize.loudness(mix, lufs, -14.0)
pk = np.max(np.abs(mix))
if pk > .97: mix = np.tanh(mix / pk * 1.15) * .97 / np.tanh(1.15)
sf.write('mix.wav', mix.astype('float32'), SR); print('ok', END, round(lufs, 1), '->', round(meter.integrated_loudness(mix), 1))
