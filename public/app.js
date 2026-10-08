(function(){
'use strict';
const {h,$,TYPE,TYPES,ROLES,ST,num,fmtD,range} = L;
let F={}, CAL=null, SIG=null, busy=false, dutyMult=2, ME=null, BAL=null;
const isDuty=()=>ME&&ME.role==='당직경비';
const calcFor=(s,e)=>L.calcDays(s,e,isDuty())*(isDuty()?dutyMult:1);

/* ---- 달력 ---- */
function buildCal(){
  let view = new Date(); view.setDate(1); let picking=false;
  const box = h('div',{class:'cal'});
  function pick(s){
    const half = TYPE[F.type.value].half;
    if(half || !picking){ F.start.value=s; F.end.value=s; picking=!half; }
    else { if(s<F.start.value){ F.end.value=F.start.value; F.start.value=s; } else F.end.value=s; picking=false; }
    F.recalc();
  }
  function draw(){
    box.replaceChildren();
    const y=view.getFullYear(), m=view.getMonth();
    const first=new Date(y,m,1).getDay(), last=new Date(y,m+1,0).getDate(), td=L.todayStr();
    const a=F.start.value, b=F.end.value;
    const g=h('div',{class:'g'}, L.DOW.map((w,i)=>h('div',{class:'w'+(i===0?' su':i===6?' sa':'')},w)));
    for(let i=0;i<first;i++) g.append(h('div'));
    for(let d=1; d<=last; d++){
      const dt=new Date(y,m,d), s=L.ymd(dt), w=dt.getDay(); let c='d';
      if(w===0)c+=' su'; if(w===6)c+=' sa'; if(L.hol.has(s))c+=' hol'; if(s===td)c+=' td';
      if(a&&b&&s>a&&s<b)c+=' in'; if(s===a)c+=' s'; if(s===b)c+=' e';
      g.append(h('button',{type:'button',class:c,onclick:()=>pick(s)},d));
    }
    const msg=!a?'시작일을 누르세요.':(picking?'종료일을 누르세요. (하루만이면 그대로 두세요)':'다른 기간으로 바꾸려면 날짜를 다시 누르세요.');
    box.append(
      h('div',{class:'hd'},
        h('button',{type:'button','aria-label':'이전 달',onclick:()=>{view=new Date(y,m-1,1);draw();}},'‹'),
        h('b',null,`${y}년 ${m+1}월`),
        h('button',{type:'button','aria-label':'다음 달',onclick:()=>{view=new Date(y,m+1,1);draw();}},'›')),
      g,
      h('div',{class:'st'},h('span',null,msg),h('button',{type:'button',onclick:()=>{F.start.value='';F.end.value='';picking=false;F.recalc();}},'선택 초기화')));
  }
  box.redraw=(jump)=>{ if(jump&&F.start.value){ const d=L.parse(F.start.value); view=new Date(d.getFullYear(),d.getMonth(),1);} draw(); };
  box.resetPick=()=>{picking=false;};
  draw(); return box;
}

/* ---- 서명 ---- */
function buildSig(){
  const cv=h('canvas',{width:480,height:168});
  const ph=h('div',{class:'ph'},'여기에 손가락이나 마우스로 서명하세요');
  const box=h('div',{class:'sigbox'},cv,ph);
  const ctx=cv.getContext('2d'); ctx.lineWidth=3.2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#111';
  let drawing=false,dirty=false,last=null,pts=0;
  const pos=e=>{const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*cv.width/r.width,y:(e.clientY-r.top)*cv.height/r.height};};
  cv.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;last=pos(e);cv.setPointerCapture?.(e.pointerId);ctx.beginPath();ctx.arc(last.x,last.y,1.6,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();dirty=true;pts++;ph.classList.add('hide');});
  cv.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;pts++;});
  const end=()=>{drawing=false;}; cv.addEventListener('pointerup',end); cv.addEventListener('pointercancel',end); cv.addEventListener('pointerleave',end);
  return { el:box, clear(){ctx.clearRect(0,0,cv.width,cv.height);dirty=false;pts=0;ph.classList.remove('hide');}, isEmpty:()=>!dirty||pts<6, png:()=>cv.toDataURL('image/png') };
}

