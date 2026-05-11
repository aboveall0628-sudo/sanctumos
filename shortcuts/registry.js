/**
 * registry.js — 모든 단축키를 한 곳에서 선언.
 *
 * 한 항목 = {
 *   id, keys (단일 콤보 또는 [콤보, 콤보]), context, category, label, description, action,
 *   when (선택 — boolean 반환 함수, false면 무시)
 * }
 *
 * context:
 *  - 'global'    : 어디서나
 *  - 'modal'     : 모달이 열려 있을 때만
 *  - 'writing'   : input/textarea/contenteditable 안에서만
 *  - 'list'      : 리스트(시간표 등) 컨텍스트 — 입력 외부일 때
 *
 * action 은 인자 없이 호출. dispatch 시점에 lazy import 로 모듈을 가져와도 됨.
 *
 * 등록은 router.js 가 import 직후 build() 호출 시 일괄 처리.
 */

// 액션 핸들러 — 외부 모듈 호출은 lazy import 로 (순환 의존 피함)
const actions = {
    async openHelp() {
        const m = await import('../ui/shortcutHelp.js');
        m.toggleShortcutHelp();
    },

    async openSettings() {
        // app.js 가 switchView 를 window.__sanctumNav 로 노출 (router setup 시점에 보장)
        if (window.__sanctumNav) window.__sanctumNav('settings');
    },

    async closeTopOrCancel() {
        const m = await import('../ui/modalManager.js');
        if (m.isModalOpen()) {
            m.closeTopModal();
            return;
        }
        // 입력 영역에 포커스가 있으면 blur → 자동 저장 트리거 + 단일 문자 단축키 다시 활성
        const a = document.activeElement;
        const isWriting = a && (
            a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' ||
            a.getAttribute?.('contenteditable') === 'true'
        );
        if (isWriting) {
            try { a.blur(); } catch (_) {}
            return;
        }
        // 둘 다 아니면 — 모바일 사이드바 열려 있을 때 닫기
        const sidebar = document.getElementById('sidebar');
        if (sidebar?.classList.contains('open')) {
            sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        }
    },

    /**
     * 글쓰기 영역에서 Ctrl+Enter — 저장 후 입력 영역에서 빠져나옴.
     * 묵상 노트는 blur 시 자동 저장. 입력 필드는 form 의 submit 가 있으면 그쪽으로.
     */
    writingSubmit() {
        const a = document.activeElement;
        if (!a) return;
        // form 안에 있으면 submit 시도
        const form = a.closest && a.closest('form');
        if (form) {
            const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
            if (submitBtn) { submitBtn.click(); return; }
        }
        // 그 외엔 blur (자동 저장) + 토스트
        try { a.blur(); } catch (_) {}
        showSavedToast();
    },

    async lockNow() {
        const [ls, mm] = await Promise.all([
            import('../ui/lockScreen.js'),
            import('../ui/modalManager.js'),
        ]);
        mm.closeAllModals();
        ls.lock();
    },

    toggleSensitive() {
        const input = document.getElementById('sensitive-setting-toggle');
        if (input) {
            input.checked = !input.checked;
            input.dispatchEvent(new Event('change'));
            return;
        }
        // 설정 페이지 미렌더 상태: body 클래스로 직접 토글하고 localStorage 갱신
        const willMask = !document.body.classList.contains('sensitive-masked');
        document.body.classList.toggle('sensitive-masked', willMask);
        localStorage.setItem('sanctum-sensitive-mode', willMask ? 'true' : 'false');
    },

    toggleTheme() {
        const input = document.getElementById('theme-setting-toggle');
        if (input) {
            input.checked = !input.checked;
            input.dispatchEvent(new Event('change'));
            return;
        }
        // 설정 페이지 미렌더 상태: data-theme 직접 토글
        const html = document.documentElement;
        const isDark = html.getAttribute('data-theme') === 'dark';
        if (isDark) html.removeAttribute('data-theme');
        else html.setAttribute('data-theme', 'dark');
        localStorage.setItem('sanctum-theme', isDark ? 'light' : 'dark');
    },

    async openBackup() {
        // 설정 화면 안의 "전체 데이터 받기" 버튼이 진입점
        if (window.__sanctumNav) window.__sanctumNav('settings');
        requestAnimationFrame(() => {
            const btn = document.getElementById('btn-export-backup');
            if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // 자동 클릭은 위험 — 사용자가 직접 확인 후 누르도록
        });
    },

    manualSave() {
        // 현재 포커스가 묵상 노트 같은 자동 저장 영역이면 → 즉시 flush + 토스트
        const active = document.activeElement;
        const isWriting = active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.getAttribute('contenteditable') === 'true'
        );
        if (isWriting) {
            // contenteditable 묵상 노트는 'blur' 시 자동 저장. 강제 트리거.
            active.dispatchEvent(new Event('blur'));
            // 다시 포커스 복원 (저장 후 계속 쓰던 자리로)
            requestAnimationFrame(() => { try { active.focus(); } catch (_) {} });
        }
        showSavedToast();
    },

    async commandPalette() {
        // Step 2 에서 구현. 일단 토스트만.
        showSavedToast('커맨드 팔레트는 다음 단계에 추가돼요', 1800);
    },

    navHistoryBack() {
        if (window.__sanctumNavHistory) window.__sanctumNavHistory.back();
    },
    navHistoryForward() {
        if (window.__sanctumNavHistory) window.__sanctumNavHistory.forward();
    },
};

