// ---------- Storage (plain localStorage — works in a real browser / extension) ----------
function storageGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}
function storageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error('Could not save', key, e);
    }
}

// ---------- Defaults ----------
const defaultRoutine = [
    { name: "🌅 Wake Up & Proper Stretching", duration: 5 },
    { name: "📱 Phone, Messages & Social Media", duration: 10 },
    { name: "🍳 Pack Breakfast & Start Water Boiler", duration: 25 },
    { name: "🚿 Shower & Teeth (Hot Water Ready)", duration: 12 },
    { name: "🧴 Body Lotion", duration: 3 },
    { name: "🌿 Body Oil & Layering", duration: 2 },
    { name: "🩲 Underwear & Base Layer", duration: 2 },
    { name: "✨ Perfume & Scent Layering", duration: 2 },
    { name: "👗 Get Dressed & Shoes", duration: 5 },
    { name: "👜 Pack Bag (Keys, Essentials)", duration: 3 },
    { name: "💧 Get Water & Final Check", duration: 2 },
    { name: "🚨 Emergency Buffer", duration: 9 }
];

const defaultChecks = [
    "Lay out exact outfit, shoes, and bag",
    "Set pre-measured breakfast items ready",
    "Put keys & phone charger in designated spot",
    "Water bottle washed and ready on counter"
];

let appSettings = storageGet('app-settings', { appName: 'Aura Morning Flow', darkMode: false });
let routine = storageGet('routine', defaultRoutine);
let nightChecks = storageGet('night-checks', defaultChecks);
let historyLog = storageGet('departure-history', []);

let isEngaged = false;
let currentStepIndex = 0;
let timeLeft = getTotalRoutineDuration() * 60;
let isRunning = false;
let isTransitMode = false;
let timerInterval = null;

// ---------- Element lookups (may be null depending on which page loaded this script) ----------
const $ = (id) => document.getElementById(id);
const activeTaskName = $('active-task-name');
const activeCountdown = $('active-countdown');
const startPauseBtn = $('start-pause-btn');
const routineList = $('routine-list');
const checklistContainer = $('checklist-container');

function getTotalRoutineDuration() {
    return routine.reduce((acc, curr) => acc + curr.duration, 0);
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { window.wakeLockRef = await navigator.wakeLock.request('screen'); } catch (err) {}
    }
}

function applySettings() {
    const titleEl = $('app-title');
    if (titleEl) titleEl.textContent = appSettings.appName;
    document.body.classList.toggle('dark-mode', !!appSettings.darkMode);
}

function saveAppName(name) {
    appSettings.appName = name.trim() || 'Aura Morning Flow';
    storageSet('app-settings', appSettings);
}

function toggleDarkMode() {
    appSettings.darkMode = !appSettings.darkMode;
    document.body.classList.toggle('dark-mode', appSettings.darkMode);
    storageSet('app-settings', appSettings);
}

function updateClocks() {
    const now = new Date();
    const dateEl = $('clock-date'), watEl = $('clock-wat'), estEl = $('clock-est'), mstEl = $('clock-mst');
    if (dateEl) dateEl.textContent = now.toLocaleDateString();
    if (watEl) watEl.textContent = now.toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour12: true });
    if (estEl) estEl.textContent = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true });
    if (mstEl) mstEl.textContent = now.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: true });
    updateUrgencyBanner();
}

function renderRoutine() {
    if (routineList) {
        routineList.innerHTML = '';
        routine.forEach((step, index) => {
            const li = document.createElement('li');
            li.className = `routine-item ${isEngaged && index === currentStepIndex && !isTransitMode ? 'active' : ''} ${isEngaged && index < currentStepIndex && !isTransitMode ? 'completed' : ''}`;
            li.innerHTML = `
                <input type="text" class="task-name-input" value="${step.name}" onchange="updateTaskName(${index}, this.value)">
                <div>
                    <input type="number" class="routine-duration-input" value="${step.duration}" min="1" max="45" onchange="updateDuration(${index}, parseInt(this.value))">m
                    <button class="icon-btn" onclick="moveTask(${index}, -1)" title="Move Up">▲</button>
                    <button class="icon-btn" onclick="moveTask(${index}, 1)" title="Move Down">▼</button>
                    <button class="icon-btn" onclick="deleteTask(${index})" title="Delete">×</button>
                </div>
            `;
            routineList.appendChild(li);
        });
    }

    if (activeTaskName) {
        if (!isEngaged) {
            activeTaskName.textContent = "Ready to Engage";
        } else if (!isTransitMode) {
            activeTaskName.textContent = currentStepIndex < routine.length ? routine[currentStepIndex].name : "✨ Core Flow Finished! Start Transit!";
        }
    }
    updateAdaptiveHacks();
}