/* ---- 로그인 / 가입 ---- */
function renderLogin(msg){
  ME=null; BAL=null;
  const name=h('input',{type:'text',autocomplete:'name',placeholder:'홍길동'});
  const phone=h('input',{type:'tel',inputmode:'numeric',autocomplete:'tel',placeholder:'010-0000-0000'});
  const pw=h('input',{type:'password',autocomplete:'current-password',placeholder:'처음이면 비워두세요'});
  const err=h('p',{class:'err'},msg||'');
  const go=async()=>{
    err.textContent=''; btn.disabled=true;
    try{
      const r=await L.api('/api/worker/login',{body:{name:name.value,phone:phone.value,password:pw.value}});
      if(r.needSetup) return renderSetup(name.value,phone.value,r);
      await enter();
    }catch(e){ err.textContent=e.message; btn.disabled=false; }
  };
  const btn=h('button',{class:'btn block',onclick:go},'로그인');
  for(const i of [name,phone,pw]) i.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  $('#main').replaceChildren(h('div',{class:'card login'},
    h('h2',null,'근무자 로그인'),
    h('div',{class:'sub',style:'margin:-6px 0 12px'},'인사 명단에 등록된 이름과 전화번호로 확인합니다. 처음 접속하면 비밀번호를 만드는 화면으로 넘어갑니다.'),
    L.fld('이름',name),L.fld('전화번호',phone),L.fld('비밀번호',pw,{hint:'비밀번호를 잊었다면 관리자에게 초기화를 요청하세요.'}),err,btn));
  name.focus();
}
function renderSetup(name,phone,info){
  const site=h('input',{type:'text',maxlength:40,placeholder:'예: ○○초등학교'});
  const role=h('select',null,h('option',{value:''},'선택하세요'),ROLES.map(r=>h('option',{value:r},r)));
  const pw=h('input',{type:'password',autocomplete:'new-password'}), pw2=h('input',{type:'password',autocomplete:'new-password'});
  const err=h('p',{class:'err'});
  const go=async()=>{
    err.textContent=''; if(pw.value!==pw2.value){ err.textContent='비밀번호 확인이 일치하지 않습니다.'; return; }
    btn.disabled=true;
    try{ await L.api('/api/worker/setup',{body:{name,phone,password:pw.value,site:site.value,role:role.value}}); await enter(); }
    catch(e){ err.textContent=e.message; btn.disabled=false; }
  };
  const btn=h('button',{class:'btn block',onclick:go},'비밀번호 만들고 시작하기');
  $('#main').replaceChildren(h('div',{class:'card login'},
    h('h2',null,`${info.name||name}님, 처음 오셨네요`),
    h('div',{class:'sub',style:'margin:-6px 0 12px'},'명단 확인이 완료되었습니다. 앞으로 사용할 비밀번호를 만들어 주세요.'),
    info.site?L.fld('근무지',h('input',{type:'text',value:info.site,readonly:true})):L.fld('근무지 (학교·기관명)',site,{req:1}),
    info.role?L.fld('직무',h('input',{type:'text',value:info.role,readonly:true})):L.fld('직무',role,{req:1}),
    L.fld('새 비밀번호',pw,{req:1,hint:'6자 이상. 전화번호가 들어간 비밀번호는 사용할 수 없습니다.'}),L.fld('새 비밀번호 확인',pw2,{req:1}),err,btn,
    h('button',{class:'btn ghost block',style:'margin-top:8px',onclick:()=>renderLogin()},'뒤로')));
}