async function showSavedToast(msg = '저장됐어요 ✓', ms = 1500) {
    try {
        const m = await import('../ui/quickReview.js');
        m.showToast(msg);
    } catch (_) {
        // showToast 없으면 무음 fallback
        console.log('[toast]', msg);
    }
}

// 사이드바 8개 영역 — Alt+숫자 와 Alt+문자(의미 기반) 둘 다
function navTo(viewId) {
    return () => { if (window.__sanctumNav) window.__sanctumNav(viewId); };
}

/**
 * 모든 단축키 선언. id 는 유일.
 */
export const SHORTCUTS = [
    // ─── 1층 — 전역 ──────────────────────────────────────────
    { id: 'help.toggle', keys: ['Ctrl+/', '?'], context: 'global', category: '도움말',
      label: '단축키 도움말', description: '단축키 치트시트를 켜고 끕니다.',
      action: actions.openHelp },

    { id: 'app.settings', keys: 'Ctrl+,', context: 'global', category: '이동',
      label: '설정 열기', description: '설정 화면으로 이동합니다.',
      action: actions.openSettings },

    { id: 'app.save', keys: 'Ctrl+S', context: 'global', category: '저장',
      label: '수동 저장', description: '현재 입력 칸을 저장하고 피드백을 보여줍니다.',
      action: actions.manualSave, preventDefault: true },

    { id: 'app.cancel', keys: 'Escape', context: 'global', category: '닫기',
      label: '닫기 · 취소', description: '모달이나 패널을 닫고 한 단계 위로 갑니다.',
      action: actions.closeTopOrCancel },

    { id: 'app.commandPalette', keys: 'Ctrl+K', context: 'global', category: '명령',
      label: '커맨드 팔레트', description: '모든 명령을 검색해서 실행합니다 (다음 단계 예정).',
      action: actions.commandPalette, preventDefault: true },

    { id: 'app.navBack', keys: 'Alt+ArrowLeft', context: 'global', category: '이동',
      label: '이전 화면', description: '앱 안에서 이전에 보던 화면으로 돌아갑니다.',
      action: actions.navHistoryBack, preventDefault: true },

    { id: 'app.navForward', keys: 'Alt+ArrowRight', context: 'global', category: '이동',
      label: '다음 화면', description: '앱 안에서 다음 화면으로 이동합니다.',
      action: actions.navHistoryForward, preventDefault: true },

    // 안전: 위험 동작은 Ctrl+Shift+키
    { id: 'app.lock', keys: 'Ctrl+Shift+L', context: 'global', category: '보안',
      label: '즉시 잠금', description: '앱을 즉시 잠가 민감한 정보를 가립니다.',
      action: actions.lockNow },

    { id: 'app.toggleSensitive', keys: 'Ctrl+Shift+H', context: 'global', category: '보안',
      label: '화면 가리기 토글', description: '민감한 칸의 마스킹을 켜고 끕니다.',
      action: actions.toggleSensitive },

    { id: 'app.toggleTheme', keys: 'Ctrl+Shift+D', context: 'global', category: '보기',
      label: '다크 / 라이트 토글', description: '화면 모드를 바꿉니다.',
      action: actions.toggleTheme },

    { id: 'app.openBackup', keys: 'Ctrl+Shift+B', context: 'global', category: '보안',
      label: '백업 화면 열기', description: '설정의 데이터 백업 영역으로 이동합니다.',
      action: actions.openBackup },

    // ─── 4층 — 글쓰기 영역 (input/textarea/contenteditable) ────
    // 명세의 Alt+↑↓ 줄 이동, Ctrl+Shift+Backspace 줄 삭제, /블록 메뉴, @멘션은
    // 묵상 노트 에디터 재설계 트랙(별도)에서 함께 다룸. 이번 단계에서는 기본 3개.
    { id: 'writing.submit', keys: 'Ctrl+Enter', context: 'writing', category: '저장',
      label: '입력 저장 · 제출', description: '글쓰기 칸을 빠져나오며 저장합니다 (form 이 있으면 제출).',
      action: actions.writingSubmit, preventDefault: true },

    // ─── 2층 — 영역 이동 (Alt+숫자) ─────────────────────────
    { id: 'nav.dashboard.num', keys: 'Alt+1', context: 'global', category: '영역 이동',
      label: '대시보드', description: '대시보드로 이동.', action: navTo('dashboard'), preventDefault: true },
    { id: 'nav.today.num',     keys: 'Alt+2', context: 'global', category: '영역 이동',
      label: '오늘',     description: '오늘 화면으로 이동.', action: navTo('today'), preventDefault: true },
    { id: 'nav.past.num',      keys: 'Alt+3', context: 'global', category: '영역 이동',
      label: '지난 묵상', description: '지난 묵상 게시판으로 이동.', action: navTo('past'), preventDefault: true },
    { id: 'nav.principles.num',keys: 'Alt+4', context: 'global', category: '영역 이동',
      label: '나의 원칙', description: '원칙 화면으로 이동.', action: navTo('principles'), preventDefault: true },
    { id: 'nav.reports.num',   keys: 'Alt+5', context: 'global', category: '영역 이동',
      label: '리포트',   description: '리포트 화면으로 이동.', action: navTo('reports'), preventDefault: true },
    { id: 'nav.persons.num',   keys: 'Alt+6', context: 'global', category: '영역 이동',
      label: '인물',     description: '인물 화면으로 이동.', action: navTo('persons'), preventDefault: true },
    { id: 'nav.orgs.num',      keys: 'Alt+7', context: 'global', category: '영역 이동',
      label: '조직',     description: '조직 화면으로 이동.', action: navTo('organizations'), preventDefault: true },
    { id: 'nav.settings.num',  keys: 'Alt+8', context: 'global', category: '영역 이동',
      label: '설정',     description: '설정 화면으로 이동.', action: navTo('settings'), preventDefault: true },

    // 2층 — 의미 기반 문자 별칭 (숫자와 동일 동작, 별도 표시는 X)
    { id: 'nav.dashboard.alpha', keys: 'Alt+D', context: 'global', category: '영역 이동',
      label: 'Dashboard', description: '대시보드 (D).', action: navTo('dashboard'), hidden: true, preventDefault: true },
    { id: 'nav.today.alpha',     keys: 'Alt+T', context: 'global', category: '영역 이동',
      label: 'Today',     description: '오늘 (T).', action: navTo('today'), hidden: true, preventDefault: true },
    { id: 'nav.past.alpha',      keys: 'Alt+M', context: 'global', category: '영역 이동',
      label: 'Meditation', description: '지난 묵상 (M).', action: navTo('past'), hidden: true, preventDefault: true },
    { id: 'nav.principles.alpha',keys: 'Alt+P', context: 'global', category: '영역 이동',
      label: 'Principle', description: '원칙 (P).', action: navTo('principles'), hidden: true, preventDefault: true },
    { id: 'nav.reports.alpha',   keys: 'Alt+R', context: 'global', category: '영역 이동',
      label: 'Report',    description: '리포트 (R).', action: navTo('reports'), hidden: true, preventDefault: true },
    { id: 'nav.persons.alpha',   keys: 'Alt+U', context: 'global', category: '영역 이동',
      label: 'Users',     description: '인물 (U).', action: navTo('persons'), hidden: true, preventDefault: true },
    { id: 'nav.orgs.alpha',      keys: 'Alt+O', context: 'global', category: '영역 이동',
      label: 'Org',       description: '조직 (O).', action: navTo('organizations'), hidden: true, preventDefault: true },
    { id: 'nav.settings.alpha',  keys: 'Alt+S', context: 'global', category: '영역 이동',
      label: 'Settings',  description: '설정 (S).', action: navTo('settings'), hidden: true, preventDefault: true },
];

/**
 * 카테고리별로 묶어서 도움말 모달에 전달.
 * hidden: true 인 항목은 제외.
 */
export function getShortcutsByCategory() {
    const map = new Map();
    for (const s of SHORTCUTS) {
        if (s.hidden) continue;
        if (!map.has(s.category)) map.set(s.category, []);
        map.get(s.category).push(s);
    }
    // 카테고리 표시 순서
    const order = ['이동', '영역 이동', '닫기', '저장', '명령', '보기', '보안', '도움말'];
    const sorted = [];
    for (const k of order) if (map.has(k)) sorted.push([k, map.get(k)]);
    for (const [k, v] of map) if (!order.includes(k)) sorted.push([k, v]);
    return sorted;
}
