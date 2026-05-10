/**
 * todayView.js — 오늘 화면 컴포넌트
 *
 * 책임:
 * - 핀 원칙 띠 (항상 노출, 핀 원칙 변경 시 갱신)
 * - 묵상 노트 자동 저장 (디바운스 1초, 암호화 후 Firestore)
 * - 결단 패널: 동적 리스트 + 추가/수정/삭제 + 드래그 핸들 (drop은 timeline.js가 처리)
 * - 통합 타임라인 진입점은 별도 파일(Chunk 3에서 timeline.js 신규)
 */

import { db, doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp } from '../data/firebase.js';
import { readDocument, prepareDocument } from '../crypto/cryptoService.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import {
    getDecisionsByDate, saveDecision, deleteDecision
} from '../data/decisionsRepo.js';
import { getReport } from '../data/reportPipeline.js';
import { generateLocalFallback } from '../infra/cloudFunctionProxy.js';

let _userId = null;
let _date = null;
let _decisions = [];

/**
 * 오늘 뷰 초기화 (앱 시작 시 1회)
 */
export function initTodayView({ userId, date }) {
    _userId = userId;
    _date = date;
    bindMeditationAutosave();
    bindDecisionsPanel();
    bindNextDayButton();
}

/**
 * 날짜 변경 시 호출 — 핀/노트/결단 다시 로드
 */
export async function refreshTodayView({ userId, date }) {
    _userId = userId;
    _date = date;
    const dek = getDEK();
    if (!dek) return;
    await loadPinnedPrinciple(dek);
    await loadMeditationNote(dek);
    await loadDecisions(dek);
    await loadTodayReport(dek);
}

// ─── 오늘 리포트 카드 (시간표 하단) ───
async function loadTodayReport(dek) {
    const body = document.getElementById('today-report-body');
    if (!body) return;
    try {
        const report = await getReport(dek, 'dayReports', `${_userId}_${_date}`);
        if (!report) {
            body.innerHTML = `
                <p style="color:var(--text-secondary); font-size:13px">
                    시간표에서 도트 평가를 채워가면, 오늘의 결이 여기에 자동으로 정리돼요.
                </p>
            `;
            return;
        }
        const stats = report.stats || {};
        const fallback = generateLocalFallback(stats);
        body.innerHTML = `
            <div class="el-stat-row">
                <div class="el-stat"><span class="el-stat-num">${stats.doneCount || 0}<small>/${stats.totalSlots || 0}</small></span><span class="el-stat-lbl">완료</span></div>
                <div class="el-stat"><span class="el-stat-num">${stats.avgSatisfaction || '-'}</span><span class="el-stat-lbl">만족도</span></div>
                <div class="el-stat"><span class="el-stat-num">${stats.matchRate || 0}<small>%</small></span><span class="el-stat-lbl">계획 일치율</span></div>
            </div>
            <div class="ai-summary-card" style="margin-top: 12px">
                <p>${escapeHtml(report.aiSummary || fallback.aiSummary)}</p>
            </div>
        `;
    } catch (e) {
        console.warn('today report load failed:', e);
        body.innerHTML = `<p style="color:var(--text-secondary); font-size:13px">리포트를 불러오는 중에 잠깐 막혔어요.</p>`;
    }
}

// ─── 다음 날 묵상 버튼 ───
function bindNextDayButton() {
    const btn = document.getElementById('next-day-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (typeof window.__sanctumGoToNextDay === 'function') {
            window.__sanctumGoToNextDay();
        }
    });
}

// ─── 핀 원칙 띠 ───
async function loadPinnedPrinciple(dek) {
    const banner = document.getElementById('pinned-principle-banner');
    const text = document.getElementById('pinned-principle-text');
    if (!banner || !text) return;

    try {
        const q = query(
            collection(db, 'principles'),
            where('userId', '==', _userId),
            where('pinned', '==', true)
        );
        const snap = await getDocs(q);
        if (snap.docs.length === 0) {
            banner.classList.add('hidden');
            return;
        }
        const data = await readDocument(dek, snap.docs[0].data());
        text.textContent = data.title || '';
        banner.classList.remove('hidden');
    } catch (e) {
        console.warn('pinned principle load failed:', e);
        banner.classList.add('hidden');
    }
}

// ─── 묵상 노트 자동 저장 (디바운스 1초) ───
let _saveTimer = null;

function bindMeditationAutosave() {
    const editor = document.getElementById('meditation-note');
    if (!editor) return;

    editor.addEventListener('input', () => {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => saveMeditationNote(editor.innerText), 1000);
    });

    // 외부에서 복사해 온 텍스트는 폰트/배경/색상 인라인 스타일을 모두 떼고
    // 순수 텍스트만 받아 옴 → 묵상 노트 폰트(프리텐다드)와 테마 색상이 그대로 적용됨
    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const cd = e.clipboardData || window.clipboardData;
        const text = cd ? cd.getData('text/plain') : '';
        if (!text) return;
        // execCommand는 deprecated이지만 contenteditable 호환성이 가장 좋음
        if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
            document.execCommand('insertText', false, text);
        } else {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
        }
    });
}

async function saveMeditationNote(content) {
    const dek = getDEK();
    if (!dek || !_userId || !_date) return;

    const status = document.getElementById('meditation-save-status');
    if (status) status.textContent = '저장하는 중...';

    try {
        const id = `meditation_${_userId}_${_date}`;
        const meta = { id, userId: _userId, date: _date, createdAt: serverTimestamp() };
        const sensitive = { content };
        const document_ = await prepareDocument(dek, meta, sensitive);
        await setDoc(doc(db, 'meditations', id), document_, { merge: true });

        if (status) {
            status.textContent = '🔐 안전하게 보관됐어요';
            setTimeout(() => { if (status) status.textContent = ''; }, 1500);
        }
    } catch (e) {
        console.error('meditation save failed:', e);
        if (status) status.textContent = '저장이 잘 안 됐어요';
    }
}

