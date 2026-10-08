/* 공통 유틸 (window.L) */
(function(){
'use strict';
const L = window.L = {};
L.h = function h(tag, props, ...kids){
  const e = document.createElement(tag);
  if(props) for(const [k,v] of Object.entries(props)){
    if(v==null || v===false) continue;
    if(k==='class') e.className = v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if(v===true) e.setAttribute(k,'');
    else e.setAttribute(k, v);
  }
  for(const c of kids.flat(Infinity)){
    if(c==null || c===false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
};
const h = L.h;
L.$ = (s, r=document) => r.querySelector(s);
L.pad = n => String(n).padStart(2,'0');
L.ymd = d => `${d.getFullYear()}-${L.pad(d.getMonth()+1)}-${L.pad(d.getDate())}`;
L.parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
L.DOW = ['일','월','화','수','목','금','토'];
L.todayStr = () => L.ymd(new Date());
L.fmtD = s => { const d=L.parse(s); const y=d.getFullYear()!==new Date().getFullYear()?d.getFullYear()+'.':''; return `${y}${d.getMonth()+1}/${d.getDate()}(${L.DOW[d.getDay()]})`; };
L.range = (a,b) => a===b ? L.fmtD(a) : `${L.fmtD(a)} ~ ${L.fmtD(b)}`;
L.fullD = s => { const d=L.parse(s); return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일(${L.DOW[d.getDay()]})`; };
L.fullRange = (a,b) => a===b ? L.fullD(a) : `${L.fullD(a)} ~ ${L.fullD(b)}`;
L.overlap = (a1,a2,b1,b2) => a1<=b2 && b1<=a2;
L.norm = s => (s||'').replace(/\s+/g,'').toLowerCase();
L.num = n => (Math.round(n*2)/2).toString();

L.ROLES = ['당직경비','미화','시설관리'];
L.TYPES = [
  {k:'연차',       d:true,  half:false, hint:'잔여 연차에서 차감됩니다.'},
  {k:'오전반차',   d:true,  half:true,  hint:'하루를 선택하세요. 0.5일 차감됩니다.'},
  {k:'오후반차',   d:true,  half:true,  hint:'하루를 선택하세요. 0.5일 차감됩니다.'},
  {k:'무급휴가',   d:false, half:false, hint:'연차에서 차감되지 않습니다. 급여 처리는 관리자가 확인합니다.'},
  {k:'경조사휴가', d:false, half:false, hint:'사유를 직접 작성하세요. 증빙(청첩장·부고 등)은 관리자에게 별도 제출합니다.'},
];
L.TYPE = Object.fromEntries(L.TYPES.map(t=>[t.k,t]));
L.ST = { pending:['대기','info'], approved:['승인','ok'], rejected:['반려','bad'], cancelled:['취소됨','mute'] };

L.hol = new Set();
L.calcDays = (s,e,weekend) => {
  if(!s||!e) return 0;
  const a=L.parse(s), b=L.parse(e); if(b<a) return 0;
  let n=0;
  for(let d=new Date(a); d<=b; d.setDate(d.getDate()+1)){
    const w=d.getDay();
    if(weekend || (w!==0 && w!==6 && !L.hol.has(L.ymd(d)))) n++;
  }
  return n;
};

L.toast = msg => { const t=h('div',{class:'toast'},msg); document.body.append(t); setTimeout(()=>t.remove(),3000); };

L.api = async (path, opt={}) => {
  const init = { method: opt.method || (opt.body ? 'POST' : 'GET'), credentials:'same-origin', headers:{} };
  if(opt.body){ init.headers['Content-Type']='application/json'; init.body = JSON.stringify(opt.body); }
  const r = await fetch(path, init);
  let j=null; try{ j = await r.json(); }catch(e){}
  if(!r.ok){ const err = new Error(j?.error || '요청을 처리하지 못했습니다.'); err.status = r.status; throw err; }
  return j;
};

L.openModal = ({title, msg, body, okLabel='확인', okKind='', onOk}) => new Promise(resolve=>{
  const err = h('p',{class:'err'});
  const close = v => { ov.remove(); resolve(v); };
  const ok = h('button',{class:'btn '+okKind, onclick: async ()=>{
    ok.disabled = true;
    try{ const r = onOk ? await onOk() : true; if(r===true||r===undefined) close(true); else { err.textContent=r; ok.disabled=false; } }
    catch(e){ err.textContent = e.message || '실패했습니다.'; ok.disabled=false; }
  }}, okLabel);
  const ov = h('div',{class:'ov', onclick:e=>{ if(e.target===ov) close(false); }},
    h('div',{class:'md'}, h('h3',null,title), msg?h('div',{class:'msg'},msg):null, body||null, err,
      h('div',{class:'btns'}, h('button',{class:'btn ghost',onclick:()=>close(false)},'취소'), ok)));
  document.body.append(ov);
});
L.ask = (title,msg,okLabel,okKind) => L.openModal({title,msg,okLabel,okKind});
L.fld = (label,input,opts={}) => h('label',{class:'fld'}, h('span',null,label,opts.req?h('b',null,' *'):null), input, opts.hint?h('small',null,opts.hint):null);
})();
