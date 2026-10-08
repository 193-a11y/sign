(function(){
'use strict';
const {h,$,ST,num,range,norm,overlap,ymd,pad} = L;
let reqs=[], emps=[], me=null, filter='pending', timer=null;

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
    const [a,b]=await Promise.all([L.api('/api/admin/requests'),L.api('/api/admin/employees')]);
    reqs=a.items; emps=b.items; render();
  }catch(e){ if(e.status===401) showLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); else L.toast(e.message); }
}
async function start(){
  try{ me=(await L.api('/api/admin/me')).admin; }catch(e){ return showLogin(); }
  $('#logout').classList.remove('hide'); $('#who').textContent=`${me.name}${me.role==='super'?' (총괄)':''}`;
  try{ const c=await L.api('/api/config'); L.hol=new Set(c.holidays||[]); L.dutyMult=c.dutyMult||2; }catch(e){}
  await load(); clearInterval(timer); timer=setInterval(load,60000);
}
const cancelPending = r => r.status==='approved'&&r.cancel_req&&!r.cancel_denied;

/* ---------- 처리 ---------- */
async function decide(r,action,note){ await L.api('/api/admin/decide',{body:{id:r.id,action,note}}); await load(); }
function needNote(title,label,okLabel){
  const ta=h('textarea',{maxlength:200,placeholder:label}); let val=null;
  return L.openModal({title,body:h('div',{class:'fld'},ta),okLabel,okKind:'bad',onOk:()=>{const v=ta.value.trim(); if(!v)return '사유를 입력하세요.'; val=v; return true;}}).then(ok=>ok?val:null);
}
async function act(r,kind){
  try{
    if(kind==='approve'){ if(!(await L.ask('승인',`${r.name} · ${r.type} ${num(r.days)}일\n${range(r.start_date,r.end_date)}\n\n승인할까요?`,'승인','ok')))return; await decide(r,'approve'); L.toast('승인했습니다'); }
    else if(kind==='reject'){ const n=await needNote('반려','반려 사유 (신청자에게 표시됩니다)','반려'); if(n==null)return; await decide(r,'reject',n); L.toast('반려했습니다'); }
    else if(kind==='cancel'){ if(!(await L.ask('취소 처리',`${r.name} · ${r.type} ${range(r.start_date,r.end_date)}\n취소 처리할까요? 차감된 연차가 복구됩니다.`,'취소 처리','bad')))return; await decide(r,'cancel'); L.toast('취소 처리했습니다'); }
    else if(kind==='deny'){ const n=await needNote('취소 요청 반려','반려 사유 (신청자에게 표시됩니다)','반려'); if(n==null)return; await decide(r,'deny_cancel',n); L.toast('취소 요청을 반려했습니다'); }
  }catch(e){ L.toast(e.message); load(); }
}
const EMP_LIMIT = 50;
let empQuery='', empShown=EMP_LIMIT;
function manageEmp(e){
  const t=h('input',{type:'number',min:'0',step:'0.5',inputmode:'decimal',value:e.total??''});
  const u=h('input',{type:'number',min:'0',step:'0.5',inputmode:'decimal',value:e.used_before??0});
  const site=h('input',{type:'text',maxlength:40,value:e.site||'',placeholder:'근무지'});
  const role=h('select',null,h('option',{value:''},'(변경 안 함)'),L.ROLES.map(r=>h('option',{value:r,selected:r===e.role},r)));
  const more=(label,kind,fn)=>h('button',{class:'btn '+(kind||'ghost')+' sm',onclick:async()=>{ if(await fn()){ document.querySelector('.ov')?.remove(); await load(); } }},label);
  const actions=h('div',{class:'acts',style:'margin:0 0 12px'},
    more('비밀번호 초기화','ghost',async()=>{ if(!(await L.ask('비밀번호 초기화',`${e.name}(${e.phone_tail}) 계정을 첫 로그인 상태로 되돌립니다.\n기존 로그인은 모두 끊기고, 본인이 이름·전화번호로 다시 들어와 새 비밀번호를 만듭니다.`,'초기화','bad')))return false; try{ await L.api('/api/admin/employee-reset',{body:{id:e.id}}); L.toast('초기화했습니다'); return true; }catch(x){ L.toast(x.message); return false; } }),
    more('전화번호 변경','ghost',()=>new Promise(res=>{ const p=h('input',{type:'tel',inputmode:'numeric',placeholder:'010-0000-0000'}); L.openModal({title:`${e.name} 전화번호 변경`,msg:'변경하면 기존 로그인이 끊기고 비밀번호가 초기화됩니다.',body:L.fld('새 전화번호',p),okLabel:'변경',onOk:async()=>{ await L.api('/api/admin/employee-phone',{body:{id:e.id,phone:p.value}}); L.toast('변경했습니다'); return true; }}).then(ok=>res(ok)); })),
    more(e.active?'퇴사·정지 처리':'다시 사용','ghost',async()=>{ if(!(await L.ask(e.active?'퇴사·정지 처리':'다시 사용',e.active?`${e.name}(${e.phone_tail}) 계정을 정지합니다. 로그인이 막히고, 신청 이력은 남습니다.`:`${e.name}(${e.phone_tail}) 계정을 다시 사용합니다.`,'확인',e.active?'bad':'')))return false; try{ await L.api('/api/admin/employee-active',{body:{id:e.id,active:!e.active}}); return true; }catch(x){ L.toast(x.message); return false; } }));
  L.openModal({title:`${e.name} (${e.phone_tail})`,
    body:h('div',null,actions,L.fld('올해 부여 연차 (일)',t,{hint:'비워두면 미설정(초과 신청 차단 안 함)'}),L.fld('이 앱 사용 전 이미 사용한 연차 (일)',u),L.fld('근무지',site),L.fld('직무',role)),
    okLabel:'저장',onOk:async()=>{ await L.api('/api/admin/employee',{body:{id:e.id,total:t.value===''?null:Number(t.value),used_before:Number(u.value||0),site:site.value,role:role.value}}); L.toast('저장했습니다'); await load(); return true; }});
}

