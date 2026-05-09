// Firebase Configuration (Real config from user)
window.appStarted = true;
const firebaseConfig = {
  apiKey: "AIzaSyBz_-F3Gp7bK2DvWBGfwjf6jevSnFaHess",
  authDomain: "biblealimi.firebaseapp.com",
  projectId: "biblealimi",
  storageBucket: "biblealimi.firebasestorage.app",
  messagingSenderId: "407329001149",
  appId: "1:407329001149:web:ba286301f3d0ad5d55f1d4",
  measurementId: "G-BG79MS3FZP"
};

// --- Google API Config ---
const GOOGLE_CLIENT_ID = '760231593146-7gkia8st114oiojjgjljjk0rdduhgafl.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyDdQAmIWoKy5z1I6w4BWE3xK9a1ryBZXHQ'; 
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient;
let gapiInited = false;
let gisInited = false;

// Initialize Firebase via CDN modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const BIBLE_METADATA = {
    parts: [
        {
            id: 1,
            name: "파트1: 시가서",
            desc: "욥기 ~ 아가 (약 8개월)",
            books: [
                ["욥", "욥기", 42], ["시", "시편", 150], ["잠", "잠언", 31], ["전", "전도서", 12], ["아", "아가", 8]
            ]
        },
        {
            id: 2,
            name: "파트2: 모세오경 + 대선지서",
            desc: "창세기 ~ 신명기, 이사야 ~ 다니엘 (약 12개월)",
            books: [
                ["창", "창세기", 50], ["출", "출애굽기", 40], ["레", "레위기", 27], ["민", "민수기", 36], ["신", "신명기", 34],
                ["사", "이사야", 66], ["렘", "예레미야", 52], ["애", "예레미야 애가", 5], ["겔", "에스겔", 48], ["단", "다니엘", 12]
            ]
        },
        {
            id: 3,
            name: "파트3: 역사서 + 소선지서",
            desc: "여호수아 ~ 에스더, 호세아 ~ 말라기 (약 10.5개월)",
            books: [
                ["수", "여호수아", 24], ["삿", "사사기", 21], ["룻", "룻기", 4], ["삼상", "사무엘상", 31], ["삼하", "사무엘하", 24],
                ["왕상", "열왕기상", 22], ["왕하", "열왕기하", 25], ["대상", "역대상", 29], ["대하", "역대하", 36], ["라", "에스라", 10],
                ["느", "느헤미야", 13], ["에", "에스더", 10], ["호", "호세아", 14], ["욜", "요엘", 3], ["암", "아모스", 9],
                ["옵", "오바댜", 1], ["요나", "요나", 4], ["미", "미가", 7], ["나", "나움", 3], ["합", "하박국", 3],
                ["습", "스바냐", 3], ["학", "학개", 2], ["슥", "스가랴", 14], ["말", "말라기", 4]
            ]
        },
        {
            id: 4,
            name: "파트4: 신약 전체",
            desc: "마태복음 ~ 요한계시록 (약 8.5개월)",
            books: [
                ["마", "마태복음", 28], ["막", "마가복음", 16], ["눅", "누가복음", 24], ["요", "요한복음", 21], ["행", "사도행전", 28],
                ["롬", "로마서", 16], ["고전", "고린도전서", 16], ["고후", "고린도후서", 13], ["갈", "갈라디아서", 6], ["엡", "에베소서", 6],
                ["빌", "빌립보서", 4], ["골", "골로새서", 4], ["살전", "데살로니가전서", 5], ["살후", "데살로니가후서", 3], ["딤전", "디모데전서", 6],
                ["딤후", "디모데후서", 4], ["딛", "디도서", 3], ["몬", "빌레몬서", 1], ["히", "히브리서", 13], ["약", "야고보서", 5],
                ["벧전", "베드로전서", 5], ["벧후", "베드로후서", 3], ["요일", "요한1서", 5], ["요이", "요한2서", 1], ["요삼", "요한3서", 1],
                ["유", "유다서", 1], ["계", "요한계시록", 22]
            ]
        }
    ]
};

const REMOTE_URL = 'https://raw.githubusercontent.com/aboveall0628-sudo/bible-data/refs/heads/main/bible.json';
const DB_NAME = 'BibleAlimiDB';
const STORE_NAME = 'bibleData';
const ANCHOR_DATE = new Date('2026-05-08T00:00:00');
const ANCHOR_INDICES = { 1: 84, 2: 200, 3: 17, 4: 63 };

let bibleData = null;
let fullChapterList = [];

/**
 * IndexedDB Helpers
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getCachedData() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get('fullData');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn("Cache read failed:", e);
        return null;
    }
}

async function saveToCache(data) {
    try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(data, 'fullData');
    } catch (e) {
        console.warn("Cache save failed:", e);
    }
}

/**
 * App Logic
 */
let selectedVerses = new Set();
let isCollapsedAll = true; // Default to collapsed

/**
 * App Logic
 */