function renderChecks() {
    if (!checklistContainer) return;
    checklistContainer.innerHTML = '';
    nightChecks.forEach((check, index) => {
        const li = document.createElement('li');
        li.className = 'check-list-item';
        li.innerHTML = `
            <input type="checkbox" style="accent-color: var(--cherry-red);">
            <input type="text" class="task-name-input" value="${check}" onchange="updateCheckName(${index}, this.value)">
            <div><button class="icon-btn" onclick="deleteCheck(${index})" title="Delete">×</button></div>
        `;
        checklistContainer.appendChild(li);
    });
}

function updateDuration(index, newVal) {
    if (isNaN(newVal) || newVal < 1) newVal = 1;
    const diff = newVal - routine[index].duration;
    routine[index].duration = newVal;

    if (diff !== 0) {
        let remainingDiff = -diff;
        let candidates = routine.map((r, i) => i).filter(i => i !== index && routine[i].duration > 2);
        while (remainingDiff !== 0 && candidates.length > 0) {
            candidates.sort((a, b) => routine[b].duration - routine[a].duration);
            let targetIdx = candidates[0];
            if (remainingDiff > 0) {
                routine[targetIdx].duration += 1;
                remainingDiff -= 1;
            } else if (routine[targetIdx].duration > 2) {
                routine[targetIdx].duration -= 1;
                remainingDiff += 1;
            } else {
                candidates = candidates.filter(i => i !== targetIdx);
            }
        }
    }

    saveAndReRender();
    if (!isRunning) {
        if (!isEngaged) {
            timeLeft = getTotalRoutineDuration() * 60;
        } else if (index === currentStepIndex) {
            timeLeft = routine[currentStepIndex].duration * 60;
        }
        updateDisplay();
    }
}

function updateTaskName(index, val) {
    routine[index].name = val.trim() || "Task";
    saveAndReRender();
}

function moveTask(index, direction) {
    const target = index + direction;
    if (target >= 0 && target < routine.length) {
        [routine[index], routine[target]] = [routine[target], routine[index]];
        saveAndReRender();
    }
}

function deleteTask(index) {
    if (routine.length <= 1) return alert("Keep at least one task!");
    routine.splice(index, 1);
    if (currentStepIndex >= routine.length) currentStepIndex = routine.length - 1;
    saveAndReRender();
}

function addNewTask() {
    const nameInput = $('new-task-name');
    const durInput = $('new-task-dur');
    const name = nameInput.value.trim();
    const dur = parseInt(durInput.value) || 5;
    if (name) {
        routine.push({ name: name, duration: dur });
        nameInput.value = '';
        saveAndReRender();
    }
}

function updateCheckName(index, val) {
    nightChecks[index] = val.trim();
    storageSet('night-checks', nightChecks);
}

function deleteCheck(index) {
    nightChecks.splice(index, 1);
    storageSet('night-checks', nightChecks);
    renderChecks();
}

function addNewCheck() {
    const input = $('new-check-name');
    const val = input.value.trim();
    if (val) {
        nightChecks.push(val);
        input.value = '';
        storageSet('night-checks', nightChecks);
        renderChecks();
    }
}

function saveAndReRender() {
    storageSet('routine', routine);
    renderRoutine();
    if (!isEngaged) {
        timeLeft = getTotalRoutineDuration() * 60;
        updateDisplay();
    }
}

