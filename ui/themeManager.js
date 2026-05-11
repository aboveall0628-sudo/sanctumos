/**
 * themeManager.js — 다크모드/라이트모드 제어
 */

export function initThemeManager() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (!toggleBtn) return;

    // 초기 상태 불러오기 (localStorage -> prefers-color-scheme)
    let savedTheme = localStorage.getItem('sanctum-theme');
    if (!savedTheme) {
        savedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    applyTheme(savedTheme, toggleBtn);

    // 버튼 클릭 이벤트
    toggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme, toggleBtn);
    });
}

function applyTheme(theme, btn) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        btn.innerHTML = '<i data-lucide="sun"></i>';
    } else {
        document.documentElement.removeAttribute('data-theme');
        btn.innerHTML = '<i data-lucide="moon"></i>';
    }
    localStorage.setItem('sanctum-theme', theme);
    if (typeof window.__sanctumRenderLucide === 'function') {
        window.__sanctumRenderLucide();
    }
}