async function init() {
    setupTheme();
    updateLoadingStatus("초기화 중...", "기본 설정을 구성하고 있습니다.");
    buildFullChapterList();
    setupEventListeners();
    setupMemoAutoResize();

    try {
        // 1. Check Cache
        updateLoadingStatus("브라우저 저장소 확인 중...", "이전에 저장된 데이터를 찾고 있습니다.");
        bibleData = await getCachedData();

        if (bibleData) {
            console.log("Loaded from IndexedDB.");
            updateLoadingStatus("동기화 완료!", "저장된 데이터를 불러왔습니다.");
        } else {
            // 2. Fetch from Remote
            updateLoadingStatus("데이터 동기화 중...", "GitHub에서 최신 성경 데이터를 가져오고 있습니다 (약 5MB).");
            
            // 데이터 로드가 너무 오래 걸리면 강제 종료 방지를 위해 타임아웃 설정
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10초 제한

            const response = await fetch(REMOTE_URL, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error("네트워크 응답이 좋지 않습니다.");
            
            bibleData = await response.json();
            console.log("Fetched from Remote.");
            
            updateLoadingStatus("데이터 저장 중...", "다음 실행을 위해 브라우저 창고에 보관합니다.");
            await saveToCache(bibleData);
        }
        
        finishLoading();
    } catch (error) {
        console.error("Loading error:", error);
        
        // 3. Fallback to Local bibleData.js
        if (typeof BIBLE_DATA !== 'undefined') {
            console.log("Falling back to local bibleData.js");
            updateLoadingStatus("오프라인 모드", "원격 연결에 실패하여 내장 데이터를 사용합니다.");
            bibleData = BIBLE_DATA;
            setTimeout(finishLoading, 1000);
        } else {
            showError("데이터 로드 실패", error.message);
        }
    }
}

function updateLoadingStatus(title, status) {
    const titleEl = document.getElementById('loading-title');
    const statusEl = document.getElementById('loading-status');
    if (titleEl) titleEl.textContent = title;
    if (statusEl) statusEl.textContent = status;
}

function showError(title, message) {
    const overlay = document.getElementById('loading-overlay');
    overlay.innerHTML = `
        <div class="loading-box" style="color: #ff5f56;">
            <h2>${title}</h2>
            <p>${message}</p>
            <button onclick="location.reload()" style="margin-top: 20px; background: #2383e2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">다시 시도</button>
        </div>
    `;
}

function finishLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const calendar = document.getElementById('calendar-input');
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    if (calendar) calendar.value = `${year}-${month}-${day}`;
    
    renderForDate(today);
    switchView('dashboard'); // Default to Dashboard view
    setupMobileMenu();
    setupWeather();
    setupTimebox();
    setupTimeboxModal();
    
    // Google API는 비동기로 별도 처리하여 앱 멈춤 방지
    try {
        setupGoogleAuth();
    } catch (e) {
        console.warn("Google Auth init failed, but continuing app:", e);
    }
}

function setupMobileMenu() {
    const toggleBtn = document.getElementById('menu-toggle');
    const layout = document.querySelector('.main-layout');
    
    // Add overlay if it doesn't exist
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        layout.appendChild(overlay);
        
        overlay.addEventListener('click', () => {
            layout.classList.remove('sidebar-open');
        });
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            layout.classList.toggle('sidebar-open');
        });
    }

    // Close sidebar when clicking a menu item on mobile
    const navItems = document.querySelectorAll('.sidebar-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 900) {
                layout.classList.remove('sidebar-open');
            }
        });
    });
}

function setupEventListeners() {
    const calendar = document.getElementById('calendar-input');
    if (calendar) {
        calendar.addEventListener('change', (e) => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split('-').map(Number);
            const selectedDate = new Date(y, m - 1, d);
            renderForDate(selectedDate);
        });
    }

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }

    // Navigation
    const navToday = document.getElementById('nav-today');
    const navDashboard = document.getElementById('nav-dashboard');
    const navPast = document.getElementById('nav-past');
    
    if (navToday) {
        navToday.addEventListener('click', () => switchView('today'));
    }
    if (navDashboard) {
        navDashboard.addEventListener('click', () => switchView('dashboard'));
    }
    if (navPast) {
        navPast.addEventListener('click', () => switchView('past'));
    }

    // Toolbar
    const toggleAllBtn = document.getElementById('toggle-all-btn');
    if (toggleAllBtn) {
        toggleAllBtn.addEventListener('click', toggleAllChapters);
    }

    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copySelectedVerses);
    }
}

function switchView(viewId) {
    const views = document.querySelectorAll('.view');
    views.forEach(v => v.classList.add('hidden'));
    
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) targetView.classList.remove('hidden');
    
    const navItems = document.querySelectorAll('.sidebar-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    const activeNav = document.getElementById(`nav-${viewId}`);
    if (activeNav) activeNav.classList.add('active');

    // If switching to past view, load data
    if (viewId === 'past') {
        loadAllMeditations();
    }
}

