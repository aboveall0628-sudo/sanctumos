/**
 * economy.js — 경제 모듈 메인 뷰 (Phase F)
 *
 * 4탭: 거래 / 자산 / 부채 / 통계
 * 빈 상태일 때 "처음 시작하기" 마법사 — 통장 1개 + 자산 분류 1개 입력.
 *
 * 영적 안전장치 (docs/future-modules.md 정책):
 *   - 자산 총합 디폴트 숨김 (통계 탭이 디폴트 접힘)
 *   - 절대값(exactAmount/exactValue/exactPrincipal) 은 평소 마스킹.
 *     민감 모드(sensitive) 클래스 활용 — 클릭 시 5초 노출.
 *   - 카테고리 랭킹 / 부채 비율 X
 */

import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import { openModal } from './modalManager.js';
import {
    saveAccount, getAllAccounts, deleteAccount,
    saveAssetCategory, getAllAssetCategories, deleteAssetCategory,
    saveAsset, getAllAssets, deleteAsset,
    saveLiability, getAllLiabilities, deleteLiability,
    getTransactionsByDate, getTransactionsByDateRange, getAllTransactions, deleteTransaction,
    isEconomyEmpty,
    monthKey,
} from '../data/economyRepo.js';
import {
    AMOUNT_BUCKETS, bucketLabel, bucketIcon,
    INCOME_CATEGORIES, EXPENSE_CATEGORIES, categoryLabel, isGivingCategory,
} from '../config/economyBuckets.js';
import { openQuickAdd } from './economyQuickAdd.js';
import { runMonthlySnapshot } from './economySnapshots.js';

let _userId = null;
let _activeTab = 'transactions';
let _cache = { accounts: [], categories: [], assets: [], liabilities: [], transactions: [] };

