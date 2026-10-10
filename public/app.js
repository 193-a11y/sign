(function(){
'use strict';
const {h,$,TYPE,TYPES,ROLES,num,fmtD,range} = L;
let F={}, CAL=null, SIG=null, busy=false, dutyMult=2, SCHOOLS=[], CUR=null;
const isDuty=()=>F.job&&F.job.value==='당직경비';
const addDays=(s,n)=>{ const d=L.parse(s); d.setDate(d.getDate()+n); return L.ymd(d); };
const diffDays=(a,b)=>Math.round((L.parse(b)-L.parse(a))/86400000);
// 당직경비: 격일 근무. 시작일부터 이틀 간격이 출근일, 마지막 출근일 다음 날 아침이 퇴근.
const shiftDates=(s,e)=>{ if(!s||!e||e<s) return []; const n=Math.floor(diffDays(s,e)/2)+1; return Array.from({length:n},(_,i)=>addDays(s,2*i)); };
const calcFor=(s,e)=>isDuty()?shiftDates(s,e).length*dutyMult:L.calcDays(s,e,false);
const store={ get(){ try{ return JSON.parse(localStorage.getItem('lv_me')||'{}'); }catch(e){ return {}; } }, set(v){ try{ localStorage.setItem('lv_me',JSON.stringify(v)); }catch(e){} } };
const fmtPhone=s=>{ const d=String(s).replace(/\D/g,''); if(d.startsWith('02')) return d.length===9?`${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}`:`${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`; return d.length===10?`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`:d.length===11?`${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`:s; };
const validPhone=s=>/^0\d{8,10}$/.test(String(s).replace(/\D/g,''));

/* ---- 달력 ---- */
function buildCal(){
  let view = new Date(); view.setDate(1); let picking=false;
  const box = h('div',{class:'cal'});
  function pick(s){
    const half = TYPE[F.type].half;
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
      if(a&&b&&s>a&&s<b)c+=' in'; if(s===a)c+=' s'; if(s===b)c+=' e'; if(isDuty()&&a&&b&&shiftDates(a,b).includes(s))c+=' sh';
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


/* ---- 근무지 검색 선택 ---- */
function buildSchool(){
  const inp=h('input',{type:'text',maxlength:80,placeholder:'학교 이름을 검색해서 선택',autocomplete:'off',role:'combobox','aria-expanded':'false'});
  const list=h('div',{class:'sugg hide',role:'listbox'});
  const box=h('div',{class:'combo'},inp,h('span',{class:'chev','aria-hidden':'true'},'▾'),list);
  let picked='';
  const close=()=>{ list.classList.add('hide'); inp.setAttribute('aria-expanded','false'); };
  const open=()=>{
    const q=L.norm(inp.value); list.replaceChildren();
    const res=SCHOOLS.filter(s=>L.norm(s).includes(q)).slice(0,40);
    for(const s of res) list.append(h('button',{type:'button',role:'option',onclick:()=>{ inp.value=s; picked=s; close(); }},s));
    if(!res.length) list.append(h('div',{class:'none'},SCHOOLS.length?'일치하는 근무지가 없습니다.':'등록된 근무지가 없습니다. 관리자에게 문의하세요.'));
    list.classList.remove('hide'); inp.setAttribute('aria-expanded','true');
  };
  inp.addEventListener('input',()=>{ picked=''; open(); });
  inp.addEventListener('focus',open); inp.addEventListener('click',open);
  inp.addEventListener('keydown',e=>{ if(e.key==='Escape')close(); });
  document.addEventListener('click',e=>{ if(!box.contains(e.target))close(); });
  box.get=()=>picked; box.set=v=>{ inp.value=v; picked=SCHOOLS.includes(v)?v:''; if(!picked)inp.value=''; };
  return box;
}
function choice(name,items,onchange){
  const wrap=h('div',{class:'choice'+(items.length===3?' c3':'')}); let val='';
  const draw=()=>wrap.replaceChildren(...items.map(k=>h('button',{type:'button',class:'opt'+(val===k?' on':''),'aria-pressed':val===k,onclick:()=>{ val=k; draw(); onchange&&onchange(k); }},k)));
  wrap.get=()=>val; wrap.set=v=>{ val=v; draw(); }; draw(); return wrap;
}

/* ---- 신청 폼 ---- */
function buildForm(){
  const today=L.todayStr(), me=store.get();
  F.school=buildSchool(); F.name=h('input',{type:'text',maxlength:30,autocomplete:'name',placeholder:'예: 홍길동'});
  F.phone=h('input',{type:'tel',inputmode:'tel',autocomplete:'tel',maxlength:15,placeholder:'예: 010-1234-5678'});
  F.phone.addEventListener('blur',()=>{ if(validPhone(F.phone.value)) F.phone.value=fmtPhone(F.phone.value); });
  const jobC=choice('job',ROLES,()=>{ F.job.value=jobC.get(); fillTypes(); F.recalc(); });
  F.job={value:'',get value(){return jobC.get();},set value(v){jobC.set(v);}};
  const typeC=choice('type',TYPES.map(t=>t.k),k=>{ F.type=k; CAL.resetPick(); F.recalc(); });
  F.type='연차'; typeC.set('연차');
  const fillTypes=()=>{ if(isDuty()&&TYPE[F.type].half){ F.type='연차'; typeC.set('연차'); } };
  F.start=h('input',{type:'text',readonly:true,placeholder:'달력에서 선택'}); F.end=h('input',{type:'text',readonly:true,placeholder:'달력에서 선택'});
  F.days=h('div',{class:'daysbox'},'날짜를 선택해 주세요');
  F.reason=h('input',{type:'text',maxlength:100,placeholder:'예: 본인 결혼, 부친상'});
  F.notes=h('input',{type:'text',maxlength:120,placeholder:'예: 오전 9시~오후 1시 (선택)'});
  F.reasonBox=h('div',{class:'fld hide'},h('span',null,'경조사 사유 ',h('b',null,'*')),F.reason);
  F.typeHint=h('p',{class:'hint'}); F.dayHint=h('p',{class:'hint'}); F.dateHint=h('p',{class:'hint warn'});
  F.err=h('p',{class:'err',role:'alert'});
  F.hp=h('input',{type:'text',name:'website',tabindex:'-1',autocomplete:'off','aria-hidden':'true'});
  CAL=buildCal(); SIG=buildSig();
  F.recalc=()=>{
    const t=TYPE[F.type];
    if(t.half){ F.end.value=F.start.value; }
    if(isDuty()&&!t.half&&F.start.value&&F.end.value){ const sh=shiftDates(F.start.value,F.end.value); if(sh.length) F.end.value=addDays(sh[sh.length-1],1); }   // 퇴근일로 자동 보정
    const n=(F.start.value&&F.end.value)?(t.half?0.5:calcFor(F.start.value,F.end.value)):null;
    F.days.replaceChildren(n==null?(isDuty()?'출근일을 선택해 주세요':'날짜를 선택해 주세요'):h('span',null,'신청 일수 ',h('strong',null,n?num(n)+'일':'0일 (모두 휴일)')),(n&&isDuty())?h('div',{class:'dutyline'},`${L.fmtD(F.start.value)} 오후 출근 ~ ${L.fmtD(F.end.value)} 오전 퇴근`,h('br'),`출근일: ${shiftDates(F.start.value,F.end.value).map(x=>L.parse(x).getDate()+'일').join(', ')} (${n/dutyMult}회)`):null);
    const pl=document.getElementById('perLbl'); if(pl&&pl.firstChild) pl.firstChild.textContent=isDuty()?'기간 선택 (첫 출근일 ~ 마지막 퇴근일) ':'기간 선택 ';
    F.typeHint.textContent=t.half?'반차는 하루만 선택합니다. 시간은 아래 전달사항에 적어 주세요.':'';
    F.reasonBox.classList.toggle('hide',F.type!=='경조사휴가');
    F.dayHint.textContent=isDuty()?`당직경비는 첫 출근일부터 마지막 퇴근일(또는 마지막 출근일)까지 선택하세요. 격일(이틀 간격) 출근일을 자동 계산하고, 출근 1회마다 ${dutyMult}일이 차감됩니다.`:(F.job.value?'토·일·공휴일은 제외하고 계산합니다.':'');
    F.dateHint.textContent=(F.start.value&&F.start.value<today)?'지난 날짜입니다. 사후 신청으로 접수됩니다.':'';
    CAL.redraw(false);
  };
  F.start.addEventListener('change',()=>{});
  const sub=h('div',{class:'card'},h('h2',null,'2. 휴가 정보'),
    h('div',{class:'fld'},h('span',null,'휴가 종류 ',h('b',null,'*')),typeC),F.typeHint,
    h('div',{class:'fld'},h('span',{id:'perLbl'},'기간 선택 ',h('b',null,'*')),CAL),
    h('div',{class:'grid2'},L.fld('시작일',F.start),L.fld('종료일',F.end)),F.dateHint,
    F.days,F.dayHint,F.reasonBox,L.fld('담당자 전달사항 (선택)',F.notes));
  const card1=h('div',{class:'card'},h('h2',null,'1. 근무자 정보'),
    h('div',{class:'fld'},h('span',null,'근무지 ',h('b',null,'*')),F.school,h('small',null,'검색한 뒤 목록에서 선택해 주세요.')),
    L.fld('성함',F.name,{req:1}),
    L.fld('연락처',F.phone,{req:1,hint:'신청 내용 확인이 필요할 때 연락드릴 번호입니다.'}),
    h('div',{class:'fld'},h('span',null,'직종 ',h('b',null,'*')),jobC));
  const card3=h('div',{class:'card'},h('h2',null,'3. 서명'),
    h('div',{class:'fld'},SIG.el,h('div',{class:'sigbar'},h('small',{style:'color:var(--mute)'},'흰 칸에 성함을 손가락으로 써 주세요.'),h('button',{type:'button',class:'btn ghost sm',onclick:()=>SIG.clear()},'다시 쓰기'))));
  const btn=h('button',{type:'submit',class:'btn block big'},'신청 내용 확인하기');
  const form=h('form',{novalidate:true,onsubmit:e=>{e.preventDefault();review();}},card1,sub,card3,h('div',{class:'hp'},F.hp),F.err,btn);
  if(me.school) F.school.set(me.school); if(me.name) F.name.value=me.name; if(me.phone) F.phone.value=me.phone; if(me.job) jobC.set(me.job);
  F.recalc(); return form;
}

function collect(){
  const t=TYPE[F.type], start=F.start.value, end=t.half?start:F.end.value;
  const e=[];
  if(!F.school.get()) e.push('근무지를 목록에서 선택해 주세요.');
  if(F.name.value.trim().length<2) e.push('성함을 입력해 주세요.');
  if(!validPhone(F.phone.value)) e.push('연락처를 확인해 주세요. 예: 010-1234-5678');
  if(!F.job.value) e.push('직종을 선택해 주세요.');
  if(isDuty()&&TYPE[F.type].half) e.push('당직경비는 반차를 신청할 수 없습니다. 연차로 선택해 주세요.');
  let days=0;
  if(!start||!end) e.push('달력에서 휴가 기간을 선택해 주세요.');
  else if(end<start) e.push('종료일이 시작일보다 빠릅니다.');
  else { days=t.half?0.5:calcFor(start,end); if(!(days>0)) e.push('선택한 기간이 모두 휴일이라 신청할 일수가 없습니다.'); }
  if(F.type==='경조사휴가'&&!F.reason.value.trim()) e.push('경조사휴가는 사유를 직접 작성해 주세요.');
  if(SIG.isEmpty()) e.push('서명란에 서명해 주세요.');
  return {e,days,v:{school:F.school.get(),name:F.name.value.trim(),phone:F.phone.value.replace(/\D/g,''),job:F.job.value,type:F.type,start,end,
    reason:F.type==='경조사휴가'?F.reason.value.trim():'개인사정',notes:F.notes.value.trim(),website:F.hp.value,sig:SIG.png()}};
}

function review(){
  F.err.textContent='';
  const {e,days,v}=collect();
  if(e.length){ F.err.textContent=e.join('\n'); F.err.scrollIntoView({block:'center',behavior:'smooth'}); return; }
  CUR={...v,days};
  const rows=[['근무지',v.school],['성함',v.name],['연락처',fmtPhone(v.phone)],['직종',v.job],['휴가 종류',v.type],['휴가 기간',v.job==='당직경비'?`${L.fullD(v.start)} 오후 출근 ~ ${L.fullD(addDays(shiftDates(v.start,v.end).slice(-1)[0],1))} 오전 퇴근`:L.fullRange(v.start,v.end)],['신청 일수',num(days)+'일'+(v.job==='당직경비'&&!TYPE[v.type].half?` (출근 ${num(days/dutyMult)}회 × ${dutyMult}일)`:'')],['사유',v.reason],['전달사항',v.notes||'없음']];
  const chk=h('input',{type:'checkbox',id:'okchk'}), err=h('p',{class:'err',role:'alert'});
  const go=h('button',{class:'btn block big',onclick:async()=>{
    err.textContent=''; if(!chk.checked){ err.textContent='내용을 확인한 뒤 확인란을 눌러 주세요.'; return; }
    if(busy) return; busy=true; go.disabled=true; go.textContent='제출 중…';
    try{ const r=await L.api('/api/apply',{body:CUR}); store.set({school:v.school,name:v.name,phone:fmtPhone(v.phone),job:v.job}); done(r); }
    catch(x){ err.textContent=x.message; }
    busy=false; go.disabled=false; go.textContent='제출하기';
  }},'제출하기');
  $('#main').replaceChildren(h('div',{class:'card'},h('h2',null,'내용이 맞는지 확인해 주세요'),
    h('dl',{class:'sum'},rows.flatMap(([k,x])=>[h('dt',null,k),h('dd',null,x)])),
    h('div',{class:'sigprev'},h('span',null,'신청인 서명'),h('img',{src:v.sig,alt:'서명'})),
    h('label',{class:'chk big'},chk,'위 내용을 확인했으며, 본인이 직접 신청합니다.'),err,go,
    h('button',{class:'btn ghost block big',style:'margin-top:10px',onclick:back},'내용 수정하기')));
  window.scrollTo(0,0);
}
function back(){ $('#main').replaceChildren(FORM); window.scrollTo(0,0); }
function done(r){
  $('#main').replaceChildren(h('div',{class:'card center'},h('div',{class:'tick'},'✓'),h('h2',null,'신청이 접수되었습니다'),
    h('div',{class:'receipt'},h('div',{class:'sub'},'접수번호'),h('div',{class:'code'},r.id),h('div',{class:'sub'},`${CUR.school} · ${CUR.name} · ${CUR.type} ${num(r.days)}일`)),
    h('p',{class:'hint'},'관리자가 확인한 뒤 승인합니다. 승인 여부는 담당자에게 문의해 주세요.'),
    h('button',{class:'btn ghost block big',onclick:()=>{ SIG.clear(); F.start.value=''; F.end.value=''; F.notes.value=''; F.reason.value=''; CAL.resetPick(); F.recalc(); back(); }},'새 신청서 작성하기')));
  window.scrollTo(0,0);
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

let FORM=null;
(async function boot(){
  try{ const c=await L.api('/api/config'); L.hol=new Set(c.holidays||[]); dutyMult=c.dutyMult||2; SCHOOLS=c.schools||[]; }
  catch(e){ $('#banner').append(h('div',{class:'banner bad'},'서버에 연결하지 못했습니다. 잠시 후 새로고침하세요.')); }
  setupLogin();
  FORM=buildForm(); $('#main').replaceChildren(FORM);
})();
})();