async function loadAllMeditations() {
    const listContainer = document.getElementById('past-meditations-list');
    if (!listContainer || !db) return;

    listContainer.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>묵상 기록을 불러오는 중...</p></div>';

    try {
        const q = query(collection(db, "memos"), orderBy("updatedAt", "desc"));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            listContainer.innerHTML = '<p class="subtitle">아직 저장된 묵상이 없습니다.</p>';
            return;
        }

        listContainer.innerHTML = '';
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const dateStr = docSnap.id;
            
            const card = document.createElement('div');
            card.className = 'past-card';
            card.innerHTML = `
                <div class="past-card-header">
                    <span class="past-card-date">${dateStr}</span>
                </div>
                <div class="past-card-excerpt">${data.content || "내용 없음"}</div>
            `;
            
            card.addEventListener('click', () => {
                // Switch to today's view and load this date
                const [y, m, d] = dateStr.split('-').map(Number);
                const targetDate = new Date(y, m - 1, d);
                
                const calendar = document.getElementById('calendar-input');
                if (calendar) calendar.value = dateStr;
                
                renderForDate(targetDate);
                switchView('today');
            });
            
            listContainer.appendChild(card);
        });
    } catch (e) {
        console.error("Load all error:", e);
        listContainer.innerHTML = '<p class="subtitle">데이터를 불러오는 중 오류가 발생했습니다.</p>';
    }
}

let saveTimeout = null;
function setupMemoAutoResize() {
    const editor = document.getElementById('block-editor');
    if (editor) {
        // 엔터 칠 때 기본 div 대신 p태그 또는 줄바꿈 최적화
        editor.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                // Notion-like: shift+enter = br, enter = new div
                // 브라우저 기본 동작이 div 생성이므로 특별한 처리 없어도 됨
            }
        });

        editor.addEventListener('input', function() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                const dateStr = document.getElementById('calendar-input').value;
                saveMeditationNote(dateStr, this.innerHTML);
            }, 1000);
        });
    }
}

async function saveMeditationNote(dateStr, content) {
    if (!db) return;
    const status = document.getElementById('save-status');
    if (status) status.innerText = "저장 중...";

    try {
        await setDoc(doc(db, "memos", dateStr), {
            content: content,
            updatedAt: serverTimestamp()
        });
        if (status) {
            status.innerText = "✓ 서버 저장 완료";
            setTimeout(() => { status.innerText = ""; }, 3000);
        }
    } catch (e) {
        console.error("Save error:", e);
        if (status) status.innerText = "❌ 저장 실패";
    }
}

async function loadMeditationNote(dateStr) {
    if (!db) return;
    const editor = document.getElementById('block-editor');
    if (!editor) return;

    editor.innerHTML = "<div style='color: var(--notion-text-light);'>불러오는 중...</div>";
    try {
        const docRef = doc(db, "memos", dateStr);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists() && docSnap.data().content) {
            editor.innerHTML = docSnap.data().content;
        } else {
            editor.innerHTML = "";
        }
        renderCustomTimeboxEvents(docSnap.data()?.timeboxEvents || []);
    } catch (e) {
        console.error("Load error:", e);
        editor.innerHTML = ""; 
    }
}

function toggleAllChapters() {
    isCollapsedAll = !isCollapsedAll;
    const containers = document.querySelectorAll('.passage-container');
    containers.forEach(container => {
        if (isCollapsedAll) {
            container.classList.add('collapsed');
        } else {
            container.classList.remove('collapsed');
        }
    });
}

function updateCopyButtonVisibility() {
    const copyBtn = document.getElementById('copy-btn');
    if (!copyBtn) return;
    
    if (selectedVerses.size > 0) {
        copyBtn.classList.remove('hidden');
    } else {
        copyBtn.classList.add('hidden');
    }
}

function copySelectedVerses() {
    if (selectedVerses.size === 0) return;

    const editor = document.getElementById('block-editor');
    if (!editor) return;

    const grouped = {};
    selectedVerses.forEach(verseKey => {
        const [bookChapter, verseNum] = verseKey.split('_');
        const [book, chapter] = bookChapter.split(' ');
        const fullBookName = getFullBookName(book);
        const groupKey = `${fullBookName} ${chapter}장`;
        
        if (!grouped[groupKey]) grouped[groupKey] = [];
        
        const verseElement = document.querySelector(`.verse-item[data-key="${verseKey}"]`);
        const verseText = verseElement.querySelector('.verse-text').textContent;
        grouped[groupKey].push({ num: parseInt(verseNum), text: verseText });
    });

    let resultHTML = "";
    Object.keys(grouped).forEach(groupKey => {
        resultHTML += `<div><strong>${groupKey}</strong></div>`;
        grouped[groupKey].sort((a, b) => a.num - b.num);
        grouped[groupKey].forEach(v => {
            resultHTML += `<div>${v.num} ${v.text}</div>`;
        });
        resultHTML += `<br>`;
    });

    editor.innerHTML = (editor.innerHTML === "<div style='color: var(--notion-text-light);'>불러오는 중...</div>" || editor.innerHTML === "") 
        ? resultHTML 
        : editor.innerHTML + "<br>" + resultHTML;
    
    const dateStr = document.getElementById('calendar-input').value;
    saveMeditationNote(dateStr, editor.innerHTML);

    selectedVerses.clear();
    document.querySelectorAll('.verse-item.selected').forEach(el => el.classList.remove('selected'));
    updateCopyButtonVisibility();

    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "✓ 본문에 추가됨!";
        setTimeout(() => { copyBtn.innerText = originalText; }, 2000);
    }
}

function setupTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        updateThemeUI(true);
    } else {
        updateThemeUI(false);
    }
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (!themeBtn) return;
    
    const icon = themeBtn.querySelector('.icon');
    const text = themeBtn.querySelector('.text');
    
    if (isDark) {
        icon.textContent = '☀️';
        text.textContent = '라이트 모드';
    } else {
        icon.textContent = '🌙';
        text.textContent = '다크 모드';
    }
}

function buildFullChapterList() {
    const standardOrder = [
        ["창", 50], ["출", 40], ["레", 27], ["민", 36], ["신", 34],
        ["수", 24], ["삿", 21], ["룻", 4], ["삼상", 31], ["삼하", 24], ["왕상", 22], ["왕하", 25], ["대상", 29], ["대하", 36], ["라", 10], ["느", 13], ["에", 10],
        ["욥", 42], ["시", 150], ["잠", 31], ["전", 12], ["아", 8],
        ["사", 66], ["렘", 52], ["애", 5], ["겔", 48], ["단", 12],
        ["호", 14], ["욜", 3], ["암", 9], ["옵", 1], ["요나", 4], ["미", 7], ["나", 3], ["합", 3], ["습", 3], ["학", 2], ["슥", 14], ["말", 4],
        ["마", 28], ["막", 16], ["눅", 24], ["요", 21], ["행", 28], ["롬", 16], ["고전", 16], ["고후", 13], ["갈", 6], ["엡", 6], ["빌", 4], ["골", 4], ["살전", 5], ["살후", 3], ["딤전", 6], ["딤후", 4], ["딛", 3], ["몬", 1], ["히", 13], ["약", 5], ["벧전", 5], ["벧후", 3], ["요일", 5], ["요이", 1], ["요삼", 1], ["유", 1], ["계", 22]
    ];
    standardOrder.forEach(([abbr, chapters]) => {
        for (let c = 1; c <= chapters; c++) {
            fullChapterList.push({ abbr, chapter: c });
        }
    });
}

function calculateOffset(date) {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const anchor = new Date(ANCHOR_DATE.getFullYear(), ANCHOR_DATE.getMonth(), ANCHOR_DATE.getDate());
    const diffTime = target - anchor;
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function getChapterForPart(part, offset) {
    let partChapters = [];
    part.books.forEach(([abbr, full, chapters]) => {
        for (let c = 1; c <= chapters; c++) {
            partChapters.push({ abbr, chapter: c, full });
        }
    });

    const startIndex = ANCHOR_INDICES[part.id] || 0;
    const total = partChapters.length;
    const currentIndex = (startIndex + offset) % total;
    const finalIndex = currentIndex < 0 ? currentIndex + total : currentIndex;
    return { info: partChapters[finalIndex], index: finalIndex };
}

function renderForDate(date) {
    if (!bibleData) return;
    const offset = calculateOffset(date);
    const container = document.getElementById('meditation-content');
    const progressContainer = document.getElementById('progress-container');
    const dateDisplay = document.getElementById('current-date-display');

    if (dateDisplay) dateDisplay.textContent = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
    
    container.innerHTML = '';
    progressContainer.innerHTML = '';

    BIBLE_METADATA.parts.forEach(part => {
        const { info, index } = getChapterForPart(part, offset);
        const partEl = createPartElement(part, info);
        container.appendChild(partEl);
        
        // 파트 5는 진행 바에서 제외
        if (part.id !== 5) {
            const total = getPartTotalChapters(part);
            const progress = ((index + 1) / total) * 100;
            renderProgressItem(progressContainer, part.name, progress, index + 1, total);
        }
    });

    // Load meditation note for this date
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    loadMeditationNote(dateStr);
}

function getPartTotalChapters(part) {
    return part.books.reduce((acc, curr) => acc + curr[2], 0);
}

function renderProgressItem(container, name, progress, current, total) {
    const div = document.createElement('div');
    div.className = 'progress-item';
    div.innerHTML = `
        <div class="progress-label">
            <span>${name}</span>
            <span>${current} / ${total}장 (${progress.toFixed(1)}%)</span>
        </div>
        <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${progress}%"></div>
        </div>
    `;
    container.appendChild(div);
}

function createPartElement(part, chapterInfo) {
    const div = document.createElement('div');
    div.className = 'reading-part';
    const passageContainer = document.createElement('div');
    passageContainer.className = 'passage-container' + (isCollapsedAll ? ' collapsed' : '');

    const bookName = chapterInfo.full || getFullBookName(chapterInfo.abbr);
    const abbr = chapterInfo.abbr;
    const chapNum = chapterInfo.chapter;

    const verses = [];
    const prefix = `${abbr}${chapNum}:`;
    
    Object.keys(bibleData).forEach(key => {
        if (key.startsWith(prefix)) {
            const vStr = key.split(':')[1];
            const vNum = parseInt(vStr);
            if (!isNaN(vNum)) {
                verses.push({ num: vNum, text: bibleData[key].trim() });
            }
        }
    });
    verses.sort((a, b) => a.num - b.num);

    const chapterKey = `${abbr} ${chapNum}`;

    passageContainer.innerHTML = `
        <div class="passage-header">
            <h3 class="passage-title">${bookName} ${chapNum}장</h3>
        </div>
        <div class="verse-list">
            ${verses.map(v => `
                <div class="verse-item" data-key="${chapterKey}_${v.num}">
                    <span class="verse-num">${v.num}</span>
                    <span class="verse-text">${v.text}</span>
                </div>
            `).join('')}
        </div>
    `;

    // Toggle functionality
    const header = passageContainer.querySelector('.passage-header');
    header.addEventListener('click', () => {
        passageContainer.classList.toggle('collapsed');
    });

    // Verse selection
    const verseItems = passageContainer.querySelectorAll('.verse-item');
    verseItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger header toggle
            const key = item.getAttribute('data-key');
            if (selectedVerses.has(key)) {
                selectedVerses.delete(key);
                item.classList.remove('selected');
            } else {
                selectedVerses.add(key);
                item.classList.add('selected');
            }
            updateCopyButtonVisibility();
        });
    });

    div.appendChild(passageContainer);
    return div;
}