export async function renderEconomyView(userId) {
    _userId = userId;
    const view = document.getElementById('view-economy');
    if (!view) return;

    const dek = getDEK();
    if (!dek) {
        view.innerHTML = '<p style="padding:24px">잠겨 있어요. 비밀번호로 먼저 열어 주실래요?</p>';
        return;
    }

    view.innerHTML = `
        <header class="page-header">
            <h1><i class="page-icon" data-lucide="wallet"></i> 경제</h1>
        </header>
        <div id="economy-body"></div>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    // 빈 상태 → 마법사
    const empty = await isEconomyEmpty(dek, userId);
    if (empty) {
        renderFirstRunWizard();
        return;
    }

    // 데이터 로드 + 탭 렌더
    await loadAll();
    renderTabs();
}

async function loadAll() {
    const dek = getDEK();
    if (!dek) return;
    try {
        const [accounts, categories, assets, liabilities] = await Promise.all([
            getAllAccounts(dek, _userId),
            getAllAssetCategories(dek, _userId),
            getAllAssets(dek, _userId),
            getAllLiabilities(dek, _userId),
        ]);
        _cache = { accounts, categories, assets, liabilities, transactions: [] };
    } catch (e) {
        console.error('[economy] loadAll failed:', e);
        showToast('경제 데이터를 불러오는 중에 잠깐 막혔어요.');
    }
}

// ═══════════════════════════════════════════════════
//  빈 상태 마법사 — 통장 1개 + 자산 분류 1개
// ═══════════════════════════════════════════════════

function renderFirstRunWizard() {
    const body = document.getElementById('economy-body');
    if (!body) return;
    body.innerHTML = `
        <div class="econ-wizard card-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="sparkles"></i> 처음 시작하기</h2>
            <p class="section-desc">
                돈도 사람·시간처럼 한 거울 안에서 정직하게 마주해요.
                먼저 자주 쓰는 통장 한 개와 자산 분류 한 가지를 만들어 볼게요.
                나머지는 천천히 늘려가도 괜찮아요.
            </p>

            <div class="econ-wizard-step">
                <h3>① 자주 쓰는 통장 한 개</h3>
                <div class="econ-form-row">
                    <input id="wiz-acc-name" type="text" placeholder="예: 주거래통장" maxlength="40" />
                    <select id="wiz-acc-type">
                        <option value="checking">입출금</option>
                        <option value="savings">적금·예금</option>
                        <option value="card">카드</option>
                        <option value="investment">투자 계좌</option>
                        <option value="cash">현금·기타</option>
                    </select>
                </div>
                <input id="wiz-acc-inst" type="text" placeholder="기관 (선택, 예: 신한은행)" maxlength="40" />
            </div>

            <div class="econ-wizard-step">
                <h3>② 자산 분류 하나</h3>
                <p class="section-desc" style="font-size:12px;margin-top:0">예: 현금, 주식, 적금, 부동산 ...</p>
                <input id="wiz-cat-name" type="text" placeholder="예: 현금" maxlength="20" value="현금" />
            </div>

            <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
                <button id="wiz-save-btn" class="primary-btn">시작하기</button>
                <button id="wiz-skip-btn" class="text-btn">건너뛰고 비어 둘게요</button>
            </div>
        </div>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    document.getElementById('wiz-save-btn')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        const accName = document.getElementById('wiz-acc-name').value.trim();
        const accType = document.getElementById('wiz-acc-type').value;
        const accInst = document.getElementById('wiz-acc-inst').value.trim();
        const catName = document.getElementById('wiz-cat-name').value.trim();
        if (!accName) { showToast('통장 이름을 한 글자만이라도 적어 주실래요?'); return; }
        if (!catName) { showToast('자산 분류 이름을 적어 주실래요?'); return; }
        try {
            await saveAccount(dek, _userId, {
                name: accName, type: accType, currency: 'KRW',
                institution: accInst || '', isPrimary: true,
            });
            await saveAssetCategory(dek, _userId, { name: catName, kind: 'asset' });
            showToast('🌱 경제 모듈을 시작했어요.');
            renderEconomyView(_userId);
        } catch (e) {
            console.error('[economy] wizard save failed:', e);
            showToast('저장이 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
        }
    });

    document.getElementById('wiz-skip-btn')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        // 빈 상태 회피용 placeholder 통장 1개만
        try {
            await saveAccount(dek, _userId, {
                name: '임시 통장', type: 'cash', currency: 'KRW', isPrimary: true,
            });
            renderEconomyView(_userId);
        } catch (e) {
            console.error('[economy] wizard skip failed:', e);
        }
    });
}

// ═══════════════════════════════════════════════════
//  탭 헤더
// ═══════════════════════════════════════════════════

function renderTabs() {
    const body = document.getElementById('economy-body');
    if (!body) return;
    body.innerHTML = `
        <div class="econ-tabs">
            <button class="econ-tab-btn ${_activeTab === 'transactions' ? 'active' : ''}" data-tab="transactions">
                <i data-lucide="receipt" class="btn-icon"></i> 거래
            </button>
            <button class="econ-tab-btn ${_activeTab === 'assets' ? 'active' : ''}" data-tab="assets">
                <i data-lucide="layers" class="btn-icon"></i> 자산
            </button>
            <button class="econ-tab-btn ${_activeTab === 'liabilities' ? 'active' : ''}" data-tab="liabilities">
                <i data-lucide="trending-down" class="btn-icon"></i> 부채
            </button>
            <button class="econ-tab-btn ${_activeTab === 'stats' ? 'active' : ''}" data-tab="stats">
                <i data-lucide="bar-chart-3" class="btn-icon"></i> 통계
            </button>
        </div>
        <div id="econ-tab-body" class="econ-tab-body"></div>
    `;
    body.querySelectorAll('.econ-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeTab = btn.dataset.tab;
            renderTabs();
        });
    });
    renderActiveTab();
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function renderActiveTab() {
    if (_activeTab === 'transactions') renderTransactionsTab();
    else if (_activeTab === 'assets') renderAssetsTab();
    else if (_activeTab === 'liabilities') renderLiabilitiesTab();
    else if (_activeTab === 'stats') renderStatsTab();
}

