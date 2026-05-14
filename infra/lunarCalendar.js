/**
 * lunarCalendar.js — 음력 ↔ 양력 변환 헬퍼 (#58 후속 2026-05-14)
 *
 * 라이브러리: korean-lunar-calendar (한국 음력 1881~2050 지원)
 *   ESM CDN: https://esm.sh/korean-lunar-calendar
 *
 * 로딩 전략: lazy — 첫 호출 시 동적 import. 실패 시 모든 음력 함수가 null 반환.
 *
 * 1차 한계 (윤달 처리 X — 사용자 입력 UI 에 윤달 토글 없음).
 *   "음력 8월 15일" 같은 표기는 모두 평달로 간주. 윤달 케이스는 다음 트랙.
 */

let _libPromise = null;
let _libUnavailable = false;

/**
 * 라이브러리 동적 로드 (lazy + cached).
 * @returns {Promise<class|null>} KoreanLunarCalendar 클래스 or null (실패 시)
 */
export async function loadLunar() {
    if (_libUnavailable) return null;
    if (_libPromise) return _libPromise;

    _libPromise = (async () => {
        try {
            const mod = await import('https://esm.sh/korean-lunar-calendar@0.3.1');
            // CJS/ESM 양쪽 호환 — default export 우선, 없으면 module 자체
            const Klass = mod.default || mod.KoreanLunarCalendar || mod;
            if (typeof Klass !== 'function') throw new Error('Unexpected library shape');
            return Klass;
        } catch (e) {
            console.warn('[lunarCalendar] 라이브러리 로드 실패 — 음력 변환 비활성:', e?.message || e);
            _libUnavailable = true;
            return null;
        }
    })();
    return _libPromise;
}

/**
 * 자유 텍스트 생일에서 (year?, month, day) 추출.
 *
 * 지원 형식:
 *   "1985-08-15", "1985/8/15", "1985.08.15"   → { year:1985, month:8, day:15 }
 *   "08-15", "8/15", "8월 15일"                  → { year:null, month:8, day:15 }
 *   "음력 1985년 8월 15일", "음력 8월 15일"       → 한글 추출
 *
 * @returns {{year:number|null, month:number, day:number} | null}
 */
export function parseBirthdayMonthDay(text) {
    if (!text) return null;
    const s = String(text).trim();
    if (!s) return null;

    // 1) YYYY-MM-DD (가장 명시적)
    const iso = s.match(/(\d{4})[\s.\-/년]+(\d{1,2})[\s.\-/월]+(\d{1,2})/);
    if (iso) {
        const y = +iso[1], m = +iso[2], d = +iso[3];
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { year: y, month: m, day: d };
    }

    // 2) MM-DD 또는 "8월 15일"
    const md = s.match(/(\d{1,2})[\s.\-/월]+(\d{1,2})/);
    if (md) {
        const m = +md[1], d = +md[2];
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { year: null, month: m, day: d };
    }

    return null;
}

/**
 * 음력 (month, day) → 특정 양력 연도의 (year, month, day) 변환.
 *
 * @param {number} lunarMonth 1~12
 * @param {number} lunarDay   1~30
 * @param {number} solarYear  양력 기준 연도
 * @param {boolean} isIntercalation 윤달 여부 (1차에서 항상 false)
 * @returns {Promise<{year, month, day} | null>} 실패 시 null
 */
export async function lunarToSolarForYear(lunarMonth, lunarDay, solarYear, isIntercalation = false) {
    const Lib = await loadLunar();
    if (!Lib) return null;
    try {
        const cal = new Lib();
        // korean-lunar-calendar 는 setLunarDate(year, month, day, intercalation) — 음력 연도 필요.
        // 음력 입력에서 사용자가 연도 안 적은 경우(year=null) → solarYear 그대로 음력 연도로 사용
        //   (음력 연도와 양력 연도는 보통 같지만, 1~2월 음력은 양력 전년에 해당하는 경우 있음 —
        //    실용상 양력 연도 그대로 시도 → 실패 시 ±1년 재시도)
        cal.setLunarDate(solarYear, lunarMonth, lunarDay, !!isIntercalation);
        const solar = cal.getSolarCalendar();
        if (!solar || !solar.year) return null;
        return { year: solar.year, month: solar.month, day: solar.day };
    } catch (e) {
        console.warn('[lunarCalendar] 변환 실패:', e?.message || e);
        return null;
    }
}

/**
 * 음력 생일을 오늘 기준 양력 날짜로 — 올해 또는 (이미 지났으면) 내년.
 * 자동 알람·UI 미리보기용.
 *
 * @returns {Promise<{year, month, day, daysUntil:number} | null>}
 */
export async function lunarBirthdayToUpcomingSolar(lunarMonth, lunarDay, todayStr = null) {
    const today = todayStr ? new Date(todayStr + 'T00:00:00') : new Date();
    const thisYear = today.getFullYear();

    // 올해 양력 후보
    let solar = await lunarToSolarForYear(lunarMonth, lunarDay, thisYear);
    if (!solar) return null;
    let target = new Date(solar.year, solar.month - 1, solar.day);
    // 이미 지났으면 내년 음력 → 양력 재계산
    if (target < today) {
        const nextYear = thisYear + 1;
        const solarNext = await lunarToSolarForYear(lunarMonth, lunarDay, nextYear);
        if (solarNext) {
            solar = solarNext;
            target = new Date(solar.year, solar.month - 1, solar.day);
        }
    }
    const days = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    return { ...solar, daysUntil: days };
}

/**
 * 양력 생일(month, day)이 오늘 기준 며칠 후인지 — 양력 단순 계산.
 * @returns {number} 0=오늘, 1=내일, ...
 */
export function solarBirthdayDaysUntil(month, day, todayStr = null) {
    const today = todayStr ? new Date(todayStr + 'T00:00:00') : new Date();
    today.setHours(0, 0, 0, 0);
    let target = new Date(today.getFullYear(), month - 1, day);
    if (target < today) target = new Date(today.getFullYear() + 1, month - 1, day);
    return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}
