import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy import signal
SR=48000; L=15.2; N=int(L*SR); mix=np.zeros((N,2)); rng=np.random.default_rng(3)
def put(x,t,g=1,pan=0):
    i=int(t*SR); x=x[:N-i]*g; mix[i:i+len(x),0]+=x*np.sqrt(.5*(1-pan)); mix[i:i+len(x),1]+=x*np.sqrt(.5*(1+pan))
def lp(x,fc): b,a=signal.butter(2,fc/(SR/2)); return signal.lfilter(b,a,x)
def dec(n,tau): return np.exp(-np.arange(n)/(tau*SR))
def bloop(t,f0=260,f1=720,g=.5,pan=0,d=.22):
    m=int(d*SR); tt=np.arange(m)/SR; f=f0+(f1-f0)*(1-np.exp(-tt/.035)); x=np.sin(2*np.pi*np.cumsum(f)/SR)*dec(m,.06)
    x*=np.minimum(1,tt/.002); put(x,t,g,pan)
def block(t,f=180,g=.45):
    m=int(.35*SR); x=(np.sin(2*np.pi*f*np.arange(m)/SR)+.5*np.sin(2*np.pi*f*2.7*np.arange(m)/SR)*dec(m,.02))*dec(m,.07); put(x,t,g)
def sub(t,g=.6,d=1.2):
    m=int(d*SR); f=48*np.exp(-np.arange(m)/(.15*SR))+38; put(np.sin(2*np.pi*np.cumsum(f)/SR)*dec(m,.45),t,g)
def tick(t,g=.06): m=int(.02*SR); put(lp(rng.standard_normal(m),3500)*dec(m,.004),t,g,rng.uniform(-.3,.3))
def pad(notes,t,d,g=.05):
    m=int(d*SR); tt=np.arange(m)/SR; x=sum(np.sin(2*np.pi*440*2**((n-69)/12)*tt)+.3*np.sin(2*np.pi*2*440*2**((n-69)/12)*tt) for n in notes)
    e=np.minimum(1,tt/.8)*np.minimum(1,(d-tt)/1.2); put(lp(x,1200)*e,t,g)
def swell(t,d=1.0,g=.12):
    m=int(d*SR); x=lp(rng.standard_normal(m),900)*np.linspace(0,1,m)**2; put(x,t-d,g)
# bed
pad((38,45,50,53),0,8.2,.035); pad((41,48,53,57),7.9,2.6,.035); pad((36,43,48,52,55),10.2,5.0,.045)
for t in np.arange(0,10.2,1.2): sub(t,.22,.9)
# blob intro
bloop(0.02,200,520,.55); bloop(.45,240,640,.4,-.2); bloop(.85,300,820,.4,.2); sub(1.1,.7); bloop(1.12,180,980,.45)
for k in range(30): tick(1.55+k/30,.035)
for i,t in enumerate([3.2,3.46,3.72]): bloop(t,250+i*60,700+i*120,.5,-.4+.4*i)
for i,t in enumerate([4.95,5.19,5.43]): bloop(t,220+i*50,600+i*100,.42,.3-.3*i)
bloop(6.6,160,480,.5); swell(6.6,.5,.1)
for i,t in enumerate([6.75,6.97,7.19]): bloop(t,300+i*80,900+i*150,.4,-.3+.3*i)
bloop(7.55,700,200,.45)
for k in range(len('More than an agency.')): tick(8.1+k/24,.035)
for k in range(len("It's a journey.")): tick(9.25+k/20,.035)
for t in [2.9,4.6,6.6,8.0]: block(t,170,.35)
swell(10.3,1.6,.16); sub(10.3,.9,2.4)
for i,n in enumerate((81,88,93,100)):
    m=int(2.4*SR); f=440*2**((n-69)/12); put(np.sin(2*np.pi*f*np.arange(m)/SR)*dec(m,.8)*.6,10.4+i*.09,.12,-.5+.33*i)
bloop(12.7,240,760,.5); bloop(13.0,320,960,.4)
fade=np.ones(N); s=int(14.4*SR); fade[s:]=np.linspace(1,0,N-s)**1.5; mix*=fade[:,None]
m=pyln.Meter(SR); mix=pyln.normalize.loudness(mix,m.integrated_loudness(mix),-14); pk=np.max(np.abs(mix))
if pk>.95: mix*=.95/pk
sf.write('story.wav',mix.astype('float32'),SR); print('ok')
