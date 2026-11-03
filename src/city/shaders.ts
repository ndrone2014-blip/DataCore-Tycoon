// GLSL for the street-level city. Everything is procedural: there are no image assets, so
// facades, roads and lots stay sharp at any distance and load instantly on phones.

export const STYLE = {
  plain: 0, glass: 1, office: 2, brick: 3, apartment: 4, metal: 5, shop: 6, siding: 7, roof: 8,
  parking: 9, grass: 10, pavement: 11, panels: 12, glow: 13, dirt: 14, darkGlass: 16, racks: 17,
  shingle: 18, foliage: 20, paint: 21, gravel: 22, decal: 30, xray: 31,
} as const;

const COMMON = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
uniform vec3 uCam, uSunDir, uSunCol, uSkyTop, uSkyHor, uSkyGnd;
uniform float uAmbient, uNight, uTime, uFogK;
uniform mat4 uSunVP;
#if Q > 0
uniform sampler2DShadow uShadow;
uniform float uShadowOn, uTexel;
#endif
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ return vnoise(p)*.55+vnoise(p*2.13+7.)*.3+vnoise(p*4.31+3.)*.15; }
vec3 lin(vec3 c){ return pow(max(c,vec3(0.)),vec3(2.2)); }
vec3 skyAt(vec3 d){
  float y=d.y;
  vec3 c=y>0.?mix(uSkyHor,uSkyTop,pow(clamp(y*1.25,0.,1.),.55)):mix(uSkyHor,uSkyGnd,clamp(-y*5.,0.,1.));
  float s=max(dot(d,uSunDir),0.);
  return c+uSunCol*(pow(s,10.)*.10+pow(s,90.)*.32)*(1.-uNight*.9);
}
float shadowAt(vec3 p,float ndl){
#if Q > 0
  if(uShadowOn<.5) return 1.;
  vec4 q=uSunVP*vec4(p,1.); vec3 c=q.xyz/q.w*.5+.5;
  if(c.x<0.||c.y<0.||c.x>1.||c.y>1.||c.z>1.) return 1.;
  float b=.0012+.0035*(1.-ndl); c.z-=b; float v=0.;
#if Q > 1
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) v+=texture(uShadow,vec3(c.xy+vec2(x,y)*uTexel*1.1,c.z));
  return v/9.;
#else
  v+=texture(uShadow,c); v+=texture(uShadow,vec3(c.xy+vec2(uTexel,0.),c.z)); v+=texture(uShadow,vec3(c.xy+vec2(0.,uTexel),c.z));
  return v/3.;
#endif
#else
  return 1.;
