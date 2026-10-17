"""The Grand Hall's window skylines and the times direct sun clears them.

For each of the five openings in the window wall (read from hall-spec.ts),
skyline profiles at 3 x 3 points on the wall's outer face (skyline.py), the
centre profile, and the clock times on three dates when the sun stands above
them (NOAA solar position, Glasgow). Writes:

  <out-dir>/window-skylines.json  every profile, the method and the sun times
  <ts>                            hall-skyline.ts: the centre profiles at whole
                                  degrees, as the web module the planner imports
  <out-dir>/window-skylines.png   with --plot (needs matplotlib): the profiles
                                  against the sun's path

Usage: python3 final.py <dsm-dir> <out-dir> [--hall-spec <hall-spec.ts>] [--ts <file>] [--plot]
--ts defaults to <out-dir>/hall-skyline.ts; to publish, pass
packages/web/src/components/grand-hall/hall-skyline.ts.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))   # skyline.py sits beside this file
import numpy as np, math, json, datetime as dt  # noqa: E401,E402
from skyline import AZ, FLOOR_DSM, HALL_SPEC, Z_OUT, load_dsm, planner_to_local, read_openings, skyline  # noqa: E402

ap = argparse.ArgumentParser(description="The Grand Hall's window skylines and sun times.")
ap.add_argument("dsm_dir", type=Path, help="directory holding heights_50cm.f32 and meta.json (fetch_dsm.py)")
ap.add_argument("out_dir", type=Path, help="directory window-skylines.json (and the plot) are written to")
ap.add_argument("--hall-spec", type=Path, default=HALL_SPEC, help="hall-spec.ts (default: the repo's own)")
ap.add_argument("--ts", type=Path, help="where hall-skyline.ts is written (default: <out-dir>/hall-skyline.ts)")
ap.add_argument("--plot", action="store_true", help="also draw window-skylines.png (needs matplotlib)")
ARGS = ap.parse_args()
ARGS.out_dir.mkdir(parents=True, exist_ok=True)
H = load_dsm(ARGS.dsm_dir)
openings = read_openings(ARGS.hall_spec)


# ------------------------------------------------------------------ skylines
def prof(p0,ze,facade_mask):
    return skyline(H,p0,ze,facade_mask=facade_mask)      # NaN where the ray never leaves the facade zone (grazing along the wall)

wins=[]; centreB={}; centreA={}; lo9={}; hi9={}
for o in openings:
    h=o['top']-o['sill']
    ys=[o['sill']+f*h for f in (0.2,0.5,0.8)]
    xs=[o['centreX']+f*o['width'] for f in (-0.3,0.0,0.3)]
    samples=[]; allp=[]
    for yy in ys:
        row=[]
        for xx in xs:
            p0=planner_to_local(xx,Z_OUT); e=prof(p0,FLOOR_DSM+yy,True); allp.append(e)
            row.append([None if np.isnan(v) else round(float(v),2) for v in e])
        samples.append(row)
    p0=planner_to_local(o['centreX'],Z_OUT); ze=FLOOR_DSM+ys[1]
    centreB[o['id']]=prof(p0,ze,True); centreA[o['id']]=prof(p0,ze,False)
    A=np.array(allp); lo9[o['id']]=np.nanmin(A,0); hi9[o['id']]=np.nanmax(A,0)
    wins.append(dict(id=o['id'],kind=o['kind'],centreX=round(o['centreX'],3),widthM=o['width'],
        sillAboveFloorM=o['sill'],topAboveFloorM=round(o['top'],3),
        centrePointLocalEN=[round(float(v),2) for v in p0],
        samplePointsPlannerX=[round(v,3) for v in xs],sampleHeightsAboveFloorM=[round(v,3) for v in ys],
        sampleDsmEyeHeightM=[round(FLOOR_DSM+v,3) for v in ys],
        samplesNote="samples[iy][ix][azimuthIndex]; iy = height 20/50/80 %, ix = planner x increasing (-30/0/+30 % of width)",
        samples=samples,
        centreProfileSpecLiteral3mSkipOnly=[None if np.isnan(v) else round(float(v),2) for v in centreA[o['id']]]))
ids=[o['id'] for o in openings]
def r1(a): return [None if np.isnan(v) else round(float(v),1) for v in a]
combined={'azimuthTrueDeg':AZ.tolist(),**{i:r1(centreB[i]) for i in ids}}

# ------------------------------------------------------------------ sun (NOAA)
LAT,LON=55.8593,-4.2491
def sunpos(utc):
    jd=utc.toordinal()+1721424.5+(utc.hour+utc.minute/60+utc.second/3600)/24
    T=(jd-2451545.0)/36525
    L0=(280.46646+T*(36000.76983+T*0.0003032))%360
    M=357.52911+T*(35999.05029-0.0001537*T); Mr=math.radians(M)
    e=0.016708634-T*(0.000042037+0.0000001267*T)
    C=math.sin(Mr)*(1.914602-T*(0.004817+0.000014*T))+math.sin(2*Mr)*(0.019993-0.000101*T)+math.sin(3*Mr)*0.000289
    tl=L0+C; om=125.04-1934.136*T; lam=tl-0.00569-0.00478*math.sin(math.radians(om))
    eps0=23+(26+((21.448-T*(46.815+T*(0.00059-T*0.001813))))/60)/60
    eps=eps0+0.00256*math.cos(math.radians(om))
    dec=math.degrees(math.asin(math.sin(math.radians(eps))*math.sin(math.radians(lam))))
    y=math.tan(math.radians(eps/2))**2
    eot=4*math.degrees(y*math.sin(2*math.radians(L0))-2*e*math.sin(Mr)+4*e*y*math.sin(Mr)*math.cos(2*math.radians(L0))-0.5*y*y*math.sin(4*math.radians(L0))-1.25*e*e*math.sin(2*Mr))
    mins=utc.hour*60+utc.minute+utc.second/60
    tst=(mins+eot+4*LON)%1440
    ha=tst/4-180
    la=math.radians(LAT); d=math.radians(dec); h=math.radians(ha)
    cz=math.sin(la)*math.sin(d)+math.cos(la)*math.cos(d)*math.cos(h)
    zen=math.degrees(math.acos(max(-1,min(1,cz))))
    az=(math.degrees(math.atan2(math.sin(h),math.cos(h)*math.sin(la)-math.tan(d)*math.cos(la)))+180)%360
    alt=90-zen
    ae=alt
    if ae>85: r=0
    elif ae>5: r=58.1/math.tan(math.radians(ae))-0.07/math.tan(math.radians(ae))**3+0.000086/math.tan(math.radians(ae))**5
    elif ae>-0.575: r=1735+ae*(-518.2+ae*(103.4+ae*(-12.79+ae*0.711)))
    else: r=-20.772/math.tan(math.radians(ae))
    return az,alt,alt+r/3600
DATES={'21 June 2026':((2026,6,21),1,'BST'),'20 March 2026':((2026,3,20),0,'GMT'),'21 December 2026':((2026,12,21),0,'GMT')}
def track(date,off):
    t0=dt.datetime(*date)-dt.timedelta(hours=off); out=[]
    for s in range(0,86400,30):
        u=t0+dt.timedelta(seconds=s); az,alt,app=sunpos(u); out.append((s/3600.0,az,alt,app))
    return np.array(out)    # local hour, az, geometric alt, apparent alt
def skyat(p,az):
    ok=~np.isnan(p)
    if az<AZ[0] or az>AZ[-1] or not ok.any(): return np.nan
    return float(np.interp(az,AZ[ok],p[ok]))
def hhmm(h):
    m=int(round(h*60)); return '%02d:%02d'%(m//60,m%60)
def intervals(tr,p,azlim=None):
    on=[]
    for hr,az,alt,app in tr:
        s=skyat(p,az); ok=(app>s) if not np.isnan(s) else False
        if azlim and not (azlim[0]<=az<=azlim[1]): ok=False
        on.append(ok)
    res=[];st=None
    for i,v in enumerate(on):
        if v and st is None: st=tr[i,0]
        if (not v) and st is not None: res.append([st,tr[i,0]]); st=None
    if st is not None: res.append([st,tr[-1,0]])
    merged=[]
    for a,b in res:
        if merged and a-merged[-1][1]<3/60: merged[-1][1]=b
        else: merged.append([a,b])
    return [(hhmm(a),hhmm(b)) for a,b in merged if b-a>=1/60]
REVEAL_DEPTH=0.62
def reveal_lim(o):
    th=math.degrees(math.atan(o['width']/REVEAL_DEPTH)); return (101.1-th,101.1+th)
sun={}; tracks={}
for name,(d,off,tz) in DATES.items():
    tr=track(d,off); tracks[name]=tr
    sun[name]=dict(zone=tz,utcOffsetH=off,maxAltitudeDeg=round(float(tr[:,2].max()),1),azimuthRangeInFacingHalfSpaceDeg=None)
    inh=tr[(tr[:,1]>=11)&(tr[:,1]<=191.1)&(tr[:,2]>0)]
    if len(inh):
        sun[name]['azimuthRangeInFacingHalfSpaceDeg']=[round(float(inh[:,1].min()),1),round(float(inh[:,1].max()),1)]
        sun[name]['facingHalfSpaceClockWindow']=[hhmm(inh[0,0]),hhmm(inh[-1,0])]
    sun[name]['clearIntervals']={}
    for i in ids:
        sun[name]['clearIntervals'][i]=dict(
            centrePoint=intervals(tr,centreB[i]),
            anyOfNinePoints=intervals(tr,lo9[i]),
            allNinePoints=intervals(tr,hi9[i]),
            centrePointSpecLiteral3mSkipOnly=intervals(tr,centreA[i]),
            centrePointRevealLimited=intervals(tr,centreB[i],reveal_lim(next(o for o in openings if o['id']==i))))
out=dict(
 source="Scottish LiDAR Phase 5 (2020) 50 cm DSM, Crown copyright Scottish Government and Fugro, OGL v3.0; tiles NS56NE, NS56SE, NS66NW, NS66SW cut to a 3 km square around HES NGR E259329 N665183 (tools/grand-hall-survey/context/fetch_dsm.py)",
 method="Per window 3x3 points (x at -30/0/+30 % of width about the centre, y at 20/50/80 % of opening height above the sill) on the OUTER face of the window wall (planner z=-5.915). Rays every 0.5 deg true azimuth 11.0..191.5; march 3..600 m, step 0.25+0.004*d m, bilinear DSM, max elevation angle atan2(h_dsm - h_eye - d^2/2R, d), R=6371 km. Samples nearer than 3 m are ignored (spec). VARIANT B (used for samples, combined and sun times) also ignores samples whose facade-frame d is below 1.25 m: the DSM carries the hall's own cornice/balustrade lip 0.4-1.0 m outboard of the wall face (facade d=0) while the hall's outer window face maps to d=-1.27, so without this the rays graze the hall's own roof and read 55-75 deg. Rays that never leave that zone (az 11.0 and 191+) are null. The literal 3 m-only centre profile is kept per window as centreProfileSpecLiteral3mSkipOnly. Values are degrees above horizontal.",
 frameNotes=dict(
  gridOrientation="heights_50cm.f32 is row-major float32 [6000][6000]; row 0 = SOUTH (fetch_dsm.py writes np.flipud), column 0 = WEST. Cell centre local E=(col+0.5)*0.5-1500, N=(row+0.5)*0.5-1500 (metres from HES NGR 259329,665183). Height = metres above the Hall's street level (10.7 m ODN); pavement at the facade is -0.30. Dome crown 24.187 m peaks at local (3.25, 7.75).",
  hallToLocal="local=(3,8)+plannerX*unit(bearing 192.96)+(-plannerZ)*unit(bearing 102.96); hall floor DSM height=-0.30+3.79=3.49 m; the window wall outer face (planner z=-5.915) maps to facade-frame d=-1.27, i.e. 1.27 m behind the facade wall face.",
  azimuth="true azimuth = grid azimuth - 1.861 deg (ray grid bearing = true + 1.861). Window normal true 101.1.",
  windowCentreFacadeU="planner x -9.035,-4.915,-0.025,4.865,8.985 map to facade u +9.02,+4.90,+0.01,-4.88,-9.00 (planner +x is south)"),
 azimuthStepDeg=0.5, azimuthStartDeg=11.0, azimuthEndDeg=float(AZ[-1]),
 windows=wins, combined=combined,
 sunClearTimesLocal=dict(note="Direct sun clears when the refraction-corrected sun-centre altitude exceeds the interpolated skyline at the sun's true azimuth. Local clock times, 30 s resolution. NOAA solar algorithm, Glasgow 55.8593N 4.2491W. centrePoint etc. do NOT apply reveal limits; centrePointRevealLimited additionally requires the sun within atan(width/0.62 m wall thickness) of the window normal (66.6 deg sashes, 77 deg arches), a crude thin-wall estimate.",dates=sun))
with open(ARGS.out_dir/'window-skylines.json','w',encoding='utf-8') as f: json.dump(out,f,separators=(',',':'),allow_nan=False)

# ------------------------------------------------------------------ hall-skyline.ts
TS_HEADER='''// ---------------------------------------------------------------------------
// What each of the Grand Hall's windows sees of the sky
//
// For each window, the skyline above its centre: for every degree of true
// azimuth across the half of the sky the window wall faces (11° to 191°), the
// highest angle of the city's roofs, from the Scottish LiDAR Phase 5 50 cm
// DSM (2020; Crown copyright Scottish Government and Fugro, OGL v3.0), cast
// from the window's centre on the wall's outer face, 600 m out, with the
// earth's curvature (tools/grand-hall-survey/skyline). The blocks across
// Glassford Street stand 17–32° high; the gap at Garth Street opens to about
// 10°. Direct sun reaches a window only above its skyline. The grazing ends,
// where the LiDAR was not measured, repeat the nearest measured degree.
// ---------------------------------------------------------------------------

export type HallWindowId = "arch-fireplace" | "window-fireplace" | "arch-centre" | "window-end" | "arch-end";

/** First and last azimuth of each profile, degrees true; one value per degree. */
export const SKYLINE_AZIMUTH_START = 11;
export const SKYLINE_AZIMUTH_END = 191;

/** Skyline elevation above each window's centre, degrees, by azimuth from 11° to 191°. */
export const HALL_WINDOW_SKYLINES: Readonly<Record<HallWindowId, readonly number[]>> = {'''
TS_IDS=['arch-fireplace','window-fireplace','arch-centre','window-end','arch-end']
assert sorted(TS_IDS)==sorted(ids), ids
def whole_degrees(series):
    """The 0.5-degree centre profile at whole degrees 11..191; an unmeasured (null) sample takes the
    nearest measured one, the lower azimuth first on a tie."""
    az=combined['azimuthTrueDeg']; vals=[]
    for a in range(11,192):
        i=az.index(float(a)); v=series[i]
        if v is None:
            for k in range(1,len(series)):
                for j in (i-k,i+k):
                    if 0<=j<len(series) and series[j] is not None:
                        v=series[j]; break
                if v is not None: break
        vals.append(round(v,1))
    return vals
ts=[TS_HEADER]
for wid in TS_IDS:
    vals=whole_degrees(combined[wid])
    chunks=[', '.join(str(v) for v in vals[i:i+20]) for i in range(0,len(vals),20)]
    ts.append(f'  "{wid}": [\n    ' + ',\n    '.join(chunks) + ',\n  ],')
ts.append('};\n')
ts_path=ARGS.ts or ARGS.out_dir/'hall-skyline.ts'
ts_path.write_bytes('\n'.join(ts).encode('utf-8'))
print('wrote',ts_path)

for name,v in sun.items():
    print(name,v['zone'],'maxalt',v['maxAltitudeDeg'],'az range',v['azimuthRangeInFacingHalfSpaceDeg'],v.get('facingHalfSpaceClockWindow'))
    for i in ids:
        c=v['clearIntervals'][i]; print('  %-17s centre %s | any9 %s | all9 %s | spec3m %s | reveal %s'%(i,c['centrePoint'],c['anyOfNinePoints'],c['allNinePoints'],c['centrePointSpecLiteral3mSkipOnly'],c['centrePointRevealLimited']))

# ------------------------------------------------------------------ plot
if not ARGS.plot:
    sys.exit(0)
import matplotlib; matplotlib.use('Agg')  # noqa: E401,E402
import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(15,8.2),dpi=130)
cols=dict(zip(ids,['#1b6ca8','#2a9d8f','#7a4fb5','#c8553d','#6b6b6b']))
for i in ids: ax.plot(AZ,centreB[i],color=cols[i],lw=1.6,label=i+' (centre point)')
ax.fill_between(AZ,0,np.nanmin(np.array([centreB[i] for i in ids]),0),color='#888',alpha=0.12,lw=0)
scol={'21 June 2026':'#e07a00','20 March 2026':'#d4a000','21 December 2026':'#b0003a'}
sty={'21 June 2026':'-','20 March 2026':'--','21 December 2026':':'}
for name,tr in tracks.items():
    m=(tr[:,1]>=0)&(tr[:,1]<=200)&(tr[:,3]>-1)
    sub=tr[m]
    ax.plot(sub[:,1],sub[:,3],color=scol[name],lw=3.2,ls=sty[name],label='Sun, '+name+' ('+DATES[name][2]+')',zorder=5)
    for hr in range(0,24):
        j=np.argmin(np.abs(tr[:,0]-hr))
        az,app=tr[j,1],tr[j,3]
        if 11<=az<=191.5 and app>0:
            ax.plot(az,app,'o',color=scol[name],mec='k',ms=6,zorder=6)
            ax.annotate('%02d:00'%hr,(az,app),textcoords='offset points',xytext=(6,-11) if name=='20 March 2026' else (-34,4),fontsize=7.5,color=scol[name] if name!='20 March 2026' else '#8a6a00',zorder=7,weight='bold')
ax.axvline(101.1,color='k',lw=0.6,ls='-.'); ax.text(101.6,59,'window normal 101.1',fontsize=8,va='top')
ax.set_xlim(11,191.5); ax.set_ylim(0,60); ax.set_xticks(range(20,191,10))
ax.set_xlabel('True azimuth (deg, N=0, E=90, S=180)'); ax.set_ylabel('Elevation above horizontal (deg)')
ax.set_title("Grand Hall window skylines (LiDAR 50 cm DSM) and the sun's path, Glasgow\nthin lines = skyline at each window centre; heavy lines = sun; dots = whole local hours (BST in June, GMT otherwise); sun above a line = direct sun clears that window",fontsize=11)
ax.axvspan(11,34.5,color='#c33',alpha=0.07,lw=0); ax.axvspan(167.7,191.5,color='#c33',alpha=0.07,lw=0)
ax.text(12,57,'beyond ~66 deg off the window normal\nthe 0.62 m reveal blocks the sun;\nskyline here is grazing, unreliable',fontsize=7.5,va='top',color='#733')
ax.text(168.5,57,'reveal-blocked\n(sash windows)',fontsize=7.5,va='top',color='#733')
ax.grid(alpha=0.25); ax.legend(loc='upper center',bbox_to_anchor=(0.5,-0.08),fontsize=8.5,ncol=4,framealpha=0.92)
fig.text(0.01,0.005,'Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0. Own cornice zone excluded; reveal limits not applied in the plot; sun centre incl. refraction.',fontsize=7)
fig.tight_layout(rect=(0,0.02,1,1)); fig.savefig(ARGS.out_dir/'window-skylines.png')
print('png done')