function updateDisplay() {
    if (!activeCountdown) return;
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    activeCountdown.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateUrgencyBanner() {
    const statusText = $('urgency-status-text');
    if (!statusText) return;

    const now = new Date();
    let remainingSecs = 0;

    if (!isEngaged) {
        remainingSecs = getTotalRoutineDuration() * 60;
    } else if (!isTransitMode) {
        remainingSecs = timeLeft;
        for (let i = currentStepIndex + 1; i < routine.length; i++) {
            remainingSecs += routine[i].duration * 60;
        }
    } else {
        remainingSecs = timeLeft;
    }

    const remainingMins = Math.ceil(remainingSecs / 60);
    const projectedExit = new Date(now.getTime() + remainingSecs * 1000);
    const exitTimeStr = projectedExit.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const goalTime = new Date(); goalTime.setHours(7, 50, 0, 0);
    const latestTime = new Date(); latestTime.setHours(7, 55, 0, 0);

    if (projectedExit <= goalTime) {
        statusText.innerHTML = `Routine Left: <strong>${remainingMins} mins</strong> | Projected Exit: <span style="color:#0d8a52;">${exitTimeStr}</span> (On track for 7:50 AM! 🎉)`;
    } else if (projectedExit <= latestTime) {
        statusText.innerHTML = `Routine Left: <strong>${remainingMins} mins</strong> | Projected Exit: <span style="color:var(--amber);">${exitTimeStr}</span> (In your 5-min buffer — still fine.)`;
    } else {
        statusText.innerHTML = `Routine Left: <strong>${remainingMins} mins</strong> | Projected Exit: <span style="color: var(--cherry-red);">${exitTimeStr}</span> (⚠️ Past 7:55 AM latest!)`;
    }
}

function triggerAlertEffects() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        osc.connect(gain);
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    } catch (e) {}
    if ('vibrate' in navigator) navigator.vibrate([300, 150, 300]);
}

function toggleTimer() {
    if (!isEngaged) {
        isEngaged = true;
        isTransitMode = false;
        currentStepIndex = 0;
        timeLeft = routine[0].duration * 60;
        if (startPauseBtn) startPauseBtn.textContent = 'Pause';
        isRunning = true;
        requestWakeLock();
        renderRoutine();
        updateDisplay();
        timerInterval = setInterval(runTimerTick, 1000);
        return;
    }

    if (isRunning) {
        clearInterval(timerInterval);
        if (startPauseBtn) startPauseBtn.textContent = 'Resume Flow';
        isRunning = false;
    } else {
        requestWakeLock();
        if (startPauseBtn) startPauseBtn.textContent = 'Pause';
        isRunning = true;
        timerInterval = setInterval(runTimerTick, 1000);
    }
}

function finishRoutine() {
    clearInterval(timerInterval);
    isRunning = false;
    if (activeTaskName) activeTaskName.textContent = "✨ Core Flow Finished! Start Transit!";
    updateUrgencyBanner();
}

function runTimerTick() {
    if (timeLeft > 0) {
        timeLeft--;
        updateDisplay();
        updateUrgencyBanner();
    } else {
        triggerAlertEffects();
        if (!isTransitMode) {
            currentStepIndex++;
            if (currentStepIndex < routine.length) {
                timeLeft = routine[currentStepIndex].duration * 60;
                renderRoutine();
                updateDisplay();
            } else {
                finishRoutine();
            }
        } else {
            clearInterval(timerInterval);
            isRunning = false;
            if (activeTaskName) activeTaskName.textContent = "🏁 Transit Complete. You Have Arrived!";
        }
    }
}

function skipStep() {
    if (!isEngaged || isTransitMode) return;
    currentStepIndex++;
    if (currentStepIndex < routine.length) {
        timeLeft = routine[currentStepIndex].duration * 60;
        renderRoutine();
        updateDisplay();
    } else {
        timeLeft = 0;
        updateDisplay();
        finishRoutine();
    }
}