#endif
}
vec3 finish(vec3 col,vec3 p){
  vec3 v=p-uCam; float d=length(v);
  float f=1.-exp(-pow(d*uFogK,1.6));
  col=mix(col,skyAt(vec3(v.x,max(v.y,0.)+d*.02,v.z)/d),f);
  // ACES tone map + sRGB
  col*=.86; col=clamp((col*(2.51*col+.03))/(col*(2.43*col+.59)+.14),0.,1.);
  return pow(col,vec3(1./2.2));
}
vec3 light(vec3 alb,vec3 N,vec3 V,vec3 P,float rough,float metal,float ao,out float shOut){
  float ndl=max(dot(N,uSunDir),0.);
  float sh=shadowAt(P+N*.55,ndl); shOut=sh;
  vec3 skyA=uSkyTop*.45+uSkyHor*.55; skyA=mix(skyA,vec3(dot(skyA,vec3(.3,.55,.15))),.5);
  vec3 hemi=mix(uSkyGnd*1.1+vec3(.05),skyA,N.y*.5+.5)*uAmbient+vec3(.05,.06,.095)*uNight*(.7+.3*N.y);
  vec3 H=normalize(uSunDir+V);
  float a=rough*rough, nh=max(dot(N,H),0.), dd=nh*nh*(a*a-1.)+1.;
  float D=a*a/(3.14159*dd*dd+1e-4);
  float F=.04+.96*pow(1.-max(dot(H,V),0.),5.);
  vec3 F0=mix(vec3(.04),alb,metal);
  vec3 spec=(F0+(1.-F0)*F)*min(D,18.)*.25;
  vec3 dif=alb*(1.-metal);
  vec3 c=(dif+spec)*uSunCol*ndl*sh*2.1+dif*hemi*ao*1.05;
  c+=F0*skyAt(reflect(-V,N))*(.3+.7*(1.-rough))*ao*.45;
  return c;
}
`;

export const MAIN_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aC; layout(location=4) in vec4 aM; layout(location=5) in float aAO;
#ifdef INST
layout(location=6) in vec4 iPS; layout(location=7) in vec4 iRC;
#endif
uniform mat4 uVP; out vec3 vP,vN,vC; out vec2 vUV; out vec4 vM; out float vAO;
void main(){
  vec3 p=aP,n=aN,c=aC;
#ifdef INST
  float cs=cos(iRC.x),sn=sin(iRC.x);
  p=vec3(p.x*cs-p.z*sn,p.y,p.x*sn+p.z*cs)*iPS.w+iPS.xyz;
  n=vec3(n.x*cs-n.z*sn,n.y,n.x*sn+n.z*cs);
  if(aM.x>15.5&&aM.x<16.5) c=aC; else c=aC*iRC.yzw;
#endif
  vP=p; vN=n; vC=pow(max(c,vec3(0.)),vec3(2.2)); vUV=aUV; vM=aM; vAO=aAO;
  gl_Position=uVP*vec4(p,1.);
}`;