async function loadMeditationNote(dek) {
    const editor = document.getElementById('meditation-note');
    if (!editor) return;

    try {
        const id = `meditation_${_userId}_${_date}`;
        const snap = await getDoc(doc(db, 'meditations', id));
        if (snap.exists()) {
            const data = await readDocument(dek, snap.data());
            editor.innerText = data.content || '';
        } else {
            editor.innerText = '';
        }
    } catch (e) {
        console.warn('meditation load failed:', e);
        editor.innerText = '';
    }
}

// ─── 결단 패널 ───
function bindDecisionsPanel() {
    const addBtn = document.getElementById('decision-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addNewDecision);
    }
}

async function loadDecisions(dek) {
    try {
        _decisions = await getDecisionsByDate(dek, _userId, _date);
    } catch (e) {
        console.error('decisions load failed:', e);
        _decisions = [];
    }
    renderDecisions();
}

function renderDecisions() {
    const list = document.getElementById('decisions-list');
    if (!list) return;

    if (_decisions.length === 0) {
        list.innerHTML = `
            <p style="font-size:12px;color:var(--text-secondary);padding:8px;">
                아직 결단이 없어요. 아래 [+ 새 결단 적기]를 눌러 시작해 볼까요?
            </p>
        `;
        return;
    }

    list.innerHTML = _decisions.map(d => renderDecisionCard(d)).join('');
    bindCardEvents();
}

function renderDecisionCard(d) {
    const placed = d.timeSlot != null;
    const slotLabel = placed
        ? `⏰ ${slotToTime(d.timeSlot)}~${slotToTime(d.timeSlot + (d.durationSlots || 4))}`
        : '미배치';
    return `
        <div class="decision-card ${placed ? 'placed' : ''}" data-id="${d.id}">
            <span class="decision-handle" draggable="true" title="잡고 시간표로 끌어 옮겨 보세요">⋮⋮</span>
            <input type="text" class="decision-text" value="${escapeHtml(d.text || '')}"
                   placeholder="오늘 어디에 순종할까요?" data-id="${d.id}" />
            <span class="decision-slot">${slotLabel}</span>
            <button class="decision-action delete-btn" data-id="${d.id}" title="삭제">×</button>
        </div>
    `;
}

function slotToTime(slot) {
    const h = Math.floor(slot / 4);
    const m = (slot % 4) * 15;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function bindCardEvents() {
    const list = document.getElementById('decisions-list');
    if (!list) return;

    // 텍스트 인라인 편집 (blur 시 저장 + Enter 시 다음 결단으로)
    list.querySelectorAll('.decision-text').forEach(input => {
        input.addEventListener('blur', async () => {
            const id = input.dataset.id;
            const decision = _decisions.find(d => d.id === id);
            if (!decision) return;
            const newText = input.value.trim();
            if (newText === decision.text) return;
            decision.text = newText;
            const dek = getDEK();
            if (dek) await saveDecision(dek, decision);
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const id = input.dataset.id;
            const decision = _decisions.find(d => d.id === id);
            const value = input.value.trim();
            // 변경이 있으면 먼저 저장
            if (decision && value !== decision.text) {
                decision.text = value;
                const dek = getDEK();
                if (dek) await saveDecision(dek, decision);
            }
            if (value) {
                // 빈 카드가 아니면 다음 결단을 새로 만들고 그 카드 input에 포커스
                await addNewDecision();
            } else {
                // 빈 카드에서 엔터는 무한 추가 방지 — 그냥 빠져나오기
                input.blur();
            }
        });
    });

    // 삭제 버튼
    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!confirm('이 결단을 지워도 괜찮을까요?')) return;
            await deleteDecision(id);
            _decisions = _decisions.filter(d => d.id !== id);
            renderDecisions();
        });
    });

    // 드래그 시작 — 핸들(⋮⋮)에서만 시작.
    // 카드 전체를 draggable로 두면 input 위 마우스다운이 텍스트 선택으로 가버려서
    // 드래그 자체가 시작되지 않는 문제가 있음.
    list.querySelectorAll('.decision-handle').forEach(handle => {
        handle.addEventListener('dragstart', (e) => {
            const card = handle.closest('.decision-card');
            if (!card) return;
            const id = card.dataset.id;
            try { e.dataTransfer.setData('application/x-sanctum-decision', id); } catch {}
            try { e.dataTransfer.setData('text/plain', id); } catch {} // fallback
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        handle.addEventListener('dragend', () => {
            handle.closest('.decision-card')?.classList.remove('dragging');
        });
    });
}

async function addNewDecision() {
    const dek = getDEK();
    if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return; }

    const newDecision = {
        userId: _userId,
        date: _date,
        text: '',
        timeSlot: null,
        durationSlots: 4,
        order: _decisions.length,
    };
    await saveDecision(dek, newDecision);
    _decisions.push(newDecision);
    renderDecisions();

    // 새로 추가된 입력란에 포커스
    setTimeout(() => {
        const inputs = document.querySelectorAll('.decision-text');
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
    }, 50);
}

/** 외부에서 결단 목록 직접 접근 — Chunk 3의 timeline.js가 박힌 결단 렌더에 사용 */
export function getDecisions() { return _decisions; }
export function getDecisionById(id) { return _decisions.find(d => d.id === id); }