function startTransitMode() {
    isTransitMode = true;
    clearInterval(timerInterval);
    isRunning = false;
    if (startPauseBtn) startPauseBtn.textContent = 'Start Transit';
    if (activeTaskName) activeTaskName.textContent = "🚶‍♀️ Transit Mode: Walking to Work";
    timeLeft = 10 * 60;
    updateDisplay();
    const banner = $('transit-banner'), title = $('transit-title'), sub = $('transit-sub');
    if (banner) banner.style.background = 'var(--text-color)';
    if (title) title.textContent = "Transit Timer Active ⏱️";
    if (sub) sub.textContent = "Pacing yourself to arrive on time.";
    renderRoutine();
}

function updateAdaptiveHacks() {
    const hacksBox = $('adaptive-hacks');
    if (!hacksBox) return;
    const totalDuration = getTotalRoutineDuration();
    hacksBox.innerHTML = `<ul>
        <li><strong>Active Sequence Load:</strong> <strong>${totalDuration} minutes</strong> scheduled. Goal is out the door by 7:50 AM, with a 5-minute buffer to 7:55 AM latest.</li>
        <li>📱 <strong>Phone Window:</strong> You have a dedicated 10-minute slot for messages and social media right after stretching. Do not bleed past it!</li>
        <li><strong>Hyperfocus Guard:</strong> Never sit on your bed once your 5-minute wake-up stretch is done. Gravity will trap you.</li>
    </ul>`;
}

function logDeparture() {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString();
    historyLog.unshift({ date: dateString, time: timeString });
    if (historyLog.length > 10) historyLog.pop();
    storageSet('departure-history', historyLog);
    const box = $('door-result-box');
    if (box) box.textContent = `🚪 Threshold crossed at ${timeString}. Logged and secured!`;
    renderTrends();
}

function renderTrends() {
    const logBox = $('trends-log');
    if (!logBox) return;
    if (historyLog.length === 0) {
        logBox.textContent = "No departures logged yet. Hit the threshold button when you walk out!";
        return;
    }
    logBox.innerHTML = historyLog.map(h => `<div>📅 <strong>${h.date}</strong> — Exited at <em>${h.time}</em></div>`).join('');
}

// ---------- Optional: AI coaching tip via Gemini API (full dashboard only) ----------
async function getAiTip() {
    const tipBox = $('ai-tip-box');
    if (!tipBox) return;

    let apiKey = storageGet('gemini-api-key', null);
    if (!apiKey) {
        apiKey = prompt("Paste your Gemini API key (from aistudio.google.com/apikey). It's stored only in this browser's local storage:");
        if (!apiKey) return;
        storageSet('gemini-api-key', apiKey);
    }

    tipBox.textContent = "Thinking...";

    const recentExits = historyLog.slice(0, 5).map(h => `${h.date} ${h.time}`).join(', ') || 'no logged departures yet';
    const prompt_text = `You are a supportive ADHD-friendly morning coach. My routine totals ${getTotalRoutineDuration()} minutes, goal is out the door by 7:50 AM (7:55 AM latest buffer). My last 5 logged departure times: ${recentExits}. In 2-3 short sentences, give me one specific, encouraging, actionable tip to improve my morning flow. No generic filler.`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt_text }] }] })
        });
        if (!res.ok) {
            const errText = await res.text();
            tipBox.textContent = `Couldn't reach Gemini (${res.status}). Check your API key. ${errText.slice(0, 150)}`;
            return;
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No tip returned — try again.";
        tipBox.textContent = text;
    } catch (e) {
        tipBox.textContent = "Network error reaching Gemini API. Check your connection and try again.";
    }
}

function resetGeminiKey() {
    localStorage.removeItem('gemini-api-key');
    const tipBox = $('ai-tip-box');
    if (tipBox) tipBox.textContent = "API key cleared. Click 'Get AI Coaching Tip' to enter a new one.";
}

// ---------- Init ----------
function initApp() {
    applySettings();
    updateClocks();
    setInterval(updateClocks, 1000);
    renderRoutine();
    renderChecks();
    timeLeft = getTotalRoutineDuration() * 60;
    updateDisplay();
    renderTrends();
}

document.addEventListener('DOMContentLoaded', initApp);