function getFullBookName(abbr) {
    const names = {
        "창": "창세기", "출": "출애굽기", "레": "레위기", "민": "민수기", "신": "신명기",
        "수": "여호수아", "삿": "사사기", "룻": "룻기", "삼상": "사무엘상", "삼하": "사무엘하", "왕상": "열왕기상", "왕하": "열왕기하", "대상": "역대상", "대하": "역대하", "라": "에스라", "느": "느헤미야", "에": "에스더",
        "욥": "욥기", "시": "시편", "잠": "잠언", "전": "전도서", "아": "아가",
        "사": "이사야", "렘": "예레미야", "애": "예레미야 애가", "겔": "에스겔", "단": "다니엘",
        "호": "호세아", "욜": "요엘", "암": "아모스", "옵": "오바댜", "요나": "요나", "미": "미가", "나": "나움", "합": "하박국", "습": "스바냐", "학": "학개", "슥": "스가랴", "말": "말라기",
        "마": "마태복음", "막": "마가복음", "눅": "누가복음", "요": "요한복음", "행": "사도행전", "롬": "로마서", "고전": "고린도전서", "고후": "고린도후서", "갈": "갈라디아서", "엡": "에베소서", "빌": "빌립보서", "골": "골로새서", "살전": "데살로니가전서", "살후": "데살로니가후서", "딤전": "디모데전서", "딤후": "디모데후서", "딛": "디도서", "몬": "빌레몬서", "히": "히브리서", "약": "야고보서", "벧전": "베드로전서", "벧후": "베드로후서", "요일": "요한1서", "요이": "요한2서", "요삼": "요한3서", "유": "유다서", "계": "요한계시록"
    };
    return names[abbr] || abbr;
}

/**
 * Weather System
 */
