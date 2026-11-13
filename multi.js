// 33/83/165/380부문 자료 선택기 + 데이터셋 로드 알림
(() => {
  const datasets = [
    { key: 'basic', label: '기본부문', n: 380, file: 'io-2023.xlsx' },
    { key: 'small', label: '소분류', n: 165, file: '투입산출표_생산자가격_통합소분류.xlsx' },
    { key: 'medium', label: '중분류', n: 83, file: '투입산출표_생산자가격_통합중분류.xlsx' },
    { key: 'large', label: '대분류', n: 33, file: '투입산출표_생산자가격_통합대분류.xlsx' }
  ];

  const originalButton = document.getElementById('load-basic');
  if (!originalButton) return;

  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-label', '산업분류별 엑셀 파일 불러오기');
  wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;';
  const buttons = [originalButton];
  originalButton.textContent = '기본부문 (380개) 불러오기';

  async function fetchWorkbook(filename) {
    const alternatives = [...new Set([filename, filename.normalize('NFC'), filename.normalize('NFD')])];
    for (const name of alternatives) {
      const url = './data/' + encodeURIComponent(name);
      const response = await fetch(url);
      if (response.ok) return response.arrayBuffer();
      if (response.status !== 404) throw new Error('엑셀 다운로드 오류 (HTTP ' + response.status + ')');
    }
    throw new Error('GitHub data 폴더에서 ' + filename + '을(를) 찾을 수 없습니다.');
  }

  function relabelButtons(activeKey = null) {
    buttons.forEach(b => {
      const dataset = datasets.find(x => x.key === b.dataset.datasetKey);
      if (!dataset) return;
      b.textContent = activeKey === dataset.key
        ? dataset.label + ' (' + dataset.n + '개) 불러오기 완료'
        : dataset.label + ' (' + dataset.n + '개) 불러오기';
    });
  }

  async function selectDataset(dataset) {
    buttons.forEach(b => b.disabled = true);
    const status = document.getElementById('status');
    try {
      status.textContent = dataset.label + ' 자료 다운로드 중…';
      const buffer = await fetchWorkbook(dataset.file);
      await load(buffer);
      if (document.getElementById('sheet').disabled) return;
      if (sectors.length !== dataset.n) {
        throw new Error(dataset.label + ': 예상 부문 수와 실제 부문 수가 다릅니다.');
      }
      window.currentDatasetInfo = dataset;
      document.querySelector('header > p:first-child').textContent = '2023 · 생산자가격 · ' + dataset.label;
      const subtitle = document.querySelector('header > h1 + p');
      if (subtitle) subtitle.textContent = '산업마다 서로 다른 경제적 지문을 시각화하는 산업연관표 분석 웹앱';
      const downloadButton = document.getElementById('download');
      if (downloadButton) downloadButton.textContent = '전체 ' + dataset.n + '개 산업 CSV 다운로드';
      relabelButtons(dataset.key);
      document.dispatchEvent(new CustomEvent('dataset-loaded', { detail: { dataset } }));
    } catch (error) {
      status.textContent = '준비 실패: ' + error.message;
    } finally {
      buttons.forEach(b => b.disabled = false);
    }
  }

  originalButton.dataset.datasetKey = 'basic';
  originalButton.onclick = () => selectDataset(datasets[0]);

  for (const dataset of datasets.slice(1)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.datasetKey = dataset.key;
    button.textContent = dataset.label + ' (' + dataset.n + '개) 불러오기';
    button.onclick = () => selectDataset(dataset);
    wrapper.appendChild(button);
    buttons.push(button);
  }

  originalButton.parentElement.insertAdjacentElement('afterend', wrapper);
})();
