/**
 * sensitiveMode.js — 민감 데이터 가리기 모드
 */

export function initSensitiveMode() {
    const toggleBtn = document.getElementById('sensitive-toggle-btn');
    if (!toggleBtn) return;

    const renderIcon = (masked) => {
        // masked=true → 가려져 있음(보려면 누름). eye-off 아이콘.
        // masked=false → 보이는 상태. eye 아이콘.
        toggleBtn.innerHTML = masked ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    };

    // 초기 상태 로드
    const isMasked = localStorage.getItem('sanctum-sensitive-mode') !== 'false';
    document.body.classList.toggle('sensitive-masked', isMasked);
    toggleBtn.classList.toggle('active', isMasked);
    renderIcon(isMasked);

    toggleBtn.addEventListener('click', () => {
        const masked = document.body.classList.toggle('sensitive-masked');
        localStorage.setItem('sanctum-sensitive-mode', masked);
        toggleBtn.classList.toggle('active', masked);
        renderIcon(masked);
    });

    // 민감 요소 클릭 시 5초 해제
    document.body.addEventListener('click', (e) => {
        if (!document.body.classList.contains('sensitive-masked')) return;
        
        const sensitiveEl = e.target.closest('.sensitive');
        if (sensitiveEl) {
            sensitiveEl.classList.add('revealed');
            setTimeout(() => {
                sensitiveEl.classList.remove('revealed');
            }, 5000);
        }
    });
}