function parseRosterText(txt){
  return txt.split(/\r?\n/).map(l=>l.split(/\t|,/).map(x=>x.trim())).filter(r=>r.some(x=>x));
}
function uploadRoster(){
  let rows=[];
  const info=h('div',{class:'sub',style:'margin:6px 0'});
  const file=h('input',{type:'file',accept:'.xlsx,.xls,.csv'});
  const ta=h('textarea',{style:'min-height:90px;font-size:13px',placeholder:'엑셀에서 A·B열을 복사해 붙여넣을 수도 있습니다.\n홍길동\t010-1234-5678'});
  let hdr=0;
  const setRows=a=>{ a=a.map(r=>r.map(x=>x==null?'':String(x))); hdr=(a.length&&!/\d{3,}/.test(String(a[0][1]??'')))?1:0; rows=a.slice(hdr);   // 머리글 행(전화번호 모양이 아닌 첫 줄)은 건너뜀
    const mask=v=>{ const d=String(v).replace(/\D/g,''); return d.length>4?'•'.repeat(d.length-4)+d.slice(-4):String(v); };
    info.textContent=rows.length?`${rows.length}명 인식됨 (예: ${rows[0][0]} / ${mask(rows[0][1])})`:'인식된 행이 없습니다.'; };
  file.addEventListener('change',async()=>{
    const f=file.files[0]; if(!f) return;
    try{
      if(/\.csv$/i.test(f.name)) setRows(parseRosterText(await f.text()));
      else{ if(!window.XLSX){ info.textContent='엑셀 모듈을 불러오지 못했습니다. CSV로 저장하거나 붙여넣기를 사용하세요.'; return; }
        const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
        setRows(XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}).filter(r=>r.some(x=>String(x).trim()))); }
    }catch(e){ info.textContent='파일을 읽지 못했습니다.'; }
  });
  ta.addEventListener('input',()=>setRows(parseRosterText(ta.value)));
  let report=null;
  L.openModal({title:'근무자 명단 올리기',
    msg:'A열 이름, B열 전화번호 (선택: C열 근무지, D열 직무, E열 부여 연차, F열 이전 사용 연차). 첫 줄이 제목이면 자동으로 건너뜁니다.\n이미 있는 사람은 정보만 갱신되고 비밀번호와 신청 내역은 유지됩니다.',
    body:h('div',null,L.fld('엑셀/CSV 파일',file),L.fld('또는 붙여넣기',ta),info),okLabel:'올리기',
    onOk:async()=>{
      if(!rows.length) return '올릴 명단이 없습니다.';
      let added=0,updated=0; const skipped=[];
      for(let i=0;i<rows.length;i+=300){
        const r=await L.api('/api/admin/roster',{body:{rows:rows.slice(i,i+300),offset:i+hdr}});
        added+=r.added; updated+=r.updated; skipped.push(...r.skipped);
      }
      report={added,updated,skipped}; return true;
    }}).then(ok=>{ if(!ok||!report) return; load();
      L.openModal({title:'명단 올리기 결과',body:h('div',null,
        h('div',{class:'msg'},`새로 등록 ${report.added}명 · 갱신 ${report.updated}명 · 건너뜀 ${report.skipped.length}건`),
        report.skipped.length?h('div',{style:'max-height:200px;overflow:auto;font-size:13px'},report.skipped.slice(0,100).map(s=>h('div',null,`${s.row}행 ${s.name||''} — ${s.reason}`))):null),okLabel:'확인'}); });
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
  const rows=[['학교(근무지)','이름','직무','종류','시작일','종료일','일수','상태','사유','신청일','처리 메모','취소요청','사후신청']];
  for(const r of [...reqs].sort((a,b)=>a.start_date.localeCompare(b.start_date)))
    rows.push([r.site,r.name,r.role,r.type,r.start_date,r.end_date,r.days,ST[r.status][0],r.reason,ymd(new Date(r.created_at)),r.note,r.cancel_req?'Y':'',r.late?'Y':'']);
  download(`연차신청_${L.todayStr()}.csv`,['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],'text/csv;charset=utf-8');
}
function pdfPage(r,sig){
  const FONT="'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif", bd='1px solid #222';
  const th=t=>h('td',{style:`border:${bd};background:#f1f1f1;padding:12px 10px;text-align:center;font-weight:700;width:18%;font-size:15px`},t);
  const td=(t,cs,x)=>h('td',{colspan:cs||1,style:`border:${bd};padding:12px 14px;font-size:15px;${x||''}`},t);
  const created=new Date(r.created_at), st=r.status;
  const stamp=h('div',{style:'width:96px;border:'+bd+';text-align:center;font-size:13px'},
    h('div',{style:'background:#f1f1f1;border-bottom:'+bd+';padding:4px 0;font-weight:700'},'관리자'),
    h('div',{style:'height:58px;display:grid;place-items:center;font-weight:700;font-size:16px;color:'+(st==='approved'?'#c0392b':'#555')},st==='approved'?'승인':st==='rejected'?'반려':st==='cancelled'?'취소':'대기'),
    h('div',{style:'border-top:'+bd+';padding:3px 0;font-size:11px;color:#444'},r.decided_at&&st!=='pending'?ymd(new Date(r.decided_at))+(r.decided_by?' '+r.decided_by:''):'\u00a0'));
  const img=sig?h('img',{src:sig,style:'height:70px;vertical-align:middle;margin-left:10px'}):h('span',{style:'color:#999;margin-left:10px'},'(서명 없음)');
  return h('div',{style:`width:794px;height:1123px;background:#fff;color:#111;font-family:${FONT};padding:64px 64px 48px;box-sizing:border-box;position:relative`},
    h('div',{style:'display:flex;justify-content:flex-end;margin-bottom:6px'},stamp),
    h('div',{style:'text-align:center;font-size:32px;font-weight:700;letter-spacing:12px;margin:10px 0 36px'},'휴 가 신 청 서'),
    h('table',{style:'width:100%;border-collapse:collapse'},
      h('tr',null,th('소속(근무지)'),td(r.site||'-'),th('성명'),td(r.name||'-')),
      h('tr',null,th('직무'),td(r.role||'-'),th('휴가 종류'),td(r.type)),
      h('tr',null,th('휴가 기간'),td(L.fullRange(r.start_date,r.end_date),3)),
      h('tr',null,th('사용 일수'),td(r.role==='당직경비'&&r.type!=='오전반차'&&r.type!=='오후반차'?`${num(r.days)}일 (당직 ${num(r.days/(L.dutyMult||2))}회 × ${L.dutyMult||2}일)`:`${num(r.days)}일`+(r.wk?' (토·일·공휴일 포함 계산)':' (토·일·공휴일 제외 계산)'),3)),
      h('tr',null,th('사유'),td(r.reason||'개인사정',3,'height:90px;vertical-align:top')),
      h('tr',null,th('처리 결과'),td(ST[st][0]+(r.note&&st!=='pending'?` — ${r.note}`:''),3))),
    h('div',{style:'text-align:center;font-size:17px;margin:56px 0 30px'},'위와 같이 휴가를 신청합니다.'),
    h('div',{style:'text-align:center;font-size:16px;margin-bottom:34px'},`${created.getFullYear()}년 ${created.getMonth()+1}월 ${created.getDate()}일`),
    h('div',{style:'text-align:right;font-size:17px;padding-right:20px;display:flex;justify-content:flex-end;align-items:center'},h('span',null,`신청인  ${r.name||''}`),img,h('span',{style:'margin-left:6px;font-size:14px'},'(서명)')),
    h('div',{style:'margin-top:56px;text-align:center;font-size:20px;font-weight:700'},'광개토환경 귀중'),
    h('div',{style:'position:absolute;left:64px;right:64px;bottom:34px;font-size:11px;color:#777;text-align:center;border-top:1px solid #ccc;padding-top:8px'},
      `연차 신청 시스템에서 전자적으로 작성된 문서입니다. 신청 일시 ${ymd(created)} ${pad(created.getHours())}:${pad(created.getMinutes())} · 출력 ${L.todayStr()}`));
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
const pdfName=r=>`휴가신청서_${r.site||''}_${r.name||''}_${r.start_date.replace(/-/g,'')}.pdf`.replace(/[\\/:*?"<>|\s]+/g,'_');

/* ---------- 화면 ---------- */
function card(r){
  const cp=cancelPending(r), st=r.status;
  const conf=reqs.filter(o=>o.id!==r.id&&['pending','approved'].includes(o.status)&&norm(o.site)&&norm(o.site)===norm(r.site)&&overlap(o.start_date,o.end_date,r.start_date,r.end_date));
  const same=conf.filter(o=>o.role===r.role), acts=[];
  if(cp){ acts.push(h('button',{class:'btn bad sm',onclick:()=>act(r,'cancel')},'취소 처리'),h('button',{class:'btn ghost sm',onclick:()=>act(r,'deny')},'취소 요청 반려')); }
  else{
    if(st!=='approved'&&st!=='cancelled')acts.push(h('button',{class:'btn ok sm',onclick:()=>act(r,'approve')},'승인'));
    if(st!=='rejected'&&st!=='cancelled')acts.push(h('button',{class:'btn bad sm',onclick:()=>act(r,'reject')},'반려'));
    if(st==='approved')acts.push(h('button',{class:'btn ghost sm',onclick:()=>act(r,'cancel')},'취소 처리'));
  }
  acts.push(h('button',{class:'btn ghost sm',onclick:()=>makePdf([r],pdfName(r))},'PDF'));
  return h('div',{class:'item'},
    h('div',{class:'top'},
      h('div',null,h('div',{class:'t'},`${r.name}(${r.phone_tail}) · ${r.type} ${num(r.days)}일`),h('div',{class:'d'},`${r.site} · ${r.role}`),h('div',{class:'d'},range(r.start_date,r.end_date)+' · '+r.id)),
      h('div',{style:'text-align:right'},h('span',{class:'badge '+ST[st][1]},ST[st][0]),
        cp?h('div',null,h('span',{class:'badge warn',style:'margin-top:4px'},'취소요청')):null,
        r.late?h('div',null,h('span',{class:'badge warn',style:'margin-top:4px'},'사후 신청')):null)),
    r.reason&&r.reason!=='개인사정'?h('div',{class:'n'},h('em',null,'사유 '),r.reason):null,
    r.note&&st!=='pending'?h('div',{class:'n'},h('em',null,'처리 메모 '),r.note):null,
    r.decided_by&&st!=='pending'?h('div',{class:'n'},h('em',null,'처리자 '),r.decided_by):null,
    (st==='pending'||st==='approved')&&conf.length?h('div',{class:'conf'},`같은 근무지에서 기간이 겹치는 신청 ${conf.length}건`+(same.length?` (같은 직무 ${same.length}건)`:'')+': '+conf.map(o=>`${o.name}(${o.role}·${ST[o.status][0]})`).join(', ')):null,
    h('div',{class:'acts'},acts));
}
function render(){
  const root=h('div'), today=L.todayStr();
  const nP=reqs.filter(r=>r.status==='pending').length, nC=reqs.filter(cancelPending).length;
  const away=reqs.filter(r=>r.status==='approved'&&r.start_date<=today&&today<=r.end_date);
  root.append(h('div',{class:'stats'},
    h('div',{class:'stat'},h('b',null,nP),h('span',null,'승인 대기')),
    h('div',{class:'stat'},h('b',null,nC),h('span',null,'취소 요청')),
    h('div',{class:'stat'},h('b',null,away.length),h('span',null,'오늘 휴가 중'))));
  if(away.length)root.append(h('div',{class:'card',style:'padding:12px 14px'},h('div',{class:'sub',style:'margin-bottom:4px'},'오늘 휴가 중'),h('div',{style:'font-size:14px'},away.map(r=>`${r.name}(${r.site}·${r.role})`).join(', '))));
  const fl=[['pending','대기'],['cancelreq','취소요청'],['approved','승인'],['closed','반려·취소'],['all','전체']];
  root.append(h('div',{class:'chips',style:'margin-top:12px'},fl.map(([k,l])=>h('button',{class:'chip'+(filter===k?' on':''),onclick:()=>{filter=k;render();}},l))));
  const m=r=>({pending:r.status==='pending',cancelreq:cancelPending(r),approved:r.status==='approved',closed:r.status==='rejected'||r.status==='cancelled',all:true})[filter];
  const list=reqs.filter(m).sort((a,b)=>filter==='pending'?a.created_at-b.created_at:b.start_date.localeCompare(a.start_date));
  if(list.length)root.append(h('div',{style:'display:flex;justify-content:flex-end;margin-top:2px'},h('button',{class:'btn ghost sm',onclick:()=>makePdf(list,`휴가신청서_${L.todayStr()}_${list.length}건.pdf`)},`표시된 ${list.length}건 PDF 한 번에 받기`)));
  const lc=h('div',{class:'card',style:'margin-top:8px'});
  if(!list.length)lc.append(h('div',{class:'empty'},'해당하는 신청이 없습니다.')); list.forEach(r=>lc.append(card(r))); root.append(lc);

  const joined=emps.filter(e=>e.joined).length, unset=emps.filter(e=>e.active&&e.total==null).length;
  root.append(h('div',{class:'sect'},h('h2',null,`근무자 (${emps.length}명)`),h('div',{style:'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end'},
    h('button',{class:'btn ghost sm',onclick:uploadRoster},'명단 올리기'),h('button',{class:'btn ghost sm',onclick:editHolidays},'공휴일'),h('button',{class:'btn ghost sm',onclick:exportCsv},'엑셀(CSV)'))));
  if(emps.length) root.append(h('div',{class:'sub',style:'margin:6px 2px 0'},`가입 완료 ${joined}명 · 미가입 ${emps.length-joined}명`));
  if(unset)root.append(h('div',{class:'banner'},`부여 연차가 등록되지 않은 근무자가 ${unset}명 있습니다. 등록 전에는 잔여 일수 확인과 초과 신청 차단이 작동하지 않습니다.`));
  const q=norm(empQuery);
  const found=emps.filter(e=>!q||norm(e.name+e.phone_tail+(e.site||'')).includes(q));
  const search=h('input',{type:'search',placeholder:'이름·근무지·전화 뒷4자리 검색',value:empQuery,style:'margin-top:8px'});
  search.addEventListener('input',()=>{ empQuery=search.value; empShown=EMP_LIMIT; const pos=search.selectionStart; render(); const n=$('#main input[type=search]'); if(n){ n.focus(); n.setSelectionRange(pos,pos); } });
  root.append(search);
  const sc=h('div',{class:'card',style:'margin-top:8px'});
  if(!emps.length)sc.append(h('div',{class:'empty'},'등록된 근무자가 없습니다.\n"명단 올리기"로 이름·전화번호 엑셀을 올려주세요.'));
  else if(!found.length)sc.append(h('div',{class:'empty'},'검색 결과가 없습니다.'));
  for(const e of found.slice(0,empShown)){
    const rem=e.total==null?null:e.total-e.used_before-e.ap-e.pe;
    sc.append(h('div',{class:'staff'},
      h('div',null,
        h('div',{style:'font-weight:700'},`${e.name} (${e.phone_tail}) `,e.joined?null:h('span',{class:'badge mute'},'미가입'),!e.active?h('span',{class:'badge bad',style:'margin-left:4px'},'정지'):null),
        h('div',{class:'sub'},`${e.site||'근무지 미입력'} · ${e.role||'직무 미입력'}`),
        h('div',{class:'sub'},e.total==null?'':`부여 ${num(e.total)} · 이전 ${num(e.used_before)} · 승인 ${num(e.ap)} · 대기 ${num(e.pe)}`)),
      h('div',{style:'text-align:right'},rem==null?h('div',{class:'rem none'},'미설정'):h('div',{class:'rem'},num(rem)+'일'),h('button',{class:'btn ghost sm',style:'margin-top:6px',onclick:()=>manageEmp(e)},'관리'))));
  }
  if(found.length>empShown) sc.append(h('div',{style:'text-align:center;padding-top:10px'},h('button',{class:'btn ghost sm',onclick:()=>{empShown+=EMP_LIMIT;render();}},`더 보기 (${found.length-empShown}명 남음)`)));
  root.append(sc);
  root.append(h('div',{class:'sect'},h('h2',null,'내 계정'),h('div',{style:'display:flex;gap:6px'},
    h('button',{class:'btn ghost sm',onclick:changePw},'비밀번호 변경'),
    me&&me.role==='super'?h('button',{class:'btn ghost sm',onclick:manageAdmins},'관리자 계정 관리'):null)));
  $('#main').replaceChildren(root);
}

$('#logout').addEventListener('click',async()=>{ try{await L.api('/api/admin/logout',{body:{}});}catch(e){} showLogin(); });
(async()=>{ try{ await L.api('/api/admin/me'); start(); }catch(e){ showLogin(); } })();
})();
