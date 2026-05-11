/**
 * pastMeditations.js — 지난 묵상 리스트 뷰
 *
 * meditations 컬렉션에서 사용자의 모든 묵상 노트를 가져와 날짜 역순으로 카드 리스트.
 * 각 카드: 날짜 + 본문 미리보기(앞 두 줄) + 클릭 시 펼치기.
 */

import { db, collection, query, where, getDocs } from '../data/firebase.js';
import { readDocument } from '../crypto/cryptoService.js';
import { getDEK } from './lockScreen.js';

export async function renderPastMeditationsView(userId) {
    const container = document.getElementById('past-meditations-list');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = '<div class="empty-state"><i class="empty-state-icon" data-lucide="lock"></i><h3>잠시 잠겨있어요</h3><p class="empty-state-desc">비밀번호로 열어주세요.</p></div>';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    container.innerHTML = '<div class="spinner" style="margin: 40px auto"></div>';

    let docs = [];
    try {
        // Firestore composite index 회피: where만 쓰고 정렬은 클라이언트에서
        const q = query(
            collection(db, 'meditations'),
            where('userId', '==', userId),
        );
        const snap = await getDocs(q);
        // date 내림차순 정렬 (문자열 비교 — "2026-05-10" 형식이라 안전)
        docs = snap.docs.slice().sort((a, b) => {
            const da = a.data().date || '';
            const db_ = b.data().date || '';
            return db_.localeCompare(da);
        });
    } catch (e) {
        console.error('past meditations load failed:', e);
        container.innerHTML = `
            <div class="empty-state">
                <i class="empty-state-icon" data-lucide="cloud-off"></i>
                <h3>묵상 노트를 못 가져왔어요</h3>
                <p class="empty-state-desc">${e?.message || '잠깐 문제가 있었어요. 다시 한 번 해볼까요?'}</p>
            </div>
        `;
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    if (docs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="empty-state-icon" data-lucide="scroll-text"></i>
                <h3>아직 적어둔 묵상이 없어요</h3>
                <p class="empty-state-desc">
                    오늘 화면에서 말씀을 곱씹고 한 줄 적어 보세요.<br>
                    1초 뒤 자동으로 안전하게 보관돼요.
                </p>
                <p style="margin-top:24px;font-size:12px;color:var(--ink-secondary)">
                    예전에 적은 묵상이 보이지 않는다면,<br>
                    <strong>설정 → 데이터 복구</strong>에서 진단해 볼까요?
                </p>
            </div>
        `;
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    // 복호화 + 카드 렌더
    const items = [];
    for (const d of docs) {
        try {
            const data = await readDocument(dek, d.data());
            items.push({
                id: d.id,
                date: data.date,
                content: data.content || '',
                createdAt: data.createdAt,
            });
        } catch (e) {
            console.warn(`decrypt failed for ${d.id}:`, e);
        }
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="empty-state-icon" data-lucide="alert-triangle"></i>
                <h3>묵상 노트를 못 열었어요</h3>
                <p class="empty-state-desc">
                    잠금 열쇠가 맞지 않거나 데이터가 살짝 흔들린 것 같아요.<br>
                    설정에서 한 번 더 진단해 볼까요?
                </p>
            </div>
        `;
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    // 검색·필터 UI
    container.innerHTML = `
        <div class="past-toolbar">
            <input id="past-search" type="search" class="past-search"
                   placeholder="키워드로 찾기 (책 이름, 본문 단어 등) — 본문에서 검색" />
            <input id="past-from" type="date" class="past-date-input" title="시작 날짜" />
            <span style="color:var(--text-secondary)">~</span>
            <input id="past-to" type="date" class="past-date-input" title="끝 날짜" />
        </div>
        <div id="past-results" class="past-list"></div>
    `;

    const searchInput = container.querySelector('#past-search');
    const fromInput = container.querySelector('#past-from');
    const toInput = container.querySelector('#past-to');
    const results = container.querySelector('#past-results');

    const renderResults = () => {
        const keyword = (searchInput.value || '').trim().toLowerCase();
        const from = fromInput.value;
        const to = toInput.value;

        const filtered = items.filter(item => {
            if (from && item.date < from) return false;
            if (to && item.date > to) return false;
            if (keyword && !(item.content || '').toLowerCase().includes(keyword)) return false;
            return true;
        });

        if (filtered.length === 0) {
            results.innerHTML = `
                <div class="empty-state" style="padding: var(--sp-5)">
                    <p>조건에 맞는 묵상이 없어요. 키워드를 바꿔 볼까요?</p>
                </div>
            `;
            return;
        }

        // Phase E-8/A: 게시판 스타일 — 날짜·요일만. 클릭 시 해당 날짜의 "오늘" 뷰로 점프.
        results.innerHTML = `
            <ul class="past-board" role="list">
                ${filtered.map(item => `
                    <li class="past-row" data-id="${item.id}" data-date="${item.date}" tabindex="0" role="link"
                        title="이 날짜의 오늘 화면 열기">
                        <span class="past-row-date">${formatDate(item.date)}</span>
                        <span class="past-row-day">${dayOfWeek(item.date)}</span>
                        <i class="past-row-chev" data-lucide="chevron-right"></i>
                    </li>
                `).join('')}
            </ul>
        `;

        // 클릭/엔터 → __sanctumGoToDate
        const jump = (dateStr) => {
            if (!dateStr) return;
            if (typeof window.__sanctumGoToDate === 'function') {
                window.__sanctumGoToDate(dateStr);
            }
        };
        results.querySelectorAll('.past-row').forEach(row => {
            row.addEventListener('click', () => jump(row.dataset.date));
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    jump(row.dataset.date);
                }
            });
        });
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    };

    searchInput.addEventListener('input', renderResults);
    fromInput.addEventListener('change', renderResults);
    toInput.addEventListener('change', renderResults);
    renderResults();
}

function formatDate(dateStr) {
    if (!dateStr) return '?';
    const [y, m, d] = dateStr.split('-');
    return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

function dayOfWeek(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()] + '요일';
}