// ═══════════════════════════════════════════════════
//  거래 탭
// ═══════════════════════════════════════════════════

async function renderTransactionsTab() {
    const body = document.getElementById('econ-tab-body');
    if (!body) return;
    const dek = getDEK();
    if (!dek) return;

    body.innerHTML = `
        <div class="econ-toolbar">
            <button id="econ-add-tx-btn" class="primary-btn">
                <i data-lucide="plus" class="btn-icon"></i> 새 거래
            </button>
            <span class="econ-toolbar-spacer"></span>
            <button id="econ-show-all-btn" class="text-btn">전체 보기</button>
        </div>
        <div id="econ-tx-list" class="econ-tx-list"><p class="econ-empty">불러오는 중...</p></div>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    document.getElementById('econ-add-tx-btn')?.addEventListener('click', () => {
        openQuickAdd({
            userId: _userId,
            accounts: _cache.accounts,
            onSaved: () => renderTransactionsTab(),
        });
    });

    document.getElementById('econ-show-all-btn')?.addEventListener('click', async () => {
        try {
            const all = await getAllTransactions(dek, _userId);
            renderTxList(all, true);
        } catch (e) {
            console.error('[economy] list all failed:', e);
            showToast('거래를 불러오지 못했어요.');
        }
    });

    // 디폴트: 최근 30일
    try {
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 30);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = today.toISOString().slice(0, 10);
        const list = await getTransactionsByDateRange(dek, _userId, fromStr, toStr);
        list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        renderTxList(list, false);
    } catch (e) {
        console.error('[economy] list 30d failed:', e);
        renderTxList([], false);
    }
}

function renderTxList(list, isAll) {
    const wrap = document.getElementById('econ-tx-list');
    if (!wrap) return;
    if (list.length === 0) {
        wrap.innerHTML = `<p class="econ-empty">아직 ${isAll ? '거래가' : '최근 30일 거래가'} 없어요.</p>`;
        return;
    }
    // 날짜별 그룹핑
    const byDate = {};
    for (const t of list) {
        const d = t.date || '날짜 없음';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(t);
    }
    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
    wrap.innerHTML = dates.map(d => {
        const items = byDate[d].map(t => txCardHTML(t)).join('');
        return `
            <section class="econ-tx-day">
                <header class="econ-tx-day-head">
                    <span class="econ-tx-day-date">${escapeHTML(d)}</span>
                    <span class="econ-tx-day-count">${byDate[d].length}건</span>
                </header>
                ${items}
            </section>
        `;
    }).join('');

    // 삭제 핸들러
    wrap.querySelectorAll('.econ-tx-del-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const txId = btn.dataset.id;
            if (!confirm('이 거래를 지울까요? 되돌릴 수 없어요.')) return;
            try {
                await deleteTransaction(_userId, txId);
                showToast('거래를 지웠어요');
                renderTransactionsTab();
                window.dispatchEvent(new CustomEvent('sanctum:economy-changed', { detail: { type: 'delete', id: txId }}));
            } catch (err) {
                console.error('[economy] delete tx failed:', err);
                showToast('지우는 중에 잠깐 막혔어요.');
            }
        });
    });

    // 거래 카드 클릭 → 수정 모달 (X 버튼 클릭은 위에서 stopPropagation 으로 막힘)
    wrap.querySelectorAll('.econ-tx-card').forEach(card => {
        card.addEventListener('click', () => {
            const txId = card.dataset.txId;
            if (!txId) return;
            const tx = list.find(t => t.id === txId);
            if (!tx) return;
            openQuickAdd({
                userId: _userId,
                accounts: _cache.accounts,
                editingTx: tx,
                onSaved: () => renderTransactionsTab(),
            });
        });
    });
}

function txCardHTML(t) {
    const dir = t.direction === 'income' ? 'in' : 'out';
    const sign = dir === 'in' ? '+' : '−';
    const giving = isGivingCategory(t.category);
    const exactDisplay = t.exactAmount != null
        ? `<span class="sensitive econ-tx-exact">${sign}${formatMoney(t.exactAmount)}원</span>`
        : '';
    return `
        <article class="econ-tx-card econ-tx-${dir} ${giving ? 'econ-tx-giving' : ''}" data-tx-id="${t.id}" style="cursor:pointer">
            <div class="econ-tx-icon">${bucketIcon(t.amountBucket)}</div>
            <div class="econ-tx-main">
                <div class="econ-tx-top">
                    <span class="econ-tx-cat">${escapeHTML(categoryLabel(t.category))}</span>
                    ${giving ? '<span class="econ-tx-tag-giving">헌금·기부</span>' : ''}
                    <span class="econ-tx-bucket econ-bucket-${t.amountBucket}">${bucketLabel(t.amountBucket)}</span>
                </div>
                <div class="econ-tx-desc">${escapeHTML(t.description || '')}</div>
            </div>
            <div class="econ-tx-right">
                ${exactDisplay}
                <button class="econ-tx-del-btn text-btn" data-id="${t.id}" title="지우기">×</button>
            </div>
        </article>
    `;
}

// ═══════════════════════════════════════════════════
//  자산 탭
// ═══════════════════════════════════════════════════

async function renderAssetsTab() {
    const body = document.getElementById('econ-tab-body');
    if (!body) return;

    // categories 그룹핑
    const groups = new Map(); // catId → [assets]
    for (const a of _cache.assets) {
        const k = a.categoryId || '_uncategorized';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(a);
    }

    body.innerHTML = `
        <div class="econ-toolbar">
            <button id="econ-add-asset-btn" class="primary-btn">
                <i data-lucide="plus" class="btn-icon"></i> 새 자산
            </button>
            <button id="econ-add-cat-btn" class="text-btn">
                <i data-lucide="tag" class="btn-icon"></i> 분류 추가
            </button>
            <button id="econ-add-acc-btn" class="text-btn">
                <i data-lucide="credit-card" class="btn-icon"></i> 통장 추가
            </button>
        </div>
        <div class="econ-asset-grid">
            ${_cache.categories.map(c => assetGroupHTML(c, groups.get(c.id) || [])).join('')}
            ${groups.has('_uncategorized') ? assetGroupHTML({ id: '_uncategorized', name: '미분류' }, groups.get('_uncategorized')) : ''}
            ${_cache.assets.length === 0 ? '<p class="econ-empty">아직 자산 항목이 없어요. [+ 새 자산] 으로 추가해 보세요.</p>' : ''}
        </div>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    document.getElementById('econ-add-asset-btn')?.addEventListener('click', () => openAssetForm(null));
    document.getElementById('econ-add-cat-btn')?.addEventListener('click', openCategoryForm);
    document.getElementById('econ-add-acc-btn')?.addEventListener('click', openAccountForm);

    body.querySelectorAll('.econ-asset-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const asset = _cache.assets.find(a => a.id === id);
            if (asset) openAssetForm(asset);
        });
    });
}