/* ---- 로그인 후 화면 ---- */
async function enter(){
  const r=await L.api('/api/worker/me'); ME=r.me; BAL=r.balance;
  $('#main').replaceChildren(h('div',{class:'card',id:'who'}),h('div',{class:'card',id:'bal'}),buildForm(),h('div',{class:'card',id:'mine'}));
  renderWho(); renderBal(); loadMine();
}
function renderWho(){
  $('#who').replaceChildren(h('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px'},
    h('div',null,h('div',{style:'font-weight:700;font-size:16px'},ME.name+'님'),h('div',{class:'sub'},`${ME.site||'-'} · ${ME.role||'-'}`)),
    h('div',{style:'display:flex;gap:6px'},
      h('button',{class:'btn ghost sm',onclick:changePw},'비밀번호 변경'),
      h('button',{class:'btn ghost sm',onclick:async()=>{ try{await L.api('/api/worker/logout',{body:{}});}catch(e){} renderLogin(); }},'로그아웃'))));
}
function changePw(){
  const c=h('input',{type:'password',autocomplete:'current-password'}), n=h('input',{type:'password',autocomplete:'new-password'}), n2=h('input',{type:'password',autocomplete:'new-password'});
  L.openModal({title:'비밀번호 변경',body:h('div',null,L.fld('현재 비밀번호',c),L.fld('새 비밀번호',n,{hint:'6자 이상'}),L.fld('새 비밀번호 확인',n2)),okLabel:'변경',
    onOk:async()=>{ if(n.value!==n2.value) return '새 비밀번호가 서로 다릅니다.'; await L.api('/api/worker/password',{body:{current:c.value,next:n.value}}); L.toast('비밀번호를 변경했습니다'); return true; }});
}
function renderBal(){
  const box=$('#bal'); if(!box) return; const b=BAL; box.replaceChildren(h('h2',null,'내 연차 현황'));
  if(b.total==null){ box.append(h('div',{class:'empty',style:'padding:6px 0 8px'},'부여 연차 일수가 아직 등록되지 않았습니다.\n관리자가 등록하면 잔여 일수가 표시됩니다.'),h('div',{class:'legend'},`승인 ${num(b.ap)}일 · 대기 ${num(b.pe)}일`)); return; }
  const pct=x=>Math.max(0,Math.min(100,x/(b.total||1)*100));
  box.append(
    h('div',{class:'bal'},h('div',{class:'big'},num(Math.max(b.rem,0)),h('small',null,'일 남음')),h('div',{class:'sub',style:'text-align:right'},`총 ${num(b.total)}일 부여`)),
    h('div',{class:'bar'},h('i',{class:'u',style:`width:${pct(b.used_before+b.ap)}%`}),h('i',{class:'p',style:`width:${pct(b.pe)}%`})),
    h('div',{class:'legend'},h('span',null,`사용(승인) ${num(b.used_before+b.ap)}일`+(b.used_before?` (이전 ${num(b.used_before)}일 포함)`:'')),h('span',null,`승인 대기 ${num(b.pe)}일`)),
    b.rem<0?h('div',{class:'conf'},'부여 일수를 초과했습니다. 관리자에게 확인하세요.'):null);
}

