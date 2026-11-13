// 교수님 예제의 원자료 탐색·시뮬레이터를 그대로 이용하여
// 2023년 33/83/165/380부문 자료 중 선택할 수 있게 합니다.
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
  wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;';
  const buttons = [originalButton];
  originalButton.textContent = '기본부문 (380개) 불러오기';

  // 사용자가 맥에서 업로드한 한글 파일명은 NFC 또는 NFD일 수 있으므로 둘 다 검사합니다.
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
  async function selectDataset(dataset) {
    buttons.forEach(b => b.disabled = true);
    const status = document.getElementById('status');
    try {
      status.textContent = dataset.label + ' 자료 다운로드 중…';
      const buffer = await fetchWorkbook(dataset.file);
      await load(buffer); // 기존 app.js의 load, worker.js 및 model.py 계산을 그대로 사용
      if (document.getElementById('sheet').disabled) return;
      if (sectors.length !== dataset.n) {
        throw new Error(dataset.label + ': 예상 부문 수와 실제 부문 수가 다릅니다.');
      }
      document.querySelector('header > p:first-child').textContent =
        '2023 · 생산자가격 · ' + dataset.label;
      const subtitle = document.querySelector('header > h1 + p');
      if (subtitle) subtitle.textContent =
        '12개 원자료 시트 탐색과 ' + dataset.n + '개 부문 수요충격 분석';
      document.getElementById('download').textContent =
        '전체 ' + dataset.n + '개 산업 CSV 다운로드';
      buttons.forEach(b => b.textContent = b.dataset.datasetKey === dataset.key
        ? dataset.label + ' (' + dataset.n + '개) 불러오기 완료'
        : datasets.find(x => x.key === b.dataset.datasetKey).label +
          ' (' + datasets.find(x => x.key === b.dataset.datasetKey).n + '개) 불러오기');
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