export const MAIN_FS = /* glsl */ `#version 300 es
${COMMON}
in vec3 vP,vN,vC; in vec2 vUV; in vec4 vM; in float vAO; out vec4 O;
// ---- window grid: returns coverage, cell id, local coords; fades to average coverage far away
float grid(vec2 uv,float bay,float flr,vec2 size,out vec2 id,out vec2 f,out float lod){
  vec2 q=uv/vec2(bay,flr); id=floor(q); f=fract(q)-.5;
  vec2 w=fwidth(q)+1e-4; lod=smoothstep(.16,.42,max(w.x,w.y));
  vec2 m=smoothstep(size*.5+w*.7,size*.5-w*.7,abs(f));
  return mix(m.x*m.y,size.x*size.y,lod);
}
vec3 envRefl(vec3 R,vec3 P){
  vec3 c=skyAt(vec3(R.x,abs(R.y)*.9+.02,R.z));
  // far side of the street: darker skyline in the lower reflection
  float b=smoothstep(.3,.0,R.y+(vnoise(R.xz*2.2+P.xz*.002)-.5)*.1);
  return mix(c,mix(uSkyGnd,vec3(.05,.06,.075),.6)+uSkyHor*.16,b*.85);
}
#define GRIME fbm(vP.xz*.07+vP.y*vec2(.03,.21)+seed*40.)
void main(){
  float st=vM.x, seed=vM.y, flr=max(vM.z,.5), bay=max(vM.w,.5);
  vec3 N=normalize(vN), V=normalize(uCam-vP), alb=vC;
  float rough=.82, metal=0., ao=vAO, win=0., glassRough=.05; vec2 id=vec2(0.),f=vec2(0.); float lod=0.;
  vec3 glow=vec3(0.); vec3 tint=vec3(.09,.12,.15); float litBias=.34; vec3 winN=N;
  vec2 uv=vUV; bool vertical=abs(N.y)<.5;
  if(st<.5){ rough=.78; alb*=.92+.16*GRIME; }
  else if(st<1.5){ // glass curtain wall
    win=grid(uv,bay,flr,vec2(.95,.86),id,f,lod); alb=mix(vec3(.08,.09,.1),vC,.12); metal=.7; rough=.42; tint=vC*.55+vec3(.02); litBias=.42;
    float sp=step(.43,abs(f.y)); if(lod<.5) win*=1.-.5*sp;
  } else if(st<2.5){ // concrete office: ribbon windows and pilasters
    win=grid(uv,bay,flr,vec2(.8,.56),id,f,lod); rough=.86; alb*=.88+.2*GRIME; tint=vec3(.075,.10,.13);
    if(lod<.6) alb*=1.-.22*smoothstep(.31,.29,abs(f.y+.33))*step(abs(f.x),.42);
  } else if(st<3.5){ // brick
    win=grid(uv,bay,flr,vec2(.44,.58),id,f,lod); rough=.92; litBias=.3; tint=vec3(.06,.07,.08);
    vec2 b=uv*vec2(4.2,12.); b.x+=mod(floor(b.y),2.)*.5; vec2 bf=fract(b); vec2 bw=fwidth(b);
    float mortar=smoothstep(.08+bw.y,.0,bf.y)+smoothstep(.04+bw.x,.0,bf.x); float fade=1.-smoothstep(.25,.7,max(bw.x,bw.y));
    alb*=mix(1.,(.78+.42*hash21(floor(b)))*(1.-.42*clamp(mortar,0.,1.)),fade);
    if(lod<.6){ float lintel=step(abs(f.x),.26)*(smoothstep(.28,.3,f.y)*smoothstep(.37,.35,f.y)+smoothstep(-.3,-.28,-f.y)*smoothstep(.37,.35,-f.y)); alb=mix(alb,vec3(.5,.46,.4),lintel*(1.-lod)); }
  } else if(st<4.5){ // apartments: stucco, balconies suggested by shade below each window
    win=grid(uv,bay,flr,vec2(.5,.56),id,f,lod); rough=.9; alb*=.86+.26*GRIME; litBias=.45; tint=vec3(.07,.085,.1);
    if(lod<.6){ alb*=1.-.3*smoothstep(.34,.32,abs(f.y+.36))*step(abs(f.x),.34); }
  } else if(st<5.5){ // corrugated metal, loading doors at grade
    rough=.58; metal=.45; float r=uv.x*5.; float w=fwidth(r); float fd=1.-smoothstep(.3,.9,w);
    alb*=1.+.12*fd*sin(r*6.283); if(vertical) N=normalize(N+vec3(.09*fd*cos(r*6.283))*vec3(1,0,1)*(1.-abs(N)));
    alb*=.84+.28*GRIME;
    if(vertical&&bay>4.){ vec2 q=vec2(fract(uv.x/bay)-.5,uv.y); float door=smoothstep(.2,.19,abs(q.x))*step(q.y,4.2);
      alb=mix(alb,vec3(.13,.14,.15)*(.8+.2*sin(q.y*18.)),door); metal*=1.-door; }
  } else if(st<6.5){ // storefronts at grade, painted wall above
    if(uv.y<flr){ win=grid(uv+vec2(bay*.5,0.),bay,flr,vec2(.92,.72),id,f,lod); win*=step(uv.y,flr*.86); tint=vec3(.19,.17,.13); litBias=1.;
      float sign=smoothstep(flr*.84,flr*.86,uv.y); alb=mix(vec3(.25),vC*1.1,sign); glow+=vC*sign*.55*uNight; }
    else { vec2 a,b; float l; float w2=grid(uv,bay*.6,flr,vec2(.42,.5),a,b,l); win=w2; id=a; f=b; lod=l; alb=mix(vec3(.62,.58,.52),vC,.25)*(.85+.25*GRIME); }
    rough=.86;
  } else if(st<7.5){ // house siding
    win=grid(uv,bay,flr,vec2(.32,.48),id,f,lod); float l=uv.y*5.; float w=fwidth(l); alb*=1.-(.12*(1.-smoothstep(.3,.8,w)))*step(.8,fract(l));
    rough=.88; litBias=.4; tint=vec3(.05,.06,.075);
  } else if(st<8.5){ // flat roof membrane / gravel
    float n=fbm(uv*.35+seed*30.); float g=vnoise(uv*7.); alb*=(.68+.42*n+(.07*g))*(.42+.95*fract(seed*13.7)); rough=.95; ao*=.96;
    alb=mix(alb,alb*.72,smoothstep(.62,.8,fbm(uv*.09+seed*12.)));
  } else if(st<9.5){ // parking lot
    float n=fbm(uv*.6+seed*9.); alb=vec3(.052,.054,.058)*(.82+.45*n); rough=.92;
    vec2 q=vec2(uv.x/2.7,mod(uv.y,16.)); float w=fwidth(uv.x/2.7)*1.2; float fade=1.-smoothstep(.2,.8,w);
    float stripe=smoothstep(.035+w,.035,abs(fract(q.x)-.5))*(step(.4,q.y)*step(q.y,5.6)+step(10.4,q.y)*step(q.y,15.6));
    alb=mix(alb,vec3(.3,.3,.28),stripe*fade*.8);
  } else if(st<10.5){ // grass
    float n=fbm(vP.xz*.17); float g=vnoise(vP.xz*2.6); alb=mix(vec3(.105,.2,.055),vec3(.19,.29,.09),n)*(.86+.3*g); rough=1.;
  } else if(st<11.5){ // concrete paving
    alb*=.8+.3*fbm(vP.xz*.25+seed); vec2 q=vP.xz/4.; vec2 w=fwidth(q); vec2 d=abs(fract(q)-.5); float fade=1.-smoothstep(.15,.5,max(w.x,w.y));
    alb*=1.-.28*fade*(smoothstep(.49-w.x,.5,d.x)+smoothstep(.49-w.y,.5,d.y)); rough=.9;
  } else if(st<12.5){ // data center: insulated panels and louvre bands
    rough=.52; metal=.5; float l=uv.y/flr; float q=fract(l); float wv=fwidth(l); float fade=1.-smoothstep(.2,.7,wv);
    float pan=step(.965,fract(uv.x/3.)); alb*=1.-.3*pan*fade;
    float louv=step(.72,q)*step(q,.9); float lo=sin(uv.y*22.)*.5+.5; alb=mix(alb,vec3(.1,.11,.125)*(.6+.8*lo),louv*fade); alb=mix(alb,alb*.82,(1.-fade)*.18);
    alb*=.9+.18*GRIME;
  } else if(st<13.5){ // self-lit accent
    glow=vC*(.7+uNight*2.2+.25*sin(uTime*1.6+seed*9.)); alb=vC*.45; rough=.3;
  } else if(st<14.5){ // dirt
    float n=fbm(vP.xz*.28); alb=mix(vec3(.2,.145,.085),vec3(.34,.26,.17),n)*(.84+.3*vnoise(vP.xz*4.)); rough=1.;
  } else if(st<16.5){ // tinted vehicle / booth glass
    win=1.; tint=vec3(.03,.035,.04); litBias=0.; rough=.1; glassRough=.03;
  } else if(st<17.5){ // server racks with blinking LEDs
    alb=vec3(.035); rough=.5; vec2 q=vec2(uv.x*16.,uv.y*18.); vec2 cell=floor(q);
    float b=step(.5,fract(hash21(cell+seed)*7.+uTime*(.4+hash21(cell)*2.)))*smoothstep(.45,.2,length(fract(q)-.5));
    glow=vC*b*2.6;
  } else if(st<18.5){ // roof shingles
    float l=uv.y*3.; float w=fwidth(l); float fade=1.-smoothstep(.25,.8,w); alb*=1.-.25*fade*step(.82,fract(l)); alb*=.8+.35*fbm(uv*1.4+seed*8.); rough=.92;
  } else if(st<20.5){ // foliage
    float n=vnoise(vP.xz*.9+vP.y*.9+seed*11.)*.6+vnoise(vP.zy*2.6+seed)*.4;
    alb*=.5+.95*n; rough=1.; N=normalize(N+(vec3(n,n*.5,1.-n)-.5)*.75); ao*=.55+.5*smoothstep(0.,1.,vUV.y);
  } else if(st<21.5){ // car paint
    rough=.24; metal=.35;
  } else if(st<22.5){ // gravel
    float n=fbm(vP.xz*.5+seed); alb*=(.72+.5*n)*(.86+.28*vnoise(vP.xz*9.)); rough=1.;
  } else if(st<30.5){ // soft contact shadow on the ground
    float a=(1.-vUV.y); O=vec4(0.,0.,0.,a*a*.55*(1.-uNight*.4)); return;
  } else { // x-ray shell
    float e=max(abs(vUV.x),0.); vec3 c=mix(vec3(.3,.65,1.),vC,.5); float fr=pow(1.-max(dot(N,V),0.),2.);
    O=vec4(pow(c,vec3(.45))*(.5+fr),.12+fr*.3+e*0.); return;
  }
  float shd; vec3 c;
  if(win>.001){
    // each pane is very slightly out of plane, which is what makes real glass towers shimmer
    float hsh=hash21(id+seed*17.); float hs2=hash21(id.yx+seed*5.+3.);
    if(vertical&&lod<.9) winN=normalize(N+(vec3(hsh,hs2,1.-hsh)-.5)*.009*(1.-lod));
    vec3 R=reflect(-V,winN);
    float F=.05+.95*pow(1.-max(dot(winN,V),0.),5.);
    float rflK=st<1.5?1.:.72;
    vec3 refl=envRefl(R,vP);
    float ndl=max(dot(N,uSunDir),0.); float sh=shadowAt(vP+N*.55,ndl);
    float sunSpec=pow(max(dot(R,uSunDir),0.),400.)*8.*sh+pow(max(dot(R,uSunDir),0.),24.)*.14*sh;
    // interior: curtains and depth visible through the glass
    vec3 interior=tint*(.55+.7*hs2)*(uAmbient*.9+.08);
    float blind=step(.72,hsh)*smoothstep(.1,.5,f.y+.1+hs2*.25); interior=mix(interior,vec3(.42,.4,.36)*(uAmbient+.12),blind*.55*(1.-lod));
    vec3 g=interior+refl*(F*rflK+.1*rflK+(st<1.5?.22:.06))+uSunCol*sunSpec;
    // lit rooms after dark
    float night=smoothstep(.08,.55,uNight);
    float bldg=.35+1.1*fract(seed*7.31);
    float on=mix(step(hash21(id*vec2(1.3,.7)+seed*23.),litBias*bldg*.62),litBias*bldg*.62,lod);
    vec3 room=mix(vec3(1.,.74,.42),vec3(.75,.86,1.),step(.82,hs2))*(.5+.8*hsh);
    room*=mix(.45+.55*smoothstep(.5,-.2,f.y),.8,lod);
    g+=room*on*night*.72;
    vec3 wall=light(alb,N,V,vP,rough,metal,ao,shd);
    c=mix(wall,g*ao,win);
  } else {
    c=light(alb,N,V,vP,rough,metal,ao,shd);
  }
  c+=glow;
  O=vec4(finish(c,vP),1.);
}`;