function assetGroupHTML(cat, assets) {
    return `
        <section class="econ-asset-group">
            <header class="econ-asset-group-head">
                <h3>${escapeHTML(cat.name)}</h3>
                <span class="econ-asset-count">${assets.length}개</span>
            </header>
            <div class="econ-asset-cards">
                ${assets.length === 0 ? '<p class="econ-empty-small">비어 있음</p>' :
                    assets.map(a => `
                        <div class="econ-asset-card" data-id="${a.id}">
                            <div class="econ-asset-label">${escapeHTML(a.label || '(이름 없음)')}</div>
                            <div class="econ-asset-bucket econ-bucket-${a.currentValueBucket || 'small'}">
                                ${bucketIcon(a.currentValueBucket)} ${bucketLabel(a.currentValueBucket)}
                            </div>
                            ${a.exactValue != null ? `<div class="sensitive econ-asset-exact">${formatMoney(a.exactValue)}원</div>` : ''}
                        </div>
                    `).join('')
                }
            </div>
        </section>
    `;
}

// ═══════════════════════════════════════════════════
//  부채 탭
// ═══════════════════════════════════════════════════

function renderLiabilitiesTab() {
    const body = document.getElementById('econ-tab-body');
    if (!body) return;
    body.innerHTML = `
        <div class="econ-toolbar">
            <button id="econ-add-liab-btn" class="primary-btn">
                <i data-lucide="plus" class="btn-icon"></i> 새 부채
            </button>
        </div>
        <div class="econ-liab-grid">
            ${_cache.liabilities.length === 0 ? '<p class="econ-empty">아직 부채 항목이 없어요. 비어 있는 것도 괜찮아요.</p>' :
                _cache.liabilities.map(l => `
                    <div class="econ-liab-card" data-id="${l.id}">
                        <div class="econ-liab-type">${escapeHTML(l.type || '(미분류)')}</div>
                        <div class="econ-liab-bucket econ-bucket-${l.principalBucket || 'small'}">
                            ${bucketIcon(l.principalBucket)} ${bucketLabel(l.principalBucket)}
                        </div>
                        ${l.exactPrincipal != null ? `<div class="sensitive econ-liab-exact">${formatMoney(l.exactPrincipal)}원</div>` : ''}
                    </div>
                `).join('')
            }
        </div>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    document.getElementById('econ-add-liab-btn')?.addEventListener('click', () => openLiabilityForm(null));
    body.querySelectorAll('.econ-liab-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const liab = _cache.liabilities.find(l => l.id === id);
            if (liab) openLiabilityForm(liab);
        });
    });
}

// ═══════════════════════════════════════════════════
//  통계 탭 — 디폴트 숨김, "자세히 보기" 토글
// ═══════════════════════════════════════════════════

function renderStatsTab() {
    const body = document.getElementById('econ-tab-body');
    if (!body) return;
    body.innerHTML = `
        <div class="card-section">
            <h3 class="section-title"><i class="section-icon" data-lucide="bar-chart-3"></i> 통계는 디폴트로 가려둬요</h3>
            <p class="section-desc">
                돈의 흐름을 시간순으로 보는 건 도움이 되지만,
                자기 자신을 점수로 매기는 도구로 변하기 쉬워요.
                정말 볼 마음이 들 때만 펴 주세요.
            </p>
            <button id="econ-stats-reveal-btn" class="text-btn">자세히 보기</button>
            <div id="econ-stats-detail" class="hidden" style="margin-top:16px">
                <button id="econ-make-snapshot-btn" class="primary-btn">
                    이 달 가계부 요약 만들기
                </button>
                <p class="section-desc" style="margin-top:8px">
                    이번 달 거래·자산·부채를 합쳐 cashflow / netWorth 한 장씩 만듭니다.
                    원래는 월말 토요일 회고에서 자동으로 추가될 거예요.
                </p>
                <div id="econ-snapshot-result" style="margin-top:12px"></div>
            </div>
        </div>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    document.getElementById('econ-stats-reveal-btn')?.addEventListener('click', () => {
        document.getElementById('econ-stats-detail')?.classList.toggle('hidden');
    });

    document.getElementById('econ-make-snapshot-btn')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        const month = monthKey(new Date());
        const result = document.getElementById('econ-snapshot-result');
        if (result) result.textContent = '만드는 중...';
        try {
            const r = await runMonthlySnapshot(dek, _userId, month, _cache);
            if (result) {
                result.innerHTML = `
                    <p>✅ ${escapeHTML(month)} 요약이 만들어졌어요.</p>
                    <ul style="font-size:13px;color:var(--text-secondary);margin-top:6px;line-height:1.7">
                        <li>거래: ${r.txCount}건</li>
                        <li>저축률(평문): ${(r.savingsRate * 100).toFixed(1)}%</li>
                        <li>순자산 라벨: ${bucketLabel(r.netWorthBucket)}</li>
                    </ul>
                `;
            }
            showToast(`${month} 가계부 요약을 만들었어요.`);
        } catch (e) {
            console.error('[economy] snapshot failed:', e);
            if (result) result.textContent = '만드는 중에 잠깐 막혔어요.';
            showToast('요약 만들기가 잠깐 막혔어요.');
        }
    });
}