/* ---- 신청 폼 ---- */
function buildForm(){
  const today=L.todayStr();
  F.type=h('select',null);
  const fillTypes=()=>{ const cur=F.type.value; F.type.replaceChildren(...TYPES.filter(t=>!(isDuty()&&t.half)).map(t=>h('option',{value:t.k},t.k))); if([...F.type.options].some(o=>o.value===cur)) F.type.value=cur; };
  F.start=h('input',{type:'date'}); F.end=h('input',{type:'date'});
  F.days=h('input',{type:'text',readonly:true,tabindex:'-1'});
  F.reason=h('input',{type:'text',maxlength:100});
  F.typeHint=h('small',null); F.dateHint=h('small',null); F.dayHint=h('small',null);
  F.err=h('p',{class:'err'});
  F.btn=h('button',{class:'btn block',onclick:submit},'서명하고 신청하기');
  CAL=buildCal(); SIG=buildSig(); fillTypes();
  F.recalc=()=>{
    const t=TYPE[F.type.value]; F.end.min=F.start.value||'';
    if(t.half){ F.end.value=F.start.value; F.end.disabled=true; F.days.value=F.start.value?'0.5일':''; }
    else {
      F.end.disabled=false;
      if(F.start.value&&F.end.value&&F.end.value<F.start.value) F.end.value=F.start.value;
      const n=calcFor(F.start.value,F.end.value);
      F.days.value=(F.start.value&&F.end.value)?(n?n+'일':'0일 (모두 휴일)'):'';
    }
    F.typeHint.textContent=t.hint;
    if(F.type.value==='경조사휴가'){ if(F.reason.readOnly) F.reason.value=''; F.reason.readOnly=false; F.reason.placeholder='예: 본인 결혼, 부친상 (필수)'; }
    else { F.reason.value='개인사정'; F.reason.readOnly=true; }
    F.dayHint.textContent=isDuty()?`당직경비는 선택한 날짜(출근일) 1회마다 ${dutyMult}일이 차감됩니다. 토·일·공휴일도 포함해 계산합니다.`:'토·일·공휴일은 제외하고 계산합니다.';
    const late=F.start.value&&F.start.value<today;
    F.dateHint.textContent=late?'지난 날짜입니다. 사후 신청으로 접수됩니다.':''; F.dateHint.style.color=late?'var(--warn)':'';
    CAL.redraw(false);
  };
  F.start.addEventListener('change',()=>{ if(!F.end.value||F.end.value<F.start.value)F.end.value=F.start.value; CAL.resetPick(); F.recalc(); CAL.redraw(true); });
  F.end.addEventListener('change',()=>{CAL.resetPick();F.recalc();});
  F.type.addEventListener('change',()=>{CAL.resetPick();F.recalc();});
  const card=h('div',{class:'card'},
    h('h2',null,'연차 신청'),
    L.fld('휴가 종류',F.type,{req:1}), F.typeHint,
    h('div',{style:'height:10px'}),
    h('div',{class:'sub',style:'margin-bottom:4px;font-weight:500'},'기간 선택 *'),
    CAL,
    h('div',{class:'grid2'},L.fld('시작일',F.start),L.fld('종료일',F.end)), F.dateHint,
    L.fld('사용 일수',F.days), F.dayHint,
    h('div',{style:'height:10px'}),
    L.fld('사유',F.reason,{req:1}),
    h('div',{class:'fld'},h('span',null,'서명 ',h('b',null,'*')),SIG.el,
      h('div',{class:'sigbar'},h('small',{style:'color:var(--mute);font-size:12px'},'신청서에 인쇄되는 본인 서명입니다.'),
        h('button',{type:'button',class:'btn ghost sm',onclick:()=>SIG.clear()},'지우기'))),
    F.err, F.btn);
  F.recalc(); return card;
}

async function submit(){
  if(busy) return; F.err.textContent='';
  const t=TYPE[F.type.value];
  const days=t.half?0.5:calcFor(F.start.value,F.end.value);
  const v={type:F.type.value,start:F.start.value,end:t.half?F.start.value:F.end.value};
  const e=[];
  if(!v.start||!v.end)e.push('달력에서 기간을 선택하세요.');
  else if(v.end<v.start)e.push('종료일이 시작일보다 빠릅니다.');
  else if(!(days>0))e.push('선택한 기간이 모두 휴일이라 신청할 일수가 없습니다.');
  if(F.type.value==='경조사휴가'&&!F.reason.value.trim())e.push('경조사휴가는 사유를 직접 작성해야 합니다.');
  if(SIG.isEmpty())e.push('서명란에 서명해 주세요.');
  if(e.length){F.err.textContent=e.join('\n');return;}
  busy=true; F.btn.disabled=true;
  try{
    const r=await L.api('/api/apply',{body:{...v,reason:F.type.value==='경조사휴가'?F.reason.value.trim():'개인사정',sig:SIG.png()}});
    L.toast(`신청이 접수되었습니다 (${num(r.days)}일)`);
    F.start.value='';F.end.value='';F.type.value='연차';CAL.resetPick();F.recalc();SIG.clear();
    await refresh();
  }catch(x){ if(x.status===401){ renderLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); } else F.err.textContent=x.message; }
  busy=false; F.btn.disabled=false;
}
async function refresh(){ try{ const r=await L.api('/api/worker/me'); BAL=r.balance; renderBal(); }catch(e){} await loadMine(); }

