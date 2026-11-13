(() => {
  const $ = id => document.getElementById(id);
  const svg = $('fingerprint-svg');
  if (!svg) return;

  const select = $('fp-sector');
  const search = $('fp-sector-search');
  const renderButton = $('fp-render');
  const nameEl = $('fp-name');
  const metaEl = $('fp-meta');
  const datasetEl = $('fp-dataset');
  const statsEl = $('fp-stats');
  const topEl = $('fp-top');

  let shownSectors = [];
  let activeCode = null;

  const fmt = (x, digits = 4) => Number(x).toLocaleString('ko-KR', { maximumFractionDigits: digits });
  const escapeText = (v) => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));

  function setPlaceholder() {
    svg.innerHTML = `
      <circle class="fingerprint-ring" cx="260" cy="260" r="158"></circle>
      <circle class="fingerprint-ring" cx="260" cy="260" r="124"></circle>
      <circle class="fingerprint-ring" cx="260" cy="260" r="90"></circle>
      <circle class="fingerprint-ring" cx="260" cy="260" r="56"></circle>
      <text class="fingerprint-label small" x="260" y="218">ECONOMIC</text>
      <text class="fingerprint-label main" x="260" y="256">FINGERPRINT</text>
      <text class="fingerprint-label sub" x="260" y="286">데이터를 불러오면 산업의 지문이 그려집니다.</text>
    `;
  }

  function populateSectorOptions(list) {
    select.replaceChildren(...list.map(s => {
      const o = document.createElement('option');
      o.value = s.code;
      o.textContent = s.code + ' ' + s.name;
      return o;
    }));
  }

  function shiftArray(arr, offset) {
    const n = arr.length;
    return arr.map((_, i) => arr[(i + offset) % n]);
  }

  function sampleValues(values, count) {
    const sampled = [];
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor(i * values.length / count);
      const end = Math.max(start + 1, Math.floor((i + 1) * values.length / count));
      const slice = values.slice(start, end);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      sampled.push(mean);
    }
    return sampled;
  }

  function smooth(values) {
    return values.map((_, i) => {
      const a = values[(i - 1 + values.length) % values.length];
      const b = values[i];
      const c = values[(i + 1) % values.length];
      return (a + 2 * b + c) / 4;
    });
  }

  function pathFromValues(values, baseR, amp, rotation = 0) {
    const cx = 260, cy = 260;
    return values.map((v, i) => {
      const angle = rotation + (Math.PI * 2 * i / values.length) - Math.PI / 2;
      const radius = baseR + v * amp;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ') + ' Z';
  }

  function renderStats(domesticValues, importValues) {
    const positives = domesticValues.filter(v => v > 0);
    const max = positives.length ? Math.max(...positives) : 0;
    const mean = domesticValues.length ? domesticValues.reduce((a, b) => a + b, 0) / domesticValues.length : 0;
    const importMean = importValues.length ? importValues.reduce((a, b) => a + b, 0) / importValues.length : 0;
    const nonZero = positives.length;
    statsEl.innerHTML = `
      <article class="stat-box"><span>최대 계수</span><strong>${fmt(max)}</strong></article>
      <article class="stat-box"><span>평균 계수</span><strong>${fmt(mean)}</strong></article>
      <article class="stat-box"><span>양(+)의 연결 수</span><strong>${fmt(nonZero, 0)}</strong></article>
      <article class="stat-box"><span>수입투입 평균</span><strong>${fmt(importMean)}</strong></article>
    `;
  }

  function renderTopList(cells) {
    const top = [...cells]
      .filter(c => typeof c.value === 'number' && isFinite(c.value) && c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    if (!top.length) {
      topEl.innerHTML = '<li>양(+)의 연결 산업이 없습니다.</li>';
      return;
    }

    topEl.innerHTML = top.map(item =>
      `<li><strong>${escapeText(item.name)}</strong> <span class="mini-note">(${escapeText(item.code)}) · ${fmt(item.value)}</span></li>`
    ).join('');
  }

  function renderFingerprint(domestic, imported) {
    const domesticValues = domestic.cells.map(c => typeof c.value === 'number' && isFinite(c.value) ? Math.max(0, c.value) : 0);
    const importValues = imported.cells.map(c => typeof c.value === 'number' && isFinite(c.value) ? Math.max(0, c.value) : 0);
    const peak = Math.max(...domesticValues, 0.0001);
    const transformed = domesticValues.map(v => Math.log1p(v * 120) / Math.log1p(peak * 120));
    const importPeak = Math.max(...importValues, 0.0001);
    const importTransformed = importValues.map(v => Math.log1p(v * 120) / Math.log1p(importPeak * 120));

    let base = smooth(sampleValues(transformed, 90));
    let secondary = smooth(sampleValues(importTransformed, 90));

    const ringGuides = [160, 128, 96, 64].map(r => `<circle class="fingerprint-ring" cx="260" cy="260" r="${r}"></circle>`).join('');
    const paths = [];
    for (let i = 0; i < 7; i += 1) {
      const rotated = shiftArray(base, i * 5);
      const d = pathFromValues(rotated, 62 + i * 14, 16 - i * 1.3, i * 0.1);
      paths.push(`<path class="fingerprint-path" d="${d}" stroke-width="${2.9 - i * 0.22}"></path>`);
    }
    for (let i = 0; i < 3; i += 1) {
      const rotated = shiftArray(secondary, i * 9);
      const d = pathFromValues(rotated, 66 + i * 36, 8, i * 0.22);
      paths.push(`<path class="fingerprint-path secondary" d="${d}" stroke-width="1.2" opacity="0.7"></path>`);
    }

    const shortName = domestic.name.length > 18 ? domestic.name.slice(0, 18) + '…' : domestic.name;
    svg.innerHTML = `
      ${ringGuides}
      ${paths.join('')}
      <circle class="fingerprint-core" cx="260" cy="260" r="28"></circle>
      <text class="fingerprint-label small" x="260" y="242">${escapeText((window.currentDatasetInfo?.label || '산업분류').toUpperCase())}</text>
      <text class="fingerprint-label main" x="260" y="268">${escapeText(domestic.selected)}</text>
      <text class="fingerprint-label sub" x="260" y="292">${escapeText(shortName)}</text>
    `;

    nameEl.textContent = domestic.selected + ' ' + domestic.name;
    metaEl.textContent = (window.currentDatasetInfo?.label || '산업분류') + ' · 국산투입계수 지문';
    renderStats(domesticValues, importValues);
    renderTopList(domestic.cells);
  }

  async function loadFingerprint(code) {
    if (!code || typeof call !== 'function') return;
    try {
      nameEl.textContent = '지문 생성 중…';
      metaEl.textContent = '시트 데이터를 읽는 중입니다.';
      // 기존 explore는 '행' 전체를 읽으므로 지문 데이터에 사용하지 않습니다.
      // fingerprint 작업은 선택한 산업의 '열'을 읽고 공급 산업들을 행으로 반환합니다.
      const { domestic, imported } = await call('fingerprint', { code });
      activeCode = code;
      renderFingerprint(domestic, imported);
      const simSector = $('sector');
      if (simSector && [...simSector.options].some(o => o.value === code)) simSector.value = code;
    } catch (error) {
      nameEl.textContent = '지문 생성 실패';
      metaEl.textContent = String(error.message || error);
    }
  }

  function filterSectors() {
    if (!Array.isArray(sectors) || !sectors.length) return;
    const q = search.value.trim();
    shownSectors = sectors.filter(s => (s.code + ' ' + s.name).includes(q));
    populateSectorOptions(shownSectors);
    if (!shownSectors.length) return;
    if (!shownSectors.some(s => s.code === activeCode)) activeCode = shownSectors[0].code;
    select.value = activeCode;
  }

  function readyUI() {
    [search, select, renderButton].forEach(el => el.disabled = false);
    datasetEl.textContent = `${window.currentDatasetInfo?.label || '산업분류'} / ${window.currentDatasetInfo?.n || sectors.length}개 부문`;
    filterSectors();
    if (shownSectors.length) loadFingerprint(select.value);
  }

  search.addEventListener('input', filterSectors);
  select.addEventListener('change', () => { activeCode = select.value; });
  renderButton.addEventListener('click', () => loadFingerprint(select.value));
  document.addEventListener('dataset-loaded', readyUI);

  setPlaceholder();
})();
