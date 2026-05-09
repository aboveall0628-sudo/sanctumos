// Firebase Configuration (Real config from user)
const firebaseConfig = {
  apiKey: "AIzaSyBz_-F3Gp7bK2DvWBGfwjf6jevSnFaHess",
  authDomain: "biblealimi.firebaseapp.com",
  projectId: "biblealimi",
  storageBucket: "biblealimi.firebasestorage.app",
  messagingSenderId: "407329001149",
  appId: "1:407329001149:web:ba286301f3d0ad5d55f1d4",
  measurementId: "G-BG79MS3FZP"
};

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
            const response = await fetch(REMOTE_URL);
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
    setupSaveButton();
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
    const memo = document.getElementById('memo-input');
    if (memo) {
        memo.addEventListener('input', function() {
            // 박스 크기를 글자 양에 맞게 조절
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            
            // Debounced save to Firestore
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                const dateStr = document.getElementById('calendar-input').value;
                saveMeditationNote(dateStr, this.value);
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
    const memo = document.getElementById('memo-input');
    if (!memo) return;

    memo.value = "불러오는 중...";
    try {
        const docRef = doc(db, "memos", dateStr);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            memo.value = docSnap.data().content;
        } else {
            memo.value = "";
        }
        // Resize after loading
        memo.style.height = 'auto';
        memo.style.height = (memo.scrollHeight) + 'px';
    } catch (e) {
        console.error("Load error:", e);
        memo.value = ""; // 에러 시 빈 칸으로 처리하여 사용 방해 안함
    }
}

function setupSaveButton() {
    const saveBtn = document.getElementById('save-memo-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const dateStr = document.getElementById('calendar-input').value;
            const content = document.getElementById('memo-input').value;
            saveMeditationNote(dateStr, content);
        });
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

    const memo = document.getElementById('memo-input');
    if (!memo) return;

    // Group selected verses by book and chapter
    const grouped = {};
    selectedVerses.forEach(verseKey => {
        const [bookChapter, verseNum] = verseKey.split('_');
        const [book, chapter] = bookChapter.split(' ');
        const fullBookName = getFullBookName(book);
        const groupKey = `${fullBookName} ${chapter}장`;
        
        if (!grouped[groupKey]) grouped[groupKey] = [];
        
        // Find the verse text
        const verseElement = document.querySelector(`.verse-item[data-key="${verseKey}"]`);
        const verseText = verseElement.querySelector('.verse-text').textContent;
        grouped[groupKey].push({ num: parseInt(verseNum), text: verseText });
    });

    let resultText = "";
    Object.keys(grouped).forEach(groupKey => {
        resultText += `${groupKey}\n`;
        grouped[groupKey].sort((a, b) => a.num - b.num);
        grouped[groupKey].forEach(v => {
            resultText += `${v.num} ${v.text}\n`;
        });
        resultText += "\n";
    });

    const currentContent = memo.value;
    const newContent = (currentContent ? currentContent + "\n" : "") + resultText;
    memo.value = newContent;
    
    // Auto resize
    memo.style.height = 'auto';
    memo.style.height = (memo.scrollHeight) + 'px';

    // Save to Firestore
    const dateStr = document.getElementById('calendar-input').value;
    saveMeditationNote(dateStr, newContent);

    // Clear selection
    selectedVerses.clear();
    document.querySelectorAll('.verse-item.selected').forEach(el => el.classList.remove('selected'));
    updateCopyButtonVisibility();
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

init();
