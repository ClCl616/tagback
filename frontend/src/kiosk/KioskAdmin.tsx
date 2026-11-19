import { useEffect, useRef, useState } from 'react';
import { getKioskRuntime } from '../kiosk-host/runtime';
import { kioskRequest } from '../kiosk-host/transport';
import type { KioskCommand } from '../kiosk-host/contracts';
import type { NfcScanProof } from '../shared/types';
import type { ReaderStatus } from '../shared/nfc';
import './kiosk-admin.css';

type Session = { token: string; sessionId: string; expiresAt: string };
type Item = { itemId: string; itemName: string; itemTypeName: string; status: string };
type Write = { operationId: string; itemId: string; expectedUid: string | null; proof: NfcScanProof };
const statuses: Record<string,string> = { TAG_PENDING:'태그 등록 대기', AVAILABLE:'대여 가능', RENTED:'대여 중', INSPECTION:'점검 중', REPAIR:'수리 중' };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
async function call(command: KioskCommand): Promise<any> {
  const response=await kioskRequest(command);
  const data=response.status===204 ? null : await response.json();
  if(!response.ok) throw new ApiError(response.status, (data as any)?.error?.message || '요청을 처리하지 못했습니다.');
  return data;
}
export default function KioskAdmin({close}:{close:()=>void}) {
  const [session,setSession]=useState<Session>(), [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [rows,setRows]=useState<Item[]>([]), [keyword,setKeyword]=useState(''), [pendingOnly,setPendingOnly]=useState(true);
  const [page,setPage]=useState(0), [pages,setPages]=useState(0);
  const [selected,setSelected]=useState<Item>(), [expectedUid,setExpectedUid]=useState<string|null>(null);
  const [proof,setProof]=useState<NfcScanProof>(), [reader,setReader]=useState<ReaderStatus>('connecting');
  const [pending,setPending]=useState<Write>(), [needsLogin,setNeedsLogin]=useState(false);
  const lock=useRef(false), alive=useRef(true), pendingRef=useRef<Write|undefined>(undefined);
  const lastActivity=useRef(Date.now()), current=useRef({selected,session,busy,pending});
  current.current={selected,session,busy,pending}; pendingRef.current=pending;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>getKioskRuntime().reader.subscribe(read=>{
    const state=current.current;
    if(state.session && state.selected && !state.busy && !state.pending && read.proof) {
      setProof(read.proof);setNotice('태그를 인식했습니다. 물품과 UID를 확인하고 연결을 확정하세요.');
      lastActivity.current=Date.now();
    }
  },{onStatus:setReader}),[]);
  function clearSelection() { setSelected(undefined);setProof(undefined);setExpectedUid(null); }
  async function run(task:()=>Promise<void>) {
    if(lock.current) return;lock.current=true;setBusy(true);setError('');
    try { await task(); } catch(e) {
      if(alive.current) { setError(e instanceof Error ? e.message : '연결 상태를 확인하세요.');
        if(e instanceof ApiError && e.status===401) {setNeedsLogin(true);setRows([]);} }
    } finally {lock.current=false;if(alive.current)setBusy(false);}
  }
  async function list(auth:Session, nextPage=page) {
    const data=await call({action:'admin-items',adminRef:auth.token,keyword,page:nextPage,pending:pendingOnly});
    if(!Array.isArray(data?.items)||!Number.isInteger(data.totalPages)) throw new Error('물품 목록을 확인하지 못했습니다.');
    if(alive.current){setRows(data.items);setPages(data.totalPages);setPage(nextPage);}
  }
  async function leave() {
    if(pendingRef.current) return;
    if(session) {
      try { await call({action:'admin-logout',adminRef:session.token}); }
      catch(e) { if(!(e instanceof ApiError && e.status===401)) throw e; }
    }
    close();
  }
  useEffect(()=>{
    if(!session) return;
    const timer=setInterval(()=>{
      const expired=Date.now()>=Date.parse(session.expiresAt);
      const idle=Date.now()-lastActivity.current>=300000;
      if(expired && pendingRef.current) {setNeedsLogin(true);return;}
      if((expired||idle)&&!lock.current&&!pendingRef.current) {
        // Remove local privilege immediately, even when the server is unreachable during logout.
        setSession(undefined);setRows([]);clearSelection();setPassword('');
        void call({action:'admin-logout',adminRef:session.token}).catch(()=>{});
        close();
      }
    },1000);
    return()=>clearInterval(timer);
  },[session]);
  async function save(auth:Session, write:Write) {
    const wasPending=!!pendingRef.current;
    pendingRef.current=write;setPending(write);
    try {
      const result=await call({action:'admin-tag',adminRef:auth.token,...write});
      if(result?.itemId!==write.itemId||result.uid!==write.proof.uid||!['AVAILABLE','INSPECTION','REPAIR','NOT_APPLIED'].includes(result.status))
        throw new Error('저장 응답을 확인하지 못했습니다. 같은 요청으로 결과를 확인하세요.');
      pendingRef.current=undefined;setPending(undefined);clearSelection();
      setNotice(result.status==='NOT_APPLIED' ? '태그 인식 시간이 만료되어 연결하지 않았습니다. 물품을 선택하고 태그를 다시 인식해 주세요.'
        : `태그 연결 완료 · ${statuses[result.status]}`);
      await list(auth,0);
    } catch(e) {
      if(!wasPending && e instanceof ApiError && e.status>=400 && e.status<500) {
        pendingRef.current=undefined;setPending(undefined);setProof(undefined);
      }
      throw e;
    }
  }
  return <div className="kiosk-admin" onPointerDown={()=>{lastActivity.current=Date.now();}} onKeyDown={()=>{lastActivity.current=Date.now();}}>
    <header><h1>관리자 태그 등록·교체</h1><button disabled={busy||!!pending} onClick={()=>void run(leave)}>관리자 종료</button></header>
    <p>일반 대여·반납은 관리자 모드를 종료한 뒤 이용할 수 있습니다. 5분간 조작하지 않으면 자동 종료됩니다.</p>
    {notice&&<p className="notice" role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
    {(!session||needsLogin) ? <form onSubmit={e=>{e.preventDefault();const secret=password;setPassword('');void run(async()=>{
      const auth=await call({action:'admin-login',password:secret}) as Session;
      if(typeof auth?.token!=='string'||!Number.isFinite(Date.parse(auth.expiresAt))) throw new Error('관리자 로그인 응답 오류');
      setSession(auth);setNeedsLogin(false);lastActivity.current=Date.now();
      if(!pendingRef.current) {clearSelection();await list(auth,0);}
    });}}>
      <h2>{pending ? '거래 결과 확인을 위해 다시 인증해 주세요' : '공통 관리자 비밀번호'}</h2>
      <input aria-label="관리자 비밀번호" type="password" autoComplete="off" maxLength={128} required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} autoFocus />
      <button disabled={busy||!password}>관리자 로그인</button>
    </form> : pending ? <section>
      <h2>태그 연결 결과 확인 필요</h2><p>물품 ID {pending.itemId} · UID {pending.proof.uid}</p>
      <p>중복 변경을 막기 위해 다른 물품 작업을 잠갔습니다. 같은 요청으로 결과를 확인합니다.</p>
      <button disabled={busy} onClick={()=>void run(()=>save(session,pending))}>연결 결과 확인 및 재시도</button>
    </section> : <>
      <form className="ka-search" onSubmit={e=>{e.preventDefault();clearSelection();void run(()=>list(session,0));}}>
        <input aria-label="물품 검색" placeholder="물품명·종류·태그 검색" value={keyword} maxLength={100} onChange={e=>setKeyword(e.target.value)} disabled={busy} />
        <label><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)} disabled={busy}/>태그 등록 대기만</label>
        <button disabled={busy}>검색</button>
      </form>
      <div className="ka-columns"><section><h2>물품 선택</h2>
        {!rows.length&&<p>조건에 맞는 물품이 없습니다. 관리자 웹에서 물품을 먼저 등록하세요.</p>}
        <div className="ka-list">{rows.map(item=><button key={item.itemId} disabled={busy||item.status==='RENTED'} aria-pressed={selected?.itemId===item.itemId} onClick={()=>void run(async()=>{
          clearSelection();const result=await call({action:'admin-tag-current',adminRef:session.token,itemId:item.itemId});
          if(result.tag!==null&&typeof result.tag?.uid!=='string') throw new Error('태그 정보를 확인하지 못했습니다.');
          setSelected(item);setExpectedUid(result.tag?.uid||null);setNotice('선택한 물품의 태그를 리더기에 대 주세요.');
        })}><strong>{item.itemName}</strong><span>ID {item.itemId} · {item.itemTypeName} · {statuses[item.status]}</span></button>)}</div>
        <nav><button disabled={busy||page===0} onClick={()=>void run(()=>list(session,page-1))}>이전</button><span>{page+1} / {Math.max(1,pages)}</span>
          <button disabled={busy||page+1>=pages} onClick={()=>void run(()=>list(session,page+1))}>다음</button></nav>
      </section><section><h2>태그 인식·확정</h2><p>리더기: {reader==='connected'?'연결됨':'연결 확인 필요'}</p>
        {selected ? <><h3>{selected.itemName}</h3><p>물품 ID {selected.itemId}</p><p>현재 태그: {expectedUid||'없음'}</p><p>새 태그: {proof?.uid||'리더기에 태그를 대 주세요'}</p>
          <p>{selected.status==='TAG_PENDING'?'연결 성공 시 대여 가능으로 전환됩니다.':'태그만 교체하며 점검·수리 상태는 유지합니다.'}</p>
          <button disabled={busy||!proof||reader!=='connected'} onClick={()=>{if(proof)void run(()=>save(session,{operationId:crypto.randomUUID(),itemId:selected.itemId,expectedUid,proof}));}}>{expectedUid?'태그 교체 확정':'태그 연결 확정'}</button>
        </>:<p>왼쪽에서 물품을 선택하세요. UID를 직접 입력할 수 없습니다.</p>}
      </section></div>
    </>}
    {busy&&<p role="status">처리 중…</p>}
  </div>;
}
