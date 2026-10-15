(function(){
'use strict';
const {h,$,ST,num,range,norm,overlap,ymd,pad} = L;
let reqs=[], schools=[], me=null, filter='pending', timer=null, q='';
const fmtPhone=s=>{ const d=String(s||'').replace(/\D/g,''); if(d.startsWith('02')) return d.length===9?`${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}`:`${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`; return d.length===10?`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`:d.length===11?`${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`:d; };

/* ---------- 로그인 ---------- */
function showLogin(msg){
  clearInterval(timer); me=null; $('#logout').classList.add('hide'); $('#who').textContent='';
  const un=h('input',{type:'text',autocomplete:'username',autocapitalize:'none',placeholder:'아이디'});
  const pw=h('input',{type:'password',autocomplete:'current-password',placeholder:'비밀번호'});
  const err=h('p',{class:'err'},msg||'');
  const go=async()=>{
    err.textContent=''; btn.disabled=true;
    try{ await L.api('/api/admin/login',{body:{username:un.value,password:pw.value}}); start(); }
    catch(e){ err.textContent=e.message; btn.disabled=false; pw.select(); }
  };
  const btn=h('button',{class:'btn block',onclick:go},'로그인');
  for(const i of [un,pw]) i.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  $('#main').replaceChildren(h('div',{class:'card login'},h('h2',null,'관리자 로그인'),L.fld('아이디',un),L.fld('비밀번호',pw),err,btn));
  un.focus();
}

/* ---------- 데이터 ---------- */
async function load(){
  try{
    const [a,b]=await Promise.all([L.api('/api/admin/requests'),L.api('/api/admin/schools')]);
    reqs=a.items; schools=b.items; render();
  }catch(e){ if(e.status===401) showLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); else L.toast(e.message); }
}
async function start(){
  try{ me=(await L.api('/api/admin/me')).admin; }catch(e){ return showLogin(); }
  $('#logout').classList.remove('hide'); $('#who').textContent=`${me.name}${me.role==='super'?' (총괄)':''}`;
  try{ const c=await L.api('/api/config'); L.hol=new Set(c.holidays||[]); L.dutyMult=c.dutyMult||2; }catch(e){}
  await load(); clearInterval(timer);   // 자동 새로고침 없음: DB가 계속 깨어 있으면 무료 컴퓨트 시간이 빨리 소진됨. 탭으로 돌아오거나 버튼을 누를 때만 갱신
}

/* ---------- 처리 ---------- */
async function decide(r,action,note){ await L.api('/api/admin/decide',{body:{id:r.id,action,note}}); await load(); }
function needNote(title,label,okLabel){
  const ta=h('textarea',{maxlength:200,placeholder:label}); let val=null;
  return L.openModal({title,body:h('div',{class:'fld'},ta),okLabel,okKind:'bad',onOk:()=>{const v=ta.value.trim(); if(!v)return '사유를 입력하세요.'; val=v; return true;}}).then(ok=>ok?val:null);
}
async function act(r,kind){
  try{
    if(kind==='approve'){ if(!(await L.ask('승인',`${r.name} (${r.school})\n${r.type} ${num(r.days)}일\n${range(r.start_date,r.end_date)}\n\n승인할까요?`,'승인','ok')))return; await decide(r,'approve'); L.toast('승인했습니다'); }
    else if(kind==='reject'){ const n=await needNote('반려','반려 사유','반려'); if(n==null)return; await decide(r,'reject',n); L.toast('반려했습니다'); }
    else if(kind==='cancel'){ if(!(await L.ask('취소 처리',`${r.name} · ${r.type} ${range(r.start_date,r.end_date)}\n승인된 휴가를 취소 처리할까요?`,'취소 처리','bad')))return; await decide(r,'cancel'); L.toast('취소 처리했습니다'); }
    else if(kind==='delete'){ if(!(await L.ask('신청 삭제',`${r.name} · ${r.type} ${range(r.start_date,r.end_date)}\n삭제하면 되돌릴 수 없습니다. (잘못 들어온 신청일 때만 사용하세요)`,'삭제','bad')))return; await decide(r,'delete'); L.toast('삭제했습니다'); }
  }catch(e){ L.toast(e.message); load(); }
}

/* ---------- 근무지(학교) 목록 ---------- */
function parseList(txt){ return txt.split(/\r?\n/).map(l=>l.split(/\t/)[0].trim()).filter(Boolean); }
function addSchools(){
  let names=[]; const info=h('div',{class:'sub',style:'margin:6px 0'});
  const file=h('input',{type:'file',accept:'.xlsx,.xls,.csv,.txt'});
  const ta=h('textarea',{style:'min-height:130px;font-size:15px',placeholder:'한 줄에 학교 하나씩 붙여넣기\n예)\n가람초등학교\n나래중학교'});
  const setNames=a=>{ names=[...new Set(a.map(x=>String(x).trim()).filter(Boolean))]; info.textContent=names.length?`${names.length}곳 인식됨 (예: ${names[0]})`:'인식된 근무지가 없습니다.'; };
  file.addEventListener('change',async()=>{
    const f=file.files[0]; if(!f) return;
    try{
      if(/\.(csv|txt)$/i.test(f.name)) setNames(parseList(await f.text()));
      else{ if(!window.XLSX){ info.textContent='엑셀 모듈을 불러오지 못했습니다. 붙여넣기를 사용하세요.'; return; }
        const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
        setNames(XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}).map(r=>r[0])); }
    }catch(e){ info.textContent='파일을 읽지 못했습니다.'; }
  });
  ta.addEventListener('input',()=>setNames(parseList(ta.value)));
  let res=null;
  L.openModal({title:'근무지(학교) 추가',msg:'엑셀 A열(또는 붙여넣기 한 줄에 하나)의 이름을 목록에 추가합니다. 이미 있는 이름은 그대로 두고, 숨겨진 근무지는 다시 보이게 합니다.\n근무자는 이 목록에 있는 이름만 고를 수 있으니 표기를 통일해 주세요.',
    body:h('div',null,L.fld('엑셀/CSV 파일 (A열)',file),L.fld('또는 붙여넣기',ta),info),okLabel:'추가',
    onOk:async()=>{ if(!names.length) return '추가할 근무지가 없습니다.'; res=await L.api('/api/admin/schools-add',{body:{names}}); return true; }
  }).then(ok=>{ if(ok&&res){ L.toast(`새로 ${res.added}곳 추가 (입력 ${res.total}곳)`); load(); } });
}
function manageSchool(s){
  const nm=h('input',{type:'text',maxlength:80,value:s.name});
  L.openModal({title:'근무지 관리',msg:s.n?`이 근무지로 접수된 신청 ${s.n}건. 이름을 바꾸면 기존 신청서의 근무지 표기도 함께 바뀝니다.`:null,
    body:h('div',null,L.fld('근무지 이름',nm),
      h('button',{class:'btn ghost sm',onclick:async()=>{ try{ await L.api('/api/admin/school-update',{body:{id:s.id,active:!s.active}}); document.querySelector('.ov')?.remove(); L.toast(s.active?'목록에서 숨겼습니다':'다시 표시합니다'); load(); }catch(e){ L.toast(e.message); } }},s.active?'목록에서 숨기기 (계약 종료 등)':'다시 표시하기')),
    okLabel:'이름 저장',onOk:async()=>{ await L.api('/api/admin/school-update',{body:{id:s.id,name:nm.value}}); L.toast('저장했습니다'); await load(); return true; }});
}