// ═══════════════════════════════════════════════════
//  자산 / 부채 / 통장 / 분류 — 작은 인라인 폼들
// ═══════════════════════════════════════════════════

function openAssetForm(asset) {
    const isEdit = !!asset;
    const overlay = ensureModalOverlay('econ-asset-modal');
    overlay.innerHTML = `
        <div class="modal-card econ-form-card">
            <header class="modal-head">
                <h3>${isEdit ? '자산 수정' : '새 자산'}</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <label>이름</label>
                <input id="ec-asset-label" type="text" value="${escapeAttr(asset?.label || '')}" placeholder="예: 신한 적금 A" />

                <label>분류</label>
                <select id="ec-asset-cat">
                    ${_cache.categories.map(c => `<option value="${c.id}" ${asset?.categoryId === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
                </select>

                <label>현재 가치 (정확 금액, 선택)</label>
                <input id="ec-asset-exact" type="number" inputmode="numeric" value="${asset?.exactValue ?? ''}" placeholder="예: 5000000" />
                <p class="section-desc" style="font-size:11px;margin-top:4px">
                    정확 금액은 자물쇠 안에만 저장돼요. 입력 안 해도 OK.
                </p>

                <label>메모 (선택)</label>
                <textarea id="ec-asset-details" rows="2" placeholder="예: 만기 2027-03">${escapeHTML(asset?.details || '')}</textarea>
            </div>
            <footer class="modal-foot">
                ${isEdit ? `<button id="ec-asset-del" class="text-btn" style="color:var(--dot-red)">지우기</button>` : ''}
                <span style="flex:1"></span>
                <button class="modal-cancel text-btn">취소</button>
                <button id="ec-asset-save" class="primary-btn">${isEdit ? '저장' : '추가'}</button>
            </footer>
        </div>
    `;
    const handle = openModal({ overlay, initialFocus: '#ec-asset-label', label: 'econ-asset' });
    overlay.querySelector('.modal-close')?.addEventListener('click', () => handle.close());
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => handle.close());

    overlay.querySelector('#ec-asset-save')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        const label = overlay.querySelector('#ec-asset-label').value.trim();
        const categoryId = overlay.querySelector('#ec-asset-cat').value;
        const exactStr = overlay.querySelector('#ec-asset-exact').value.trim();
        const details = overlay.querySelector('#ec-asset-details').value.trim();
        if (!label) { showToast('이름을 적어 주실래요?'); return; }
        const data = { ...(asset || {}), label, categoryId, details };
        if (exactStr) data.exactValue = Number(exactStr);
        else delete data.exactValue;
        try {
            await saveAsset(dek, _userId, data);
            showToast(isEdit ? '자산을 저장했어요' : '자산을 추가했어요');
            handle.close();
            await loadAll();
            renderAssetsTab();
        } catch (e) {
            console.error('[economy] save asset failed:', e);
            showToast('저장이 잠깐 막혔어요.');
        }
    });

    if (isEdit) {
        overlay.querySelector('#ec-asset-del')?.addEventListener('click', async () => {
            if (!confirm('이 자산을 지울까요?')) return;
            try {
                await deleteAsset(_userId, asset.id);
                showToast('자산을 지웠어요');
                handle.close();
                await loadAll();
                renderAssetsTab();
            } catch (e) {
                console.error('[economy] delete asset failed:', e);
                showToast('지우는 중에 잠깐 막혔어요.');
            }
        });
    }
}

function openLiabilityForm(liab) {
    const isEdit = !!liab;
    const overlay = ensureModalOverlay('econ-liab-modal');
    overlay.innerHTML = `
        <div class="modal-card econ-form-card">
            <header class="modal-head">
                <h3>${isEdit ? '부채 수정' : '새 부채'}</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <label>종류</label>
                <select id="ec-liab-type">
                    <option value="mortgage" ${liab?.type === 'mortgage' ? 'selected' : ''}>주택담보대출</option>
                    <option value="credit"   ${liab?.type === 'credit' ? 'selected' : ''}>신용대출</option>
                    <option value="card"     ${liab?.type === 'card' ? 'selected' : ''}>카드 잔액</option>
                    <option value="personal" ${liab?.type === 'personal' ? 'selected' : ''}>개인간 빚</option>
                    <option value="other"    ${liab?.type === 'other' ? 'selected' : ''}>기타</option>
                </select>

                <label>잔액 (정확 금액, 선택)</label>
                <input id="ec-liab-exact" type="number" inputmode="numeric" value="${liab?.exactPrincipal ?? ''}" placeholder="예: 50000000" />

                <label>이자율 (% / 선택)</label>
                <input id="ec-liab-rate" type="number" inputmode="decimal" step="0.01" value="${liab?.interestRate ?? ''}" placeholder="예: 3.5" />

                <label>메모 (선택)</label>
                <textarea id="ec-liab-details" rows="2" placeholder="예: 30년 분할">${escapeHTML(liab?.details || '')}</textarea>
            </div>
            <footer class="modal-foot">
                ${isEdit ? `<button id="ec-liab-del" class="text-btn" style="color:var(--dot-red)">지우기</button>` : ''}
                <span style="flex:1"></span>
                <button class="modal-cancel text-btn">취소</button>
                <button id="ec-liab-save" class="primary-btn">${isEdit ? '저장' : '추가'}</button>
            </footer>
        </div>
    `;
    const handle = openModal({ overlay, initialFocus: '#ec-liab-type', label: 'econ-liab' });
    overlay.querySelector('.modal-close')?.addEventListener('click', () => handle.close());
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => handle.close());

    overlay.querySelector('#ec-liab-save')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        const type = overlay.querySelector('#ec-liab-type').value;
        const exactStr = overlay.querySelector('#ec-liab-exact').value.trim();
        const rateStr = overlay.querySelector('#ec-liab-rate').value.trim();
        const details = overlay.querySelector('#ec-liab-details').value.trim();
        const data = { ...(liab || {}), type, details };
        if (exactStr) data.exactPrincipal = Number(exactStr); else delete data.exactPrincipal;
        if (rateStr) data.interestRate = Number(rateStr); else delete data.interestRate;
        try {
            await saveLiability(dek, _userId, data);
            showToast(isEdit ? '부채를 저장했어요' : '부채를 추가했어요');
            handle.close();
            await loadAll();
            renderLiabilitiesTab();
        } catch (e) {
            console.error('[economy] save liab failed:', e);
            showToast('저장이 잠깐 막혔어요.');
        }
    });

    if (isEdit) {
        overlay.querySelector('#ec-liab-del')?.addEventListener('click', async () => {
            if (!confirm('이 부채를 지울까요?')) return;
            try {
                await deleteLiability(_userId, liab.id);
                showToast('부채를 지웠어요');
                handle.close();
                await loadAll();
                renderLiabilitiesTab();
            } catch (e) {
                console.error('[economy] delete liab failed:', e);
                showToast('지우는 중에 잠깐 막혔어요.');
            }
        });
    }
}

function openCategoryForm() {
    const overlay = ensureModalOverlay('econ-cat-modal');
    overlay.innerHTML = `
        <div class="modal-card econ-form-card">
            <header class="modal-head">
                <h3>분류 추가</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <label>이름</label>
                <input id="ec-cat-name" type="text" placeholder="예: 주식 / 부동산 / 현금" />
            </div>
            <footer class="modal-foot">
                <span style="flex:1"></span>
                <button class="modal-cancel text-btn">취소</button>
                <button id="ec-cat-save" class="primary-btn">추가</button>
            </footer>
        </div>
    `;
    const handle = openModal({ overlay, initialFocus: '#ec-cat-name', label: 'econ-cat' });
    overlay.querySelector('.modal-close')?.addEventListener('click', () => handle.close());
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => handle.close());
    overlay.querySelector('#ec-cat-save')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        const name = overlay.querySelector('#ec-cat-name').value.trim();
        if (!name) { showToast('이름을 적어 주실래요?'); return; }
        try {
            await saveAssetCategory(dek, _userId, { name, kind: 'asset' });
            showToast('분류를 추가했어요');
            handle.close();
            await loadAll();
            renderAssetsTab();
        } catch (e) {
            console.error('[economy] save cat failed:', e);
            showToast('저장이 잠깐 막혔어요.');
        }
    });
}

function openAccountForm() {
    const overlay = ensureModalOverlay('econ-acc-modal');
    overlay.innerHTML = `
        <div class="modal-card econ-form-card">
            <header class="modal-head">
                <h3>통장 추가</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <label>이름</label>
                <input id="ec-acc-name" type="text" placeholder="예: 신한 주거래" />
                <label>종류</label>
                <select id="ec-acc-type">
                    <option value="checking">입출금</option>
                    <option value="savings">적금·예금</option>
                    <option value="card">카드</option>
                    <option value="investment">투자 계좌</option>
                    <option value="cash">현금·기타</option>
                </select>
                <label>기관 (선택)</label>
                <input id="ec-acc-inst" type="text" placeholder="예: 신한은행" />
            </div>
            <footer class="modal-foot">
                <span style="flex:1"></span>
                <button class="modal-cancel text-btn">취소</button>
                <button id="ec-acc-save" class="primary-btn">추가</button>
            </footer>
        </div>
    `;
    const handle = openModal({ overlay, initialFocus: '#ec-acc-name', label: 'econ-acc' });
    overlay.querySelector('.modal-close')?.addEventListener('click', () => handle.close());
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => handle.close());
    overlay.querySelector('#ec-acc-save')?.addEventListener('click', async () => {
        const dek = getDEK();
        if (!dek) return;
        const name = overlay.querySelector('#ec-acc-name').value.trim();
        const type = overlay.querySelector('#ec-acc-type').value;
        const institution = overlay.querySelector('#ec-acc-inst').value.trim();
        if (!name) { showToast('이름을 적어 주실래요?'); return; }
        try {
            await saveAccount(dek, _userId, { name, type, institution, currency: 'KRW' });
            showToast('통장을 추가했어요');
            handle.close();
            await loadAll();
            renderAssetsTab();
        } catch (e) {
            console.error('[economy] save acc failed:', e);
            showToast('저장이 잠깐 막혔어요.');
        }
    });
}

// ═══════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════

function ensureModalOverlay(id) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal-overlay hidden';
    document.body.appendChild(el);
    return el;
}

function formatMoney(n) {
    if (n == null) return '';
    return Number(n).toLocaleString('ko-KR');
}

function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function escapeAttr(s) {
    return escapeHTML(s).replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════
//  외부에서 호출 — 오늘 화면에서 빠른 거래 추가
// ═══════════════════════════════════════════════════

export async function getTodaysTxSummary(userId, date) {
    const dek = getDEK();
    if (!dek) return { list: [], count: 0 };
    try {
        const list = await getTransactionsByDate(dek, userId, date);
        return { list, count: list.length };
    } catch (e) {
        console.error('[economy] today summary failed:', e);
        return { list: [], count: 0 };
    }
}