async function setupWeather() {
    const container = document.getElementById('weather-container');
    if (!container) return;

    try {
        // 서울 기준 위경도 (나중에 브라우저 위치 정보로 확장 가능)
        const lat = 37.5665;
        const lon = 126.9780;
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`);
        const data = await response.json();
        
        renderWeather(data.daily);
    } catch (e) {
        console.error("Weather load error:", e);
        container.innerHTML = '<p class="subtitle">날씨 정보를 가져올 수 없습니다.</p>';
    }
}

function renderWeather(daily) {
    const container = document.getElementById('weather-container');
    container.innerHTML = '';

    const weatherIcons = {
        0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
        45: '🌫️', 48: '🌫️',
        51: '🌦️', 53: '🌦️', 55: '🌦️',
        61: '🌧️', 63: '🌧️', 65: '🌧️',
        71: '❄️', 73: '❄️', 75: '❄️',
        95: '⛈️'
    };

    daily.time.forEach((time, i) => {
        const date = new Date(time);
        const dayName = date.toLocaleDateString('ko-KR', { weekday: 'short' });
        const dayNum = date.getDate();
        const code = daily.weathercode[i];
        const icon = weatherIcons[code] || '❓';

        const card = document.createElement('div');
        card.className = 'weather-card' + (i === 0 ? ' today' : '');
        card.innerHTML = `
            <div class="weather-date">${dayNum}일(${dayName})</div>
            <div class="weather-icon">${icon}</div>
            <div class="weather-temp">
                <span class="max">${Math.round(daily.temperature_2m_max[i])}°</span>
                <span class="min">${Math.round(daily.temperature_2m_min[i])}°</span>
            </div>
        `;
        container.appendChild(card);
    });
}

/**
 * Timebox System (축 반전: 세로 시간, 가로 분)
 */
let isDragging = false;
let selectedCells = [];

function setupTimebox() {
    const grid = document.getElementById('timebox-grid');
    if (!grid) return;

    grid.innerHTML = '';

    // 헤더 행 생성 (빈 칸, 00(삭제), 15, 30, 45)
    const headers = ['H', '', '15', '30', '45'];
    headers.forEach(h => {
        const div = document.createElement('div');
        div.className = 'timebox-header-cell';
        if (h !== 'H' && h !== '') {
            div.innerHTML = `<span>${h}</span>`;
        } else {
            div.textContent = h;
            div.style.justifyContent = 'center';
        }
        grid.appendChild(div);
    });

    // 24시간 행 생성
    for (let h = 0; h < 24; h++) {
        // 시간 레이블 (첫 번째 열)
        const label = document.createElement('div');
        label.className = 'time-label-row';
        label.textContent = `${h}시`;
        grid.appendChild(label);

        // 4개 칸 (00, 15, 30, 45분)
        for (let m = 0; m < 4; m++) {
            const cell = document.createElement('div');
            cell.className = 'time-cell';
            cell.dataset.hour = h;
            cell.dataset.min = m;
            cell.dataset.index = h * 4 + m; // 연속성 체크용 인덱스

            cell.addEventListener('mousedown', startSelect);
            cell.addEventListener('mouseover', updateSelect);
            cell.addEventListener('mouseup', endSelect);
            
            // Touch
            cell.addEventListener('touchstart', (e) => { e.preventDefault(); startSelect(e); }, {passive: false});
            cell.addEventListener('touchmove', handleTouchMove, {passive: false});
            cell.addEventListener('touchend', endSelect);

            grid.appendChild(cell);
        }
    }
}

let dragStartIndex = -1;
let currentSelectedCells = [];

function startSelect(e) {
    const cell = e.target.closest('.time-cell');
    if (!cell) return;
    
    if (cell.classList.contains('has-event') && cell.classList.contains('custom-event')) {
        e.stopPropagation();
        openDeleteModal(cell.dataset.eventId, cell.getAttribute('data-event-title') || '일정');
        return;
    }

    isDragging = true;
    dragStartIndex = parseInt(cell.dataset.index);
    selectedCells = [dragStartIndex];
    renderSelection();
}

function updateSelect(e) {
    if (!isDragging) return;
    const cell = e.target.closest('.time-cell');
    if (!cell) return;
    if (cell.classList.contains('has-event')) return;

    const currentIndex = parseInt(cell.dataset.index);
    selectedCells = [];
    const minIdx = Math.min(dragStartIndex, currentIndex);
    const maxIdx = Math.max(dragStartIndex, currentIndex);
    for (let i = minIdx; i <= maxIdx; i++) {
        selectedCells.push(i);
    }
    renderSelection();
}

function renderSelection() {
    document.querySelectorAll('.time-cell.selected').forEach(cell => cell.classList.remove('selected'));
    selectedCells.forEach(idx => {
        const cell = document.querySelector(`.time-cell[data-index="${idx}"]`);
        if (cell && !cell.classList.contains('has-event')) {
            cell.classList.add('selected');
        }
    });
}

function endSelect() {
    if (!isDragging) return;
    isDragging = false;
    
    if (selectedCells.length > 0) {
        openTimeboxModal(selectedCells);
    }
}

function handleTouchMove(e) {
    if (!isDragging) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const cell = el?.closest('.time-cell');
    if (cell && !cell.classList.contains('has-event')) {
        const currentIndex = parseInt(cell.dataset.index);
        selectedCells = [];
        const minIdx = Math.min(dragStartIndex, currentIndex);
        const maxIdx = Math.max(dragStartIndex, currentIndex);
        for (let i = minIdx; i <= maxIdx; i++) {
            selectedCells.push(i);
        }
        renderSelection();
    }
}

function openTimeboxModal(cells) {
    if (cells.length === 0) return;
    currentSelectedCells = [...cells];
    
    const minIdx = Math.min(...cells);
    const maxIdx = Math.max(...cells);
    
    const startH = Math.floor(minIdx / 4);
    const startM = (minIdx % 4) * 15;
    
    const endH = Math.floor((maxIdx + 1) / 4);
    const endM = ((maxIdx + 1) % 4) * 15;
    
    const timeStr = `${startH}시 ${startM === 0 ? '00' : startM}분 ~ ${endH}시 ${endM === 0 ? '00' : endM}분`;
    
    document.getElementById('timebox-modal-time').innerText = timeStr;
    document.getElementById('timebox-event-input').value = '';
    document.getElementById('timebox-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('timebox-event-input').focus(), 100);
}

function setupTimeboxModal() {
    const cancelBtn = document.getElementById('timebox-cancel-btn');
    const saveBtn = document.getElementById('timebox-save-btn');
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            document.getElementById('timebox-modal').classList.add('hidden');
            document.querySelectorAll('.time-cell.selected').forEach(cell => cell.classList.remove('selected'));
            selectedCells = [];
            currentSelectedCells = [];
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const title = document.getElementById('timebox-event-input').value.trim();
            if (!title) return;
            
            saveBtn.disabled = true;
            document.getElementById('timebox-modal').classList.add('hidden');
            
            const eventId = Date.now().toString();
            
            // 10가지 색상 중 랜덤 선택 (연속 중복 방지 로직은 render 시점에 처리하거나 저장 시점에 고정)
            // 여기서는 저장 시점에 색상을 고정하되, 마지막 이벤트와 겹치지 않게 시도
            const dateStr = document.getElementById('calendar-input').value;
            const docRef = doc(db, "memos", dateStr);
            const docSnap = await getDoc(docRef);
            let lastColor = 0;
            if (docSnap.exists()) {
                const events = docSnap.data().timeboxEvents || [];
                if (events.length > 0) {
                    const lastEvent = events[events.length - 1];
                    lastColor = parseInt(lastEvent.color.replace('event-color-', ''));
                }
            }
            
            let newColorNum;
            do {
                newColorNum = Math.floor(Math.random() * 10) + 1;
            } while (newColorNum === lastColor);
            
            const colorClass = `event-color-${newColorNum}`;
            
            const startIdx = Math.min(...currentSelectedCells);
            currentSelectedCells.forEach(idx => {
                const cell = document.querySelector(`.time-cell[data-index="${idx}"]`);
                if (cell) {
                    cell.classList.remove('selected');
                    cell.classList.add('has-event', 'custom-event', colorClass);
                    cell.dataset.eventId = eventId;
                    if (idx === startIdx) {
                        cell.setAttribute('data-event-title', title);
                    }
                }
            });
            
            await saveTimeboxToFirebase(currentSelectedCells, title, eventId, colorClass);
            pushToGoogleCalendar(currentSelectedCells, title);
            
            saveBtn.disabled = false;
            selectedCells = [];
            currentSelectedCells = [];
        });
    }
    
    setupDeleteModal();
}

let currentDeleteEventId = null;

function openDeleteModal(eventId, title) {
    currentDeleteEventId = eventId;
    document.getElementById('timebox-delete-modal-title').innerText = title;
    document.getElementById('timebox-delete-modal').classList.remove('hidden');
}

function setupDeleteModal() {
    const cancelBtn = document.getElementById('timebox-delete-cancel-btn');
    const deleteBtn = document.getElementById('timebox-delete-btn');
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            document.getElementById('timebox-delete-modal').classList.add('hidden');
            currentDeleteEventId = null;
        });
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!currentDeleteEventId) return;
            document.getElementById('timebox-delete-modal').classList.add('hidden');
            
            document.querySelectorAll(`.time-cell[data-event-id="${currentDeleteEventId}"]`).forEach(cell => {
                cell.className = 'time-cell'; 
                cell.removeAttribute('data-event-title');
                cell.removeAttribute('data-event-id');
            });
            
            await deleteTimeboxFromFirebase(currentDeleteEventId);
            currentDeleteEventId = null;
        });
    }
}

async function saveTimeboxToFirebase(cells, title, eventId, colorClass) {
    if (!db) return;
    const dateStr = document.getElementById('calendar-input').value;
    const docRef = doc(db, "memos", dateStr);
    
    try {
        const docSnap = await getDoc(docRef);
        let data = docSnap.exists() ? docSnap.data() : { content: '' };
        let events = data.timeboxEvents || [];
        
        events.push({ id: eventId, indices: cells, title: title, color: colorClass });
        
        await setDoc(docRef, { ...data, timeboxEvents: events, updatedAt: serverTimestamp() });
    } catch (e) {
        console.error("Timebox save error:", e);
    }
}

async function deleteTimeboxFromFirebase(eventId) {
    if (!db) return;
    const dateStr = document.getElementById('calendar-input').value;
    const docRef = doc(db, "memos", dateStr);
    
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            let data = docSnap.data();
            let events = data.timeboxEvents || [];
            events = events.filter(e => e.id !== eventId);
            await setDoc(docRef, { ...data, timeboxEvents: events, updatedAt: serverTimestamp() });
        }
    } catch (e) {
        console.error("Timebox delete error:", e);
    }
}

function renderCustomTimeboxEvents(events) {
    document.querySelectorAll('.time-cell.custom-event').forEach(el => {
        el.className = 'time-cell';
        el.removeAttribute('data-event-title');
        el.removeAttribute('data-event-id');
    });
    
    if (!events) return;
    
    events.forEach(ev => {
        const sortedIndices = [...ev.indices].sort((a, b) => a - b);
        const startIdx = sortedIndices[0];
        const endIdx = sortedIndices[sortedIndices.length - 1];
        
        sortedIndices.forEach((idx, i) => {
            const cell = document.querySelector(`.time-cell[data-index="${idx}"]`);
            if (cell) {
                cell.classList.add('has-event', 'custom-event', ev.color || 'event-color-1');
                cell.dataset.eventId = ev.id;
                
                // 중간 바 제거용 클래스 부여
                if (sortedIndices.length > 1) {
                    if (idx === startIdx) {
                        cell.classList.add('event-start');
                    } else if (idx === endIdx) {
                        cell.classList.add('event-end');
                    } else {
                        cell.classList.add('event-middle');
                    }
                }

                if (idx === startIdx) {
                    cell.setAttribute('data-event-title', ev.title);
                }
            }
        });
    });
}

function pushToGoogleCalendar(cells, title) {
    if (!gapiInited || !gapi.client.calendar) return; 
    if (!gapi.client.getToken()) return;

    const dateStr = document.getElementById('calendar-input').value; 
    const minIdx = Math.min(...cells);
    const maxIdx = Math.max(...cells);
    
    const startH = Math.floor(minIdx / 4);
    const startM = (minIdx % 4) * 15;
    const endH = Math.floor((maxIdx + 1) / 4);
    const endM = ((maxIdx + 1) % 4) * 15;
    
    const startTimeStr = `${dateStr}T${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}:00+09:00`;
    const endTimeStr = `${dateStr}T${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00+09:00`;

    const event = {
        'summary': title,
        'start': {
            'dateTime': startTimeStr,
            'timeZone': 'Asia/Seoul'
        },
        'end': {
            'dateTime': endTimeStr,
            'timeZone': 'Asia/Seoul'
        },
        'reminders': {
            'useDefault': false,
            'overrides': [
                {'method': 'popup', 'minutes': 15}
            ]
        }
    };

    const request = gapi.client.calendar.events.insert({
        'calendarId': 'primary',
        'resource': event
    });

    request.execute(function(res) {
        if (res.error) {
            console.error("GCal Push Error:", res.error);
        } else {
            console.log("Event pushed to Google Calendar:", res.htmlLink);
        }
    });
}

/**
 * Google Auth System
 */
function setupGoogleAuth() {
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) {
        authBtn.addEventListener('click', handleAuthClick);
    }
    
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', listUpcomingEvents);
    }

    // 라이브러리 로드 시작
    gapiLoaded();
    gisLoaded();
}

function gapiLoaded() {
    gapi.load('client', intializeGapiClient);
}

async function intializeGapiClient() {
    await gapi.client.init({
        apiKey: GOOGLE_API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    });
    gapiInited = true;
    checkBeforeStart();
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: '', // defined later
    });
    gisInited = true;
    checkBeforeStart();
}

function checkBeforeStart() {
    if (gapiInited && gisInited) {
        console.log("Google API Ready.");
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        document.getElementById('auth-btn').classList.add('hidden');
        document.getElementById('sync-btn').classList.remove('hidden');
        await listUpcomingEvents();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

async function listUpcomingEvents() {
    let response;
    try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        response = await gapi.client.calendar.events.list({
            'calendarId': 'primary',
            'timeMin': startOfDay,
            'timeMax': endOfDay,
            'showDeleted': false,
            'singleEvents': true,
            'maxResults': 10,
            'orderBy': 'startTime',
        });
    } catch (err) {
        console.error(err);
        return;
    }

    const events = response.result.items;
    if (!events || events.length == 0) {
        alert('오늘 일정이 없습니다.');
        return;
    }

    renderEventsOnTimebox(events);
}

function renderEventsOnTimebox(events) {
    // 기존 표시 제거
    document.querySelectorAll('.time-cell.has-event').forEach(el => {
        el.classList.remove('has-event');
        el.removeAttribute('data-event-title');
    });

    events.forEach(event => {
        const start = new Date(event.start.dateTime || event.start.date);
        const end = new Date(event.end.dateTime || event.end.date);
        
        const startH = start.getHours();
        const startM = Math.floor(start.getMinutes() / 15);
        const endH = end.getHours();
        const endM = Math.floor(end.getMinutes() / 15);

        // 그리드에 표시 (시작부터 끝까지)
        for (let h = startH; h <= endH; h++) {
            let mStart = (h === startH) ? startM : 0;
            let mEnd = (h === endH) ? endM : 3;

            for (let m = mStart; m <= mEnd; m++) {
                if (h === endH && m === endM && (end.getMinutes() % 15 === 0)) break; // 종료 시각 딱 맞으면 마지막 칸 제외

                const cell = document.querySelector(`.time-cell[data-hour="${h}"][data-min="${m}"]`);
                if (cell) {
                    cell.classList.add('has-event');
                    if (h === startH && m === startM) {
                        cell.setAttribute('data-event-title', event.summary);
                    }
                }
            }
        }
    });
}

init();