function editHolidays(){
  const ta=h('textarea',{style:'min-height:220px;font-size:14px;font-family:monospace'}); ta.value=[...L.hol].sort().join('\n');
  L.openModal({title:'공휴일 관리',msg:'일수 계산에서 제외할 날짜입니다. 한 줄에 하나씩 YYYY-MM-DD 형식으로 입력하세요.\n정부 공고(임시공휴일·선거일 등)와 회사 취업규칙에 맞는지 확인하세요.',body:h('div',{class:'fld'},ta),okLabel:'저장',
    onOk:async()=>{ const dates=ta.value.split(/\s+/).filter(Boolean); await L.api('/api/admin/holidays',{body:{dates}}); L.hol=new Set(dates); L.toast('공휴일을 저장했습니다'); return true; }});
}


/* ---------- 계정 ---------- */
function changePw(){
  const c=h('input',{type:'password',autocomplete:'current-password'}), n=h('input',{type:'password',autocomplete:'new-password'}), n2=h('input',{type:'password',autocomplete:'new-password'});
  L.openModal({title:'내 비밀번호 변경',body:h('div',null,L.fld('현재 비밀번호',c),L.fld('새 비밀번호',n,{hint:'10자 이상, 영문+숫자 포함'}),L.fld('새 비밀번호 확인',n2)),okLabel:'변경',
    onOk:async()=>{ if(n.value!==n2.value) return '새 비밀번호가 서로 다릅니다.'; await L.api('/api/admin/password',{body:{current:c.value,next:n.value}}); L.toast('비밀번호를 변경했습니다'); return true; }});
}
async function manageAdmins(){
  let data; try{ data=await L.api('/api/admin/admins'); }catch(e){ return L.toast(e.message); }
  const rows=h('div');
  for(const a of data.items){
    const self=a.id===me.id;
    rows.append(h('div',{class:'staff'},
      h('div',null,h('div',{style:'font-weight:700'},`${a.name} `,h('span',{class:'badge '+(a.active?'ok':'mute')},a.active?'사용':'정지'),a.role==='super'?h('span',{class:'badge info',style:'margin-left:4px'},'총괄'):null),
        h('div',{class:'sub'},`${a.username}${a.last_login?' · 최근 로그인 '+L.ymd(new Date(a.last_login)):' · 로그인 이력 없음'}`)),
      h('div',{class:'acts',style:'margin:0;justify-content:flex-end'},
        h('button',{class:'btn ghost sm',onclick:()=>resetAdminPw(a)},'비밀번호 초기화'),
        self?null:h('button',{class:'btn ghost sm',onclick:async()=>{ try{ await L.api('/api/admin/admin-update',{body:{id:a.id,active:!a.active}}); document.querySelector('.ov')?.remove(); manageAdmins(); }catch(e){ L.toast(e.message); } }},a.active?'정지':'재사용'))));
  }
  L.openModal({title:`관리자 계정 (${data.items.length}/${data.max})`,body:h('div',null,rows),okLabel:'새 계정 만들기',onOk:()=>{ setTimeout(()=>newAdmin(),0); return true; }});
}
function resetAdminPw(a){
  const pw=h('input',{type:'text',autocomplete:'off',placeholder:'새 임시 비밀번호'});
  L.openModal({title:`${a.name} 비밀번호 초기화`,msg:'저장하면 해당 계정의 기존 로그인이 모두 끊깁니다. 새 비밀번호를 본인에게 안전하게 전달하고 바로 변경하도록 안내하세요.',body:L.fld('새 비밀번호',pw,{hint:'10자 이상, 영문+숫자 포함'}),okLabel:'초기화',
    onOk:async()=>{ await L.api('/api/admin/admin-update',{body:{id:a.id,password:pw.value}}); L.toast('초기화했습니다'); return true; }});
}
function newAdmin(){
  const u=h('input',{type:'text',autocapitalize:'none',placeholder:'예: hong01'}), n=h('input',{type:'text',maxlength:20,placeholder:'이름'}), pw=h('input',{type:'text',autocomplete:'off',placeholder:'초기 비밀번호'});
  const role=h('select',null,h('option',{value:'admin'},'일반 관리자'),h('option',{value:'super'},'총괄 관리자 (계정 관리 가능)'));
  L.openModal({title:'관리자 계정 만들기',body:h('div',null,L.fld('아이디',u,{hint:'영문 소문자·숫자 3~20자'}),L.fld('이름',n),L.fld('권한',role),L.fld('초기 비밀번호',pw,{hint:'10자 이상, 영문+숫자 포함. 만든 뒤 본인이 바로 변경하도록 안내하세요.'})),okLabel:'만들기',
    onOk:async()=>{ await L.api('/api/admin/admin-create',{body:{username:u.value,name:n.value,role:role.value,password:pw.value}}); L.toast('계정을 만들었습니다'); return true; }}).then(ok=>{ if(ok) manageAdmins(); });
}