/* ---- 내 신청 내역 (본인 건만) ---- */
async function loadMine(){
  const box=$('#mine'); if(!box) return;
  box.replaceChildren(h('h2',null,'내 신청 내역'));
  let items=[]; try{ items=(await L.api('/api/worker/requests')).items; }catch(e){ if(e.status===401) return renderLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); box.append(h('div',{class:'err'},'내역을 불러오지 못했습니다.')); return; }
  if(!items.length){ box.append(h('div',{class:'empty'},'아직 신청 내역이 없습니다.')); return; }
  for(const it of items){
    const s=it.status, cp=s==='approved'&&it.cancel_req&&!it.cancel_denied, acts=[];
    if(s==='pending')acts.push(h('button',{class:'btn ghost sm',onclick:()=>act(it,'withdraw')},'신청 철회'));
    if(s==='approved'&&!it.cancel_req)acts.push(h('button',{class:'btn ghost sm',onclick:()=>act(it,'cancel-request')},'취소 요청'));
    box.append(h('div',{class:'item'},
      h('div',{class:'top'},
        h('div',null,h('div',{class:'t'},`${it.type} ${num(it.days)}일`),h('div',{class:'d'},range(it.start_date,it.end_date))),
        h('div',null,h('span',{class:'badge '+ST[s][1]},ST[s][0]),cp?h('span',{class:'badge warn',style:'margin-left:4px'},'취소요청 중'):null)),
      it.late?h('div',{class:'n'},h('span',{class:'badge warn'},'사후 신청')):null,
      it.reason&&it.reason!=='개인사정'?h('div',{class:'n'},h('em',null,'사유 '),it.reason):null,
      s==='rejected'&&it.note?h('div',{class:'n'},h('em',null,'반려 사유 '),it.note):null,
      it.cancel_req&&it.cancel_denied&&it.note?h('div',{class:'n'},h('em',null,'취소 요청 반려 '),it.note):null,
      acts.length?h('div',{class:'acts'},acts):null));
  }
}
async function act(it,kind){
  const w=kind==='withdraw';
  if(!(await L.ask(w?'신청 철회':'취소 요청',(w?'승인 전 신청을 철회할까요?\n':'이미 승인된 휴가입니다. 관리자에게 취소를 요청할까요?\n관리자가 처리해야 취소됩니다.\n')+it.type+' '+range(it.start_date,it.end_date),w?'철회':'취소 요청',w?'bad':'')))return;
  try{ await L.api('/api/'+kind,{body:{id:it.id}}); L.toast(w?'철회했습니다':'취소를 요청했습니다'); await refresh(); }catch(e){ L.toast(e.message); }
}

/* ---- 관리자 로그인 버튼 (우상단) ---- */
async function setupLogin(){
  const btn=$('#loginBtn'); if(!btn) return;
  let admin=null; try{ admin=(await L.api('/api/session')).admin; }catch(e){}
  if(admin){ btn.textContent='관리자 화면'; btn.onclick=()=>{location.href='/admin';}; return; }
  btn.textContent='관리자 로그인';
  btn.onclick=()=>{
    const u=h('input',{type:'text',autocomplete:'username',autocapitalize:'none',placeholder:'아이디'});
    const p=h('input',{type:'password',autocomplete:'current-password',placeholder:'비밀번호'});
    L.openModal({title:'관리자 로그인',msg:'승인·반려 등 관리자 기능은 로그인 후에만 사용할 수 있습니다.',body:h('div',null,L.fld('아이디',u),L.fld('비밀번호',p)),okLabel:'로그인',
      onOk:async()=>{ await L.api('/api/admin/login',{body:{username:u.value,password:p.value}}); location.href='/admin'; return new Promise(()=>{}); }});
    setTimeout(()=>u.focus(),50);
  };
}

(async function boot(){
  try{ const c=await L.api('/api/config'); L.hol=new Set(c.holidays||[]); dutyMult=c.dutyMult||2; }
  catch(e){ $('#banner').append(h('div',{class:'banner bad'},'서버에 연결하지 못했습니다. 잠시 후 새로고침하세요.')); }
  setupLogin();
  try{ await enter(); }catch(e){ renderLogin(); }
})();
})();