export const SHADOW_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aP;
#ifdef INST
layout(location=6) in vec4 iPS; layout(location=7) in vec4 iRC;
#endif
uniform mat4 uSunVP;
void main(){ vec3 p=aP;
#ifdef INST
  float cs=cos(iRC.x),sn=sin(iRC.x); p=vec3(p.x*cs-p.z*sn,p.y,p.x*sn+p.z*cs)*iPS.w+iPS.xyz;
#endif
  gl_Position=uSunVP*vec4(p,1.); }`;
export const SHADOW_FS = `#version 300 es
precision mediump float; void main(){}`;

// Roads, sidewalks and crosswalks are computed per pixel from the city's street grid.
export const GROUND_VS = /* glsl */ `#version 300 es
precision highp float; layout(location=0) in vec3 aP; uniform mat4 uVP; out vec3 vP;
void main(){ vP=aP; gl_Position=uVP*vec4(aP,1.); }`;
export const GROUND_FS = /* glsl */ `#version 300 es
${COMMON}
in vec3 vP; out vec4 O; uniform vec2 uGrid; uniform float uSt;
// distance to the nearest street centre line
vec2 streetUV(vec2 p,float period,float off){ float q=(p.x-off)/period; float k=floor(q+.5); return vec2(p.x-off-k*period,k); }
void main(){
  vec2 p=vP.xz; float seed=hash21(floor(p/40.));
  vec2 sx=streetUV(p,uGrid.x,uSt*.5); vec2 sz=streetUV(p.yx,uGrid.y,uSt*.5);
  float dx=abs(sx.x), dz=abs(sz.x);
  float RH=11., WALK=17.;
  float wx=fwidth(p.x)+fwidth(p.y);
  float onX=step(dx,RH), onZ=step(dz,RH); float road=max(onX,onZ);
  float n=fbm(p*.11), n2=vnoise(p*1.6), n3=vnoise(p*9.);
  vec3 asphalt=vec3(.05,.052,.056)*(.78+.42*n+.14*n2+.1*n3);
  // tar seams, patches and worn wheel paths
  asphalt=mix(asphalt,asphalt*.72,smoothstep(.62,.66,fbm(p*.045+5.))*.55);
  float lane=onX>onZ?dx:dz; asphalt*=1.+.14*smoothstep(1.2,.3,abs(lane-2.8))+.14*smoothstep(1.2,.3,abs(lane-8.2));
  vec3 walkC=vec3(.21,.205,.19);
  vec2 tile=fract(p/2.4); vec2 tw=fwidth(p/2.4); float tfade=1.-smoothstep(.12,.45,max(tw.x,tw.y));
  float joint=smoothstep(.96,1.,max(tile.x,tile.y))*tfade;
  vec3 walk=walkC*(.8+.3*n+.08*n3)*(1.-.28*joint);
  vec3 lotC=vec3(.15,.145,.135)*(.8+.3*n);
  vec3 alb=lotC; float rough=.95;
  float walkMask=max(step(dx,WALK),step(dz,WALK));
  alb=mix(alb,walk,walkMask);
  float curb=max(smoothstep(RH+.45+wx,RH+.42,dx)*step(RH,dx),smoothstep(RH+.45+wx,RH+.42,dz)*step(RH,dz));
  alb=mix(alb,vec3(.3,.295,.28),curb);
  if(road>.5){
    alb=asphalt; rough=.86;
    float inter=onX*onZ;
    float fade=1.-smoothstep(.08,.45,wx);
    // markings along the x-running street
    vec3 yellow=vec3(.5,.33,.05), white=vec3(.5,.5,.48);
    float mk=0.; vec3 mkC=white;
    if(inter<.5){
      float d=onX>.5?dx:dz; float along=onX>.5?p.y:p.x; float sd=onX>.5?sx.x:sz.x;
      float cl=smoothstep(.34+wx,.34,abs(d-.3)); if(cl>0.){ mk=cl; mkC=yellow; }
      float dash=smoothstep(.12+wx,.12,abs(d-5.5))*step(.55,fract(along/9.)); mk=max(mk,dash);
      float edge=smoothstep(.1+wx,.1,abs(d-10.3))*(1.-.0); mk=max(mk,edge*.8);
      // stop bars and zebra crossings just before each junction
      float toJ=onX>.5?dz:dx;
      if(toJ>RH&&toJ<RH+7.5){
        float k=toJ-RH;
        float zebra=step(1.2,k)*step(k,5.6)*step(.5,fract(sd/1.8));
        float bar=step(6.1,k)*step(k,6.8)*step(0.,sd*(onX>.5?sign(sz.x):sign(sx.x)));
        mk=max(mk,zebra*.92); mk=max(mk,bar*.9); if(zebra+bar>0.) mkC=white;
      }
    }
    float wear=.62+.38*vnoise(p*.9);
    alb=mix(alb,mkC*wear,clamp(mk,0.,1.)*fade);
  }
  vec3 N=vec3(0,1,0),V=normalize(uCam-vP); float sh;
  vec3 c=light(alb,N,V,vP,rough,0.,1.,sh);
  // pools of street light after dark
  if(uNight>.05){
    float lx=mod(p.y,28.)-14., lz=mod(p.x,28.)-14.;
    float g=exp(-((dx-WALK+3.)*(dx-WALK+3.)+lx*lx)/42.)+exp(-((dz-WALK+3.)*(dz-WALK+3.)+lz*lz)/42.);
    c+=vec3(1.,.76,.46)*g*uNight*alb*3.;
  }
  O=vec4(finish(c,vP),1.);
}`;

export const SKY_VS = /* glsl */ `#version 300 es
precision highp float; uniform mat4 uInvVP; out vec3 vD; uniform vec3 uCamS;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.; gl_Position=vec4(p,.9999,1.);
  vec4 w=uInvVP*vec4(p,1.,1.); vD=w.xyz/w.w-uCamS; }`;
export const SKY_FS = /* glsl */ `#version 300 es
${COMMON}
in vec3 vD; out vec4 O;
void main(){
  vec3 d=normalize(vD); vec3 c=skyAt(d);
  float s=max(dot(d,uSunDir),0.);
  c+=uSunCol*(smoothstep(.9995,.9998,s)*mix(14.,3.,uNight));
  if(d.y>0.){
    vec2 q=d.xz/(d.y+.14)*1.6+vec2(uTime*.004,0.);
    float cl=smoothstep(.5,.82,fbm(q)*.72+fbm(q*2.6+3.)*.34);
    vec3 cc=mix(uSkyHor*1.1+uSunCol*.28,vec3(1.)*(.25+uAmbient*.9),.55)*(1.-uNight*.92);
    c=mix(c,cc,cl*smoothstep(.0,.22,d.y)*.78);
    if(uNight>.2){ vec2 g=floor(d.xz/(d.y+.3)*520.); float st=step(.9982,hash21(g)); c+=vec3(.9,.95,1.)*st*uNight*(.5+.5*sin(uTime+hash21(g.yx)*30.)); }
  }
  c*=.86; c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);
  O=vec4(pow(c,vec3(1./2.2)),1.);
}`;

export const POINT_VS = /* glsl */ `#version 300 es
precision highp float; layout(location=0) in vec3 aP; layout(location=1) in vec4 aC; layout(location=2) in float aS;
uniform mat4 uVP; uniform float uPx; out vec4 vC;
void main(){ vC=aC; gl_Position=uVP*vec4(aP,1.); gl_PointSize=clamp(aS*uPx/gl_Position.w,1.5,46.); }`;
export const POINT_FS = /* glsl */ `#version 300 es
precision mediump float; in vec4 vC; out vec4 O;
void main(){ float d=length(gl_PointCoord-.5)*2.; float a=pow(max(1.-d,0.),2.2); O=vec4(vC.rgb,1.)*vC.a*a; }`;

export const LINE_VS = /* glsl */ `#version 300 es
precision highp float; layout(location=0) in vec3 aP; layout(location=1) in vec4 aC; uniform mat4 uVP; out vec4 vC;
void main(){ vC=aC; gl_Position=uVP*vec4(aP,1.); }`;
export const LINE_FS = /* glsl */ `#version 300 es
precision mediump float; in vec4 vC; out vec4 O; uniform float uPulse;
void main(){ O=vec4(vC.rgb,vC.a*uPulse); }`;