/* ---------- CSV / PDF ---------- */
function csvCell(v){ v=String(v??''); return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function download(name,blobParts,type){ const a=h('a',{href:URL.createObjectURL(new Blob(blobParts,{type})),download:name}); document.body.append(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000); }
function exportCsv(){
  const rows=[['근무지','성명','직종','연락처','종류','시작일','종료일','일수','상태','사유','신청일','처리 메모','처리자','사후신청','접수번호']];
  for(const r of [...reqs].sort((a,b)=>a.start_date.localeCompare(b.start_date)))
    rows.push([r.school,r.name,r.job,fmtPhone(r.phone),r.type,r.start_date,r.end_date,r.days,ST[r.status][0],r.reason,ymd(new Date(r.created_at)),r.note,r.decided_by||'',r.late?'Y':'',r.id]);
  download(`휴가신청_${L.todayStr()}.csv`,['﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],'text/csv;charset=utf-8');
}
function pdfPage(r,sig){
  const FONT="'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif", bd='1px solid #222';
  const th=t=>h('td',{style:`border:${bd};background:#f1f1f1;padding:12px 10px;text-align:center;font-weight:700;width:18%;font-size:15px`},t);
  const td=(t,cs,x)=>h('td',{colspan:cs||1,style:`border:${bd};padding:12px 14px;font-size:15px;${x||''}`},t);
  const created=new Date(r.created_at), st=r.status;
  const stamp=h('div',{style:'width:96px;border:'+bd+';text-align:center;font-size:13px'},
    h('div',{style:'background:#f1f1f1;border-bottom:'+bd+';padding:4px 0;font-weight:700'},'관리자'),
    h('div',{style:'height:58px;display:grid;place-items:center;font-weight:700;font-size:16px;color:'+(st==='approved'?'#c0392b':'#555')},st==='approved'?'승인':st==='rejected'?'반려':st==='cancelled'?'취소':'대기'),
    h('div',{style:'border-top:'+bd+';padding:3px 0;font-size:11px;color:#444'},r.decided_at&&st!=='pending'?ymd(new Date(r.decided_at))+(r.decided_by?' '+r.decided_by:''):' '));
  const img=sig?h('img',{src:sig,style:'height:70px;vertical-align:middle;margin-left:10px'}):h('span',{style:'color:#999;margin-left:10px'},'(서명 없음)');
  const half=r.type==='오전반차'||r.type==='오후반차';
  const dayText=`${num(r.days)}일`;
  return h('div',{style:`width:794px;height:1123px;background:#fff;color:#111;font-family:${FONT};padding:64px 64px 48px;box-sizing:border-box;position:relative`},
    h('div',{style:'display:flex;justify-content:flex-end;margin-bottom:6px'},stamp),
    h('div',{style:'text-align:center;font-size:32px;font-weight:700;letter-spacing:12px;margin:10px 0 36px'},'휴 가 신 청 서'),
    h('table',{style:'width:100%;border-collapse:collapse'},
      h('tr',null,th('근무지'),td(r.school||'-'),th('성명'),td(r.name||'-')),
      h('tr',null,th('직종'),td(r.job||'-'),th('연락처'),td(fmtPhone(r.phone))),
      h('tr',null,th('휴가 종류'),td(r.type,3)),
      h('tr',null,th('휴가 기간'),td(L.fullRange(r.start_date,r.end_date),3)),
      h('tr',null,th('사용 일수'),td(dayText,3)),
      h('tr',null,th('사유'),td(r.reason||'개인사정',3,'height:80px;vertical-align:top')),
      h('tr',null,th('처리 결과'),td(ST[st][0]+(r.note&&st!=='pending'?` — ${r.note}`:''),3))),
    h('div',{style:'text-align:center;font-size:17px;margin:46px 0 26px'},'위와 같이 휴가를 신청합니다.'),
    h('div',{style:'text-align:center;font-size:16px;margin-bottom:30px'},`${created.getFullYear()}년 ${created.getMonth()+1}월 ${created.getDate()}일`),
    h('div',{style:'text-align:right;font-size:17px;padding-right:20px;display:flex;justify-content:flex-end;align-items:center'},h('span',null,`신청인  ${r.name||''}`),img,h('span',{style:'margin-left:6px;font-size:14px'},'(서명)')),
    h('div',{style:'position:absolute;left:64px;right:64px;bottom:34px;font-size:11px;color:#777;text-align:center;border-top:1px solid #ccc;padding-top:8px'},
      `휴가 신청 시스템에서 전자적으로 작성된 문서입니다. 접수번호 ${r.id} · 신청 일시 ${ymd(created)} ${pad(created.getHours())}:${pad(created.getMinutes())} · 출력 ${L.todayStr()}`));
}
async function makePdf(list,fname){
  if(!window.jspdf||!window.html2canvas){ L.toast('PDF 모듈을 불러오지 못했습니다. 네트워크 확인 후 새로고침하세요.'); return; }
  if(!list.length){ L.toast('출력할 신청이 없습니다.'); return; }
  const {jsPDF}=window.jspdf, doc=new jsPDF({unit:'mm',format:'a4',orientation:'p'});
  const stage=h('div',{class:'pdfstage'}); document.body.append(stage);
  L.toast(`PDF 만드는 중… (${list.length}건)`);
  try{
    try{ await document.fonts.load('700 16px "Noto Sans KR"'); await document.fonts.ready; }catch(e){}
    for(let i=0;i<list.length;i++){
      let sig=null; try{ sig=(await L.api('/api/admin/sig?id='+list[i].id)).sig; }catch(e){}
      const page=pdfPage(list[i],sig); stage.replaceChildren(page);
      const im=page.querySelector('img'); if(im&&im.decode){ try{await im.decode();}catch(e){} }
      const cv=await window.html2canvas(page,{scale:2,backgroundColor:'#ffffff',useCORS:true,logging:false});
      if(i>0)doc.addPage(); doc.addImage(cv.toDataURL('image/jpeg',0.92),'JPEG',0,0,210,297);
    }
    download(fname,[doc.output('arraybuffer')],'application/pdf');
  }catch(e){ L.toast('PDF를 만들지 못했습니다. 다시 시도하세요.'); }
  finally{ stage.remove(); }
}

const pdfName=r=>`휴가신청서_${r.school||''}_${r.name||''}_${r.start_date.replace(/-/g,'')}.pdf`.replace(/[\\/:*?"<>|\s]+/g,'_');

/* ---------- 화면 ---------- */
function card(r){
  const st=r.status, acts=[];
  const conf=reqs.filter(o=>o.id!==r.id&&['pending','approved'].includes(o.status)&&norm(o.school)===norm(r.school)&&overlap(o.start_date,o.end_date,r.start_date,r.end_date));
  const same=conf.filter(o=>o.job===r.job);
  if(st!=='approved'&&st!=='cancelled')acts.push(h('button',{class:'btn ok sm',onclick:()=>act(r,'approve')},'승인'));
  if(st!=='rejected'&&st!=='cancelled')acts.push(h('button',{class:'btn bad sm',onclick:()=>act(r,'reject')},'반려'));
  if(st==='approved')acts.push(h('button',{class:'btn ghost sm',onclick:()=>act(r,'cancel')},'취소 처리'));
  acts.push(h('button',{class:'btn ghost sm',onclick:()=>makePdf([r],pdfName(r))},'PDF'));
  acts.push(h('button',{class:'btn ghost sm',onclick:()=>act(r,'delete')},'삭제'));
  return h('div',{class:'item'},
    h('div',{class:'top'},
      h('div',null,h('div',{class:'t'},`${r.name} · ${r.type} ${num(r.days)}일`),h('div',{class:'d'},`${r.school} · ${r.job}`),
        h('div',{class:'d'},range(r.start_date,r.end_date)+' · '+r.id),
        h('div',{class:'d'},h('a',{href:'tel:'+r.phone,style:'color:inherit'},fmtPhone(r.phone)))),
      h('div',{style:'text-align:right'},h('span',{class:'badge '+ST[st][1]},ST[st][0]),
        r.late?h('div',null,h('span',{class:'badge warn',style:'margin-top:4px'},'사후 신청')):null)),
    r.reason&&r.reason!=='개인사정'?h('div',{class:'n'},h('em',null,'사유 '),r.reason):null,
    r.note&&st!=='pending'?h('div',{class:'n'},h('em',null,'처리 메모 '),r.note):null,
    r.decided_by&&st!=='pending'?h('div',{class:'n'},h('em',null,'처리자 '),r.decided_by):null,
    (st==='pending'||st==='approved')&&conf.length?h('div',{class:'conf'},`같은 근무지에서 기간이 겹치는 신청 ${conf.length}건`+(same.length?` (같은 직종 ${same.length}건)`:'')+': '+conf.map(o=>`${o.name}(${o.job}·${ST[o.status][0]})`).join(', ')):null,
    h('div',{class:'acts'},acts));
}
function render(){
  const root=h('div'), today=L.todayStr();
  const nP=reqs.filter(r=>r.status==='pending').length;
  const away=reqs.filter(r=>r.status==='approved'&&r.start_date<=today&&today<=r.end_date);
  root.append(h('div',{class:'stats'},
    h('div',{class:'stat'},h('b',null,nP),h('span',null,'승인 대기')),
    h('div',{class:'stat'},h('b',null,away.length),h('span',null,'오늘 휴가 중')),
    h('div',{class:'stat'},h('b',null,reqs.length),h('span',null,'전체 신청'))));
  if(away.length)root.append(h('div',{class:'card',style:'padding:12px 14px'},h('div',{class:'sub',style:'margin-bottom:4px'},'오늘 휴가 중'),h('div',{style:'font-size:14px'},away.map(r=>`${r.name}(${r.school}·${r.job})`).join(', '))));
  const fl=[['pending','대기'],['approved','승인'],['closed','반려·취소'],['all','전체']];
  root.append(h('div',{class:'chips',style:'margin-top:12px'},fl.map(([k,l])=>h('button',{class:'chip'+(filter===k?' on':''),onclick:()=>{filter=k;render();}},l)),h('button',{class:'chip',onclick:()=>{ load(); L.toast('새로고침했습니다'); }},'↻ 새로고침')));
  const search=h('input',{type:'search',placeholder:'학교·이름·연락처 검색',value:q});
  search.addEventListener('input',()=>{ q=search.value; const pos=search.selectionStart; render(); const n=$('#main input[type=search]'); if(n){ n.focus(); n.setSelectionRange(pos,pos); } });
  root.append(search);
  const qq=norm(q), qd=q.replace(/\D/g,'');
  const m=r=>({pending:r.status==='pending',approved:r.status==='approved',closed:r.status==='rejected'||r.status==='cancelled',all:true})[filter]
    &&(!qq||norm(r.school+r.name).includes(qq)||(qd.length>=3&&r.phone.includes(qd)));
  const list=reqs.filter(m).sort((a,b)=>filter==='pending'?a.created_at-b.created_at:b.start_date.localeCompare(a.start_date));
  if(list.length)root.append(h('div',{style:'display:flex;justify-content:flex-end;gap:6px;margin-top:8px'},
    h('button',{class:'btn ghost sm',onclick:exportCsv},'엑셀(CSV) 전체'),
    h('button',{class:'btn ghost sm',onclick:()=>makePdf(list.slice(0,100),`휴가신청서_${L.todayStr()}_${Math.min(list.length,100)}건.pdf`)},`표시된 ${Math.min(list.length,100)}건 PDF`)));
  const lc=h('div',{class:'card',style:'margin-top:8px'});
  if(!list.length)lc.append(h('div',{class:'empty'},'해당하는 신청이 없습니다.'));
  list.slice(0,100).forEach(r=>lc.append(card(r)));
  if(list.length>100)lc.append(h('div',{class:'empty'},`${list.length-100}건 더 있습니다. 검색으로 좁혀 보세요.`));
  root.append(lc);

  const act_=schools.filter(s=>s.active).length;
  root.append(h('div',{class:'sect'},h('h2',null,`근무지(학교) 목록 (${act_}곳)`),h('div',{style:'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end'},
    h('button',{class:'btn ghost sm',onclick:addSchools},'근무지 추가'),h('button',{class:'btn ghost sm',onclick:editHolidays},'공휴일'))));
  if(!schools.length)root.append(h('div',{class:'banner'},'근무지 목록이 비어 있습니다. "근무지 추가"로 학교 이름을 먼저 올려야 근무자가 신청할 수 있습니다.'));
  else{
    const sq=h('input',{type:'search',id:'sq',placeholder:'근무지 검색',style:'margin-top:8px'});
    const box=h('div',{class:'card',style:'margin-top:8px;max-height:360px;overflow:auto'});
    const draw=()=>{ const k=norm(sq.value); box.replaceChildren(); for(const s of schools.filter(s=>!k||norm(s.name).includes(k)).slice(0,200))
      box.append(h('div',{class:'staff'},h('div',null,h('span',{style:'font-weight:700'},s.name+' '),s.active?null:h('span',{class:'badge mute'},'숨김'),h('div',{class:'sub'},`신청 ${s.n}건`)),h('button',{class:'btn ghost sm',onclick:()=>manageSchool(s)},'관리'))); if(!box.children.length) box.append(h('div',{class:'empty'},'검색 결과가 없습니다.')); };
    sq.addEventListener('input',draw); draw(); root.append(sq,box);
  }
  root.append(h('div',{class:'sect'},h('h2',null,'내 계정'),h('div',{style:'display:flex;gap:6px'},
    h('button',{class:'btn ghost sm',onclick:changePw},'비밀번호 변경'),
    me&&me.role==='super'?h('button',{class:'btn ghost sm',onclick:manageAdmins},'관리자 계정 관리'):null)));
  $('#main').replaceChildren(root);
}

document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&me&&!document.querySelector('.ov')) load(); });
$('#logout').addEventListener('click',async()=>{ try{await L.api('/api/admin/logout',{body:{}});}catch(e){} showLogin(); });
(async()=>{ try{ await L.api('/api/admin/me'); start(); }catch(e){ showLogin(); } })();
})();
