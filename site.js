// 산업의 결: 독립적인 프론트엔드. 기존 worker.js / model.py 분석 엔진을 그대로 호출합니다.
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v, digits = 4) => Number(v).toLocaleString('ko-KR',{maximumFractionDigits:digits});
  const dataSets = {
    large:{name:'대분류',n:33,file:'투입산출표_생산자가격_통합대분류.xlsx'},
    medium:{name:'중분류',n:83,file:'투입산출표_생산자가격_통합중분류.xlsx'},
    small:{name:'소분류',n:165,file:'투입산출표_생산자가격_통합소분류.xlsx'},
    basic:{name:'기본부문',n:380,file:'io-2023.xlsx'}
  };
  let worker=null, requestId=0, pending=new Map(), changeToken=0;
  let sectors=[], sheets=[], currentDataset=null, basket=[], lastResult=null, archiveRows=[], archiveCells=[], activeArchiveCode='';
  const fingerprints=new Map();
  const datasetButtons=[...document.querySelectorAll('[data-dataset]')];

  function status(message, mode='loading') {
    el('status').textContent=message;
    el('status-dot').className='status-dot '+(mode==='ready'?'ready':mode==='error'?'error':'');
  }
  function resetWorker(){
    if(worker){worker.terminate();worker=null;}
    for(const p of pending.values())p.reject(new Error('자료가 변경되어 요청이 취소됐습니다.'));
    pending.clear();
  }
  function createWorker(){
    worker=new Worker('./worker.js?v=site1');
    worker.onmessage=({data:d})=>{
      if(d.type==='status'){status(d.text);return;}
      const p=pending.get(d.id);
      if(!p)return;
      pending.delete(d.id);
      d.ok?p.resolve(d.result):p.reject(new Error(d.error));
    };
    worker.onerror=e=>{
      status('계산 환경 오류: '+(e.message||'알 수 없는 오류'),'error');
      for(const p of pending.values())p.reject(new Error(e.message||'Worker 실행 오류'));
      pending.clear();
    };
  }
  function call(type,payload){
    if(!worker)return Promise.reject(new Error('자료를 먼저 불러와 주세요.'));
    return new Promise((resolve,reject)=>{
      const id=++requestId;
      pending.set(id,{resolve,reject});
      if(type==='init')worker.postMessage({id,type,payload},[payload]);
      else worker.postMessage({id,type,payload});
    });
  }
  async function workbook(file){
    for(const name of [...new Set([file,file.normalize('NFC'),file.normalize('NFD')])]){
      const res=await fetch('./data/'+encodeURIComponent(name),{cache:'default'});
      if(res.ok)return res.arrayBuffer();
      if(res.status!==404)throw new Error('엑셀 다운로드 실패: HTTP '+res.status);
    }
    throw new Error('data 폴더에서 '+file+' 파일을 찾지 못했습니다.');
  }
  function enabled(yes){
    const ids=['hero-search','hero-sector','draw-btn','compare-search-a','compare-search-b',
      'compare-sector-a','compare-sector-b','compare-btn','impact-search','impact-sector',
      'impact-amount','scenario-add','scenario-run','archive-sheet','archive-search',
      'archive-row','archive-column'];
    for(const id of ids)el(id).disabled=!yes;
  }
  function replaceOptions(id,items,selected){
    const node=el(id),old=selected??node.value;
    node.replaceChildren(...items.map(s=>{
      const opt=document.createElement('option');opt.value=s.code;opt.textContent=s.code+' · '+s.name;return opt;
    }));
    if(items.some(s=>s.code===old))node.value=old;
    return node.value;
  }
  function bindFilter(searchId,selectId){
    const box=el(searchId),select=el(selectId);
    box.addEventListener('input',()=>{
      const q=box.value.trim().toLocaleLowerCase();
      replaceOptions(selectId,sectors.filter(s=>(s.name+' '+s.code).toLocaleLowerCase().includes(q)),select.value);
    });
  }
  for(const pair of [['hero-search','hero-sector'],['compare-search-a','compare-sector-a'],
                      ['compare-search-b','compare-sector-b'],['impact-search','impact-sector']])bindFilter(...pair);

  function clearOutputs(){
    basket=[];lastResult=null;fingerprints.clear();renderBasket();
    el('impact-results').hidden=true;
    el('compare-results').innerHTML=`<article class="compare-card"><p class="eyebrow">INDUSTRY A</p><div class="placeholder-art">A</div><p class="compare-label">산업 A를 선택하세요</p></article><article class="compare-card"><p class="eyebrow">INDUSTRY B</p><div class="placeholder-art">B</div><p class="compare-label">산업 B를 선택하세요</p></article>`;
    el('hero-count').textContent='—';el('hero-domestic').textContent='—';el('hero-imports').textContent='—';
    el('hero-top').innerHTML='<li>산업을 선택하면 표시됩니다.</li>';
    el('archive-cells').innerHTML='<tr><td colspan="3">자료를 불러오면 표시됩니다.</td></tr>';
  }
  async function loadData(key){
    const localToken=++changeToken, ds=dataSets[key];
    if(!ds)return;
    for(const b of datasetButtons)b.disabled=true;
    enabled(false);clearOutputs();
    resetWorker();currentDataset=null;sectors=[];sheets=[];
    status(ds.name+' 자료 다운로드 중…');
    try{
      const bytes=await workbook(ds.file);
      if(localToken!==changeToken)return;
      createWorker();
      status(ds.name+' 자료 검증 중…');
      const info=await call('init',bytes);
      if(localToken!==changeToken)return;
      if(info.sectors.length!==ds.n)throw new Error('부문 수 불일치: '+info.sectors.length+'개');
      sectors=info.sectors;sheets=info.sheets;currentDataset=key;
      el('validation').textContent=JSON.stringify(info.residuals,null,2)+'\n최대 절대 잔차 허용값: 1e-8 미만';
      datasetButtons.forEach(b=>b.classList.toggle('active',b.dataset.dataset===key));
      for(const id of ['hero-sector','compare-sector-a','compare-sector-b','impact-sector'])replaceOptions(id,sectors);
      for(const id of ['hero-search','compare-search-a','compare-search-b','impact-search','archive-search','archive-column'])el(id).value='';
      if(sectors[1])el('compare-sector-b').value=sectors[1].code;
      el('archive-sheet').replaceChildren(...sheets.map(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;return o;}));
      enabled(true);
      status('준비 완료 · '+ds.name+' '+ds.n+'개 부문 · '+sheets.length+'개 시트 · 계수 검증 통과','ready');
      await Promise.all([drawOne(sectors[0].code),archiveExplore(true)]);
    }catch(e){
      if(localToken!==changeToken)return;
      status('불러오기 실패: '+e.message,'error');
      enabled(false);
    }finally{if(localToken===changeToken)datasetButtons.forEach(b=>b.disabled=false);}
  }
  datasetButtons.forEach(b=>b.addEventListener('click',()=>loadData(b.dataset.dataset)));

  // 과도하게 작은 계수도 보이도록 지문의 선은 정규화하여 표현합니다.
  // 각 업종 코드 순서로 각도를 배치합니다. 실제 계수는 옆 수치 및 원자료를 참조하세요.
  function valuesFrom(data){return data.cells.map(c=>(Number.isFinite(Number(c.value))?Math.max(0,Number(c.value)):0));}
  function sum(values){return values.reduce((a,b)=>a+b,0);}
  function raster(values,n=120){
    if(!values.length)return Array(n).fill(0);
    const src=Array.from({length:n},(_,i)=>{
      const pos=i*values.length/n,lo=Math.floor(pos),frac=pos-lo;
      return (values[lo%values.length]*(1-frac)+values[(lo+1)%values.length]*frac);
    });
    return src.map((v,i)=> (src[(i+n-2)%n]+2*src[(i+n-1)%n]+4*v+2*src[(i+1)%n]+src[(i+2)%n])/10);
  }
  function contour(values,r,k,rot){
    const peak=Math.max(1e-8,...values),samples=raster(values);
    return samples.map((v,i)=>{
      const a=2*Math.PI*i/samples.length-Math.PI/2+rot;
      const q=Math.log1p(v*85)/Math.log1p(peak*85);
      const radius=r+q*k;
      return `${i?'L':'M'}${(260+radius*Math.cos(a)).toFixed(2)},${(260+radius*Math.sin(a)).toFixed(2)}`;
    }).join(' ')+' Z';
  }
  function ringSvg(data,code,small=false){
    const d=valuesFrom(data.domestic),m=valuesFrom(data.imported);
    const rings=[72,103,134,165,196].map(r=>`<circle cx="260" cy="260" r="${r}" fill="none" stroke="#E9EDF2" stroke-width="1"/>`).join('');
    let strokes='';
    for(let i=0;i<7;i++)strokes+=`<path d="${contour(d,70+i*19,16,0)}" fill="none" stroke="#8799B2" stroke-width="${(1.6-i*.09).toFixed(2)}" opacity="${(.92-i*.06).toFixed(2)}" stroke-linejoin="round"/>`;
    for(let i=0;i<3;i++)strokes+=`<path d="${contour(m,84+i*46,9,.04)}" fill="none" stroke="#BBC7D6" stroke-width="1" opacity=".85"/>`;
    return `${rings}${strokes}<circle cx="260" cy="260" r="28" fill="#fff" stroke="#dfe5ed"/><text x="260" y="265" text-anchor="middle" font-size="${small?15:16}" font-weight="650" fill="#7f90a7">${esc(code)}</text>`;
  }
  function showTop(data){
    const positive=data.domestic.cells.filter(c=>c.value>0).sort((a,b)=>b.value-a.value).slice(0,5);
    el('hero-top').innerHTML=positive.map(c=>`<li><b>${esc(c.name)}</b><span>${fmt(c.value,4)}</span></li>`).join('')||'<li>양(+)의 국산투입계수가 없습니다.</li>';
  }
  async function getFingerprint(code){
    if(fingerprints.has(code))return fingerprints.get(code);
    const data=await call('fingerprint',{code});
    fingerprints.set(code,data);
    return data;
  }
  let heroDraw=0;
  async function drawOne(code){
    if(!code||!sectors.length)return;
    const token=++heroDraw;
    el('hero-name').textContent='지문을 생성하는 중…';
    try{
      const data=await getFingerprint(code);
      if(token!==heroDraw)return;
      el('hero-art').innerHTML=ringSvg(data,code);
      el('hero-name').textContent=data.domestic.name;
      el('hero-code').textContent=code;
      el('hero-subtitle').textContent=data.domestic.selected+' · '+data.domestic.name;
      const domestic=valuesFrom(data.domestic),imported=valuesFrom(data.imported);
      el('hero-count').textContent=fmt(domestic.filter(v=>v>0).length,0);
      el('hero-domestic').textContent=fmt(sum(domestic),4);
      el('hero-imports').textContent=fmt(sum(imported),4);
      showTop(data);
    }catch(e){if(token===heroDraw)el('hero-name').textContent='지문 오류: '+e.message;}
  }
  el('draw-btn').addEventListener('click',()=>drawOne(el('hero-sector').value));
  el('hero-sector').addEventListener('change',()=>drawOne(el('hero-sector').value));
  function drawPlaceholder(){
    const curves=[0,1,2,3,4,5,6].map(i=>{
      let d='';for(let j=0;j<=180;j++){
        const a=j/180*2*Math.PI,rad=64+i*19+6*Math.sin(a*4+i*.4)+4*Math.cos(a*9+i*.21);
        d+=(j?'L':'M')+(260+rad*Math.cos(a)).toFixed(2)+','+(260+rad*Math.sin(a)).toFixed(2)+' ';
      }return `<path d="${d}" fill="none" stroke="#A2AEC0" opacity="${.85-i*.08}" stroke-width="1.3"/>`;
    }).join('');
    el('hero-art').innerHTML=curves+'<circle cx="260" cy="260" r="28" fill="#fff"/><text x="260" y="264" text-anchor="middle" fill="#8294ad" font-size="13">IO / 23</text>';
  }
  drawPlaceholder();

  // 비교: 두 산업 각각의 동일한 데이터 기반 지문과 중간재 투입 비중을 출력.
  function compareCard(data,key){
    const domestic=valuesFrom(data.domestic),imported=valuesFrom(data.imported);
    const sd=sum(domestic),si=sum(imported),share=(sd+si)>0?100*sd/(sd+si):0;
    return `<article class="compare-card"><p class="eyebrow">INDUSTRY ${key}</p>
      <svg class="compare-art" viewBox="0 0 520 520" role="img" aria-label="${esc(data.domestic.name)} 투입구조 지문">${ringSvg(data,data.domestic.selected,true)}</svg>
      <p class="compare-label">${esc(data.domestic.name)}</p>
      <div class="compare-stat"><span>국산투입계수 합계</span><strong>${fmt(sd)}</strong></div>
      <div class="compare-stat"><span>수입투입계수 합계</span><strong>${fmt(si)}</strong></div>
      <div class="compare-stat"><span>중간재 중 국산 투입 비중</span><strong>${fmt(share,1)}%</strong></div></article>`;
  }
  el('compare-btn').addEventListener('click',async()=>{
    const a=el('compare-sector-a').value,b=el('compare-sector-b').value;
    if(!a||!b)return;
    el('compare-btn').disabled=true;el('compare-btn').textContent='비교 중…';
    try{
      const [da,db]=await Promise.all([getFingerprint(a),getFingerprint(b)]);
      el('compare-results').innerHTML=compareCard(da,'A')+compareCard(db,'B');
    }catch(e){el('compare-results').textContent='비교 실패: '+e.message;}
    finally{el('compare-btn').disabled=false;el('compare-btn').textContent='비교 분석 ↗';}
  });

  function renderBasket(){
    el('scenario-list').innerHTML=basket.length
      ?basket.map((s,i)=>`<span class="scenario-chip">${esc(s.name)} · ${fmt(s.amount,2)}백만원 <button type="button" data-remove="${i}" aria-label="${esc(s.name)} 삭제">×</button></span>`).join('')
      :'추가된 산업이 없습니다.';
    el('scenario-run').disabled=!basket.length||!currentDataset;
    el('scenario-list').querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{
      basket.splice(Number(b.dataset.remove),1);el('impact-results').hidden=true;lastResult=null;renderBasket();
    }));
  }
  el('scenario-form').addEventListener('submit',e=>{
    e.preventDefault();const code=el('impact-sector').value,amount=Number(el('impact-amount').value);
    const industry=sectors.find(s=>s.code===code);
    if(!industry||!Number.isFinite(amount)||amount<=0){el('impact-status').textContent='산업과 양(+)의 최종수요 증가액을 입력해 주세요.';return;}
    basket.push({...industry,amount});lastResult=null;el('impact-results').hidden=true;renderBasket();
    el('impact-status').textContent=basket.length+'개 산업이 추가됐습니다. 파급효과 계산 버튼을 눌러 주세요.';
  });
  el('scenario-clear').addEventListener('click',()=>{basket=[];lastResult=null;el('impact-results').hidden=true;renderBasket();el('impact-status').textContent='시나리오를 비웠습니다.';});
  el('scenario-run').addEventListener('click',async()=>{
    if(!basket.length)return;
    const shocks=basket.map(s=>({code:s.code,amount:s.amount}));
    el('scenario-run').disabled=true;el('impact-status').textContent='파급효과 계산 중…';
    try{
      const result=await call('simulate',shocks);lastResult=result;
      const stat=[['최종수요 증가액',result.demand],['생산유발액',result.production],['수입유발액',result.imports],['부가가치유발액',result.valueAdded]];
      el('impact-stats').innerHTML=stat.map(([label,value])=>`<div class="result-box"><span>${label} / 백만원</span><strong>${fmt(value,2)}</strong></div>`).join('');
      const rows=result.rows.slice(0,10),max=Math.max(1,...rows.map(r=>r.production));
      el('impact-bars').innerHTML=rows.map(r=>`<div class="bar-row"><label title="${esc(r.name)}">${esc(r.name)}</label><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,100*r.production/max)}%"></div></div><output>${fmt(r.production,1)}</output></div>`).join('');
      el('impact-results').hidden=false;
      el('impact-status').textContent='계산 완료 · 국내 생산물 최종수요 증가를 기준으로 계산했습니다.';
    }catch(e){el('impact-status').textContent='계산 실패: '+e.message;}
    finally{el('scenario-run').disabled=!basket.length||!currentDataset;}
  });
  el('csv-download').addEventListener('click',()=>{
    if(!lastResult)return;
    const rows=[['코드','산업','생산유발액(백만원)','수입유발액(백만원)','부가가치유발액(백만원)'],
      ...lastResult.rows.map(r=>[r.code,r.name,r.production,r.imports,r.valueAdded])];
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download=`산업파급효과_${currentDataset||'분류'}.csv`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });

  // 원자료: 기존 Python 함수 explore(sheet, row)를 이용.
  let archiveSerial=0;
  async function archiveExplore(rebuild=false){
    if(!currentDataset)return;
    const local=++archiveSerial,sheet=el('archive-sheet').value;
    try{
      const raw=await call('explore',{sheet,row:rebuild?'':el('archive-row').value});
      if(local!==archiveSerial)return;
      archiveRows=raw.rows;archiveCells=raw.cells;activeArchiveCode=raw.selected;
      if(rebuild){el('archive-row').replaceChildren(...archiveRows.map(r=>{const o=document.createElement('option');o.value=r.code;o.textContent=r.code+' · '+r.name;return o;}));el('archive-search').value='';}
      if([...el('archive-row').options].some(o=>o.value===raw.selected))el('archive-row').value=raw.selected;
      el('archive-description').textContent=sheet+' · '+raw.selected+' '+raw.name;
      el('archive-unit').textContent=raw.unit||'계수';
      renderCells();
    }catch(e){if(local===archiveSerial)el('archive-description').textContent='자료 오류: '+e.message;}
  }
  function renderCells(){
    const query=el('archive-column').value.trim().toLocaleLowerCase();
    const rows=archiveCells.filter(r=>(r.code+' '+r.name).toLocaleLowerCase().includes(query));
    const body=el('archive-cells');
    body.replaceChildren(...rows.map(r=>{
      const tr=document.createElement('tr');
      for(const txt of [r.code,r.name,typeof r.value==='number'?fmt(r.value,6):r.value??'빈 셀']){
        const td=document.createElement('td');td.textContent=String(txt);tr.append(td);
      }return tr;
    }));
    if(!rows.length)body.innerHTML='<tr><td colspan="3">검색 결과가 없습니다.</td></tr>';
  }
  el('archive-sheet').addEventListener('change',()=>archiveExplore(true));
  el('archive-row').addEventListener('change',()=>archiveExplore(false));
  el('archive-search').addEventListener('input',()=>{
    const query=el('archive-search').value.trim().toLocaleLowerCase(),prev=el('archive-row').value;
    const matches=archiveRows.filter(r=>(r.code+' '+r.name).toLocaleLowerCase().includes(query));
    const node=el('archive-row');node.replaceChildren(...matches.map(r=>{const o=document.createElement('option');o.value=r.code;o.textContent=r.code+' · '+r.name;return o;}));
    if(matches.some(r=>r.code===prev))node.value=prev;
    if(matches.length)archiveExplore(false);else{archiveCells=[];renderCells();}
  });
  el('archive-column').addEventListener('input',renderCells);
  renderBasket();
})();
