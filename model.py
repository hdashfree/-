"""2023년 투입산출표 분석: 기본·소·중·대 분류 공통 엔진.

교수님 Sample_IO의 계산식과 12개 시트 구조는 유지하고,
380부문만 허용하던 부분을 33/83/165/380부문으로 확장합니다.
"""
import io
import json

import numpy as np
import openpyxl

book = None


def emit(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def initialize(raw):
    global book, codes, names, L, M, V, ad, am, sheets, valid

    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    book = {s: list(wb[s].values) for s in wb.sheetnames}
    wb.close()
    sheets = list(book)

    required = ['국산투입계수(Ad)', '총투입계수(A)', '수입투입계수(Am)',
                '생산유발계수', '수입유발계수', '부가가치유발계수']
    missing = [s for s in required if s not in book]
    if missing:
        raise ValueError('필수 시트가 없습니다: ' + ', '.join(missing))

    base = book['국산투입계수(Ad)']
    # A열 상품코드는 기본부문 4자리, 소분류 3자리,
    # 중분류 2자리, 대분류 영문 문자/영숫자 조합입니다.
    # 9090은 네 분류 모두에서 분석 대상 33/83/165/380부문 외의 별도 열입니다.
    nm = {str(r[0]): str(r[1]) for r in base[6:]
          if len(r) > 1 and r[0] is not None and r[1] is not None}
    codes = [str(c) for c in base[4][2:]
             if c is not None and str(c) != '9090' and str(c) in nm]
    if len(codes) not in (33, 83, 165, 380) or len(set(codes)) != len(codes):
        raise ValueError('지원하지 않는 산업분류/파일 구조입니다 (33, 83, 165, 380부문 필요).')
    names = [nm[c] for c in codes]

    def matrix(sheet):
        rows = book[sheet]
        ri = {str(r[0]): i for i, r in enumerate(rows) if r}
        ci = {str(c): i for i, c in enumerate(rows[4])}
        try:
            arr = np.array([[rows[ri[r]][ci[c]] for c in codes]
                            for r in codes], dtype=float)
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise ValueError(sheet + ': 산업코드/수치 배치 확인 필요') from exc
        if not np.isfinite(arr).all():
            raise ValueError(sheet + ': 비수치 또는 결측 데이터')
        return arr

    L = matrix('생산유발계수')
    M = matrix('수입유발계수')
    V = matrix('부가가치유발계수')
    ad = matrix('국산투입계수(Ad)')
    am = matrix('수입투입계수(Am)')

    rows = book['총투입계수(A)']
    ci = {str(c): i for i, c in enumerate(rows[4])}
    vr = next((r for r in rows if str(r[0]) == '9690'), None)
    if vr is None:
        raise ValueError('총투입계수(A)의 부가가치계수(9690) 행이 없습니다.')
    v = np.array([vr[ci[c]] for c in codes], dtype=float)

    residuals = {
        '생산': float(np.max(np.abs((np.eye(len(codes))-ad) @ L-np.eye(len(codes))))),
        '수입': float(np.max(np.abs(am @ L-M))),
        '부가가치': float(np.max(np.abs(v[:, None] * L-V))),
    }
    valid = max(residuals.values()) < 1e-8
    if not valid:
        raise ValueError('계수 검증 실패: ' + str(residuals))
    return emit({'sectors': [{'code': c, 'name': n} for c, n in zip(codes, names)],
                 'sheets': sheets, 'residuals': residuals})


def explore(sheet, rowcode):
    rows = book[sheet]
    choices = [{'code': str(r[0]), 'name': str(r[1])} for r in rows[6:]
               if len(r) > 1 and r[0] is not None and r[1] is not None]
    chosen = next((r for r in rows[6:] if str(r[0]) == rowcode), None)
    if chosen is None:
        chosen = next(r for r in rows[6:] if r[0] is not None and r[1] is not None)
    cells = []
    for i in range(2, len(rows[4])):
        if rows[4][i] is None:
            continue
        value = chosen[i] if i < len(chosen) else None
        if isinstance(value, (float, int)):
            value = float(value)
        elif value is not None:
            value = str(value)
        cells.append({'code': str(rows[4][i]),
                      'name': str(rows[5][i] or ''), 'value': value})
    return emit({'rows': choices, 'selected': str(chosen[0]), 'name': str(chosen[1]),
                 'unit': str(rows[3][0] or '계수').replace('係数', '계수 / 비율: 행·열 명칭 확인'),
                 'cells': cells})


def simulate(payload):
    if not valid:
        raise ValueError('검증된 데이터가 없습니다.')
    shocks = json.loads(payload)
    f = np.zeros(len(codes))
    for s in shocks:
        amount = float(s['amount'])
        if not np.isfinite(amount) or amount < 0:
            raise ValueError('수요 증가액은 유한한 0 이상의 수여야 합니다.')
        f[codes.index(s['code'])] += amount
    if not f.sum() > 0:
        raise ValueError('한 산업 이상의 양의 수요 증가액을 입력하세요.')
    x = L @ f
    m = M @ f
    va = V @ f
    result = [{'code': c, 'name': n,
               'production': float(a), 'imports': float(b), 'valueAdded': float(d)}
              for c, n, a, b, d in zip(codes, names, x, m, va)]
    result.sort(key=lambda r: r['production'], reverse=True)
    return emit({'demand': float(f.sum()), 'production': float(x.sum()),
                 'imports': float(m.sum()), 'valueAdded': float(va.sum()),
                 'multiplier': float(x.sum()/f.sum()), 'rows': result})


def fingerprint(column_code):
    """선택한 산업(열)에 투입된 각 공급 산업(행)의 계수.

    A[i,j]는 j부문 생산 1단위에 투입된 i부문 중간재의 크기를 뜻합니다.
    표의 합계·요약 행과 9090 등 분석대상 이외의 부문은 제외합니다.
    """
    if not valid:
        raise ValueError('검증된 산업연관표를 먼저 불러오세요.')
    column_code = str(column_code)
    if column_code not in codes:
        raise ValueError('선택한 산업코드를 찾을 수 없습니다: ' + column_code)

    col = codes.index(column_code)

    def one_column(matrix):
        return {
            'selected': column_code,
            'name': names[col],
            'cells': [
                {'code': codes[row], 'name': names[row], 'value': float(matrix[row, col])}
                for row in range(len(codes))
            ]
        }

    return emit({'domestic': one_column(ad), 'imported': one_column(am)})
