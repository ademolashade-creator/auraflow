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
let historyLog = storageGet('departure-history', []).map((h) => {
    const migrated = h.departTime !== undefined ? h : { date: h.date, departTime: h.time, departTimestamp: null, arriveTime: null, transitMinutes: null };
    if (migrated.destination === undefined) migrated.destination = 'the office';
    return migrated;
});
let timeTargets = storageGet('aura-time-targets', { goal: '07:50', latest: '07:55' });

let isEngaged = false;
let currentStepIndex = 0;
let timeLeft = getTotalRoutineDuration() * 60;
let isRunning = false;
let isTransitMode = false;
let timerInterval = null;

// ---------- Element lookups (may be null depending on which page loaded this script) ----------
const $ = (id) => document.getElementById(id);

function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
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

function getAuraTimezone() {
    return storageGet('aura-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function updateAuraTimezone(tz) {
    storageSet('aura-timezone', tz);
    updateClocks();
}

function populateAuraTimezoneSelect() {
    const sel = $('aura-timezone-select');
    if (!sel) return;
    let zones;
    try { zones = Intl.supportedValuesOf('timeZone'); }
    catch (e) { zones = ['UTC', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Australia/Sydney']; }
    const current = getAuraTimezone();
    sel.innerHTML = zones.map((z) => `<option value="${z}" ${z === current ? 'selected' : ''}>${z}</option>`).join('');
}

function formatDateDDMMYYYY(date, tz) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(date);
    const map = {};
    parts.forEach((p) => { map[p.type] = p.value; });
    return `${map.day}/${map.month}/${map.year}`;
}

function updateClocks() {
    const now = new Date();
    const tz = getAuraTimezone();
    const dateEl = $('clock-date'), timeEl = $('clock-time');
    if (dateEl) dateEl.textContent = formatDateDDMMYYYY(now, tz);
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: true });
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
    const budgetInput = $('total-budget-input');
    if (budgetInput) budgetInput.value = getTotalRoutineDuration();
    updateSubtitle();
    updateAdaptiveHacks();
}

function formatDurationHM(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const parts = [];
    if (h > 0) parts.push(`${h} Hour${h !== 1 ? 's' : ''}`);
    if (m > 0 || h === 0) parts.push(`${m} Minute${m !== 1 ? 's' : ''}`);
    return parts.join(' ');
}

function updateSubtitle() {
    const sub = $('app-subtitle');
    if (sub) sub.textContent = `${formatDurationHM(getTotalRoutineDuration())} to Punctuality, Precision, and Control.`;
}

function updateTotalBudget(newTotalStr) {
    let newTotal = parseInt(newTotalStr);
    const currentTotal = getTotalRoutineDuration();
    if (isNaN(newTotal) || newTotal < routine.length) {
        alert(`Total must be at least ${routine.length} minutes (1 per step).`);
        renderRoutine();
        return;
    }
    if (currentTotal === 0) return;

    let assigned = 0;
    routine.forEach((step, i) => {
        if (i === routine.length - 1) {
            step.duration = Math.max(1, newTotal - assigned);
        } else {
            const scaled = Math.max(1, Math.round((step.duration / currentTotal) * newTotal));
            step.duration = scaled;
            assigned += scaled;
        }
    });

    saveAndReRender();
}

// ---------- AI-suggested routine (Gemini) ----------
function saveApiKey(key) { storageSet('gemini_api_key', key); }

let pendingAiRoutine = null;

async function suggestAiRoutine() {
    const apiKey = storageGet('gemini_api_key', null);
    const box = $('ai-routine-preview');
    if (!apiKey) { alert('Add your Gemini API key above first.'); return; }

    const occasion = getDestination();
    const budget = parseInt($('total-budget-input').value) || getTotalRoutineDuration();
    const currentNames = routine.map((r) => r.name).join(', ');

    box.style.display = 'block';
    box.innerHTML = 'Thinking...';

    const promptText = `You are helping build a realistic getting-ready routine.
Occasion: "${occasion}"
Total time budget: ${budget} minutes
Current routine steps (for reference): ${currentNames}

Produce a practical, realistic list of routine steps for this occasion that fits within the total time budget. If the occasion is ordinary (like an office day), reuse or lightly adapt the current steps where they still make sense, only adding new ones if genuinely useful. If the occasion is something like a date, interview, event, or trip, include occasion-specific preparation tasks in addition to normal necessities (for an interview: reviewing talking points, preparing documents, professional grooming; for a date: grooming, outfit choice, fragrance, mental preparation; adapt sensibly to whatever occasion is given). Give each step a short name, with a fitting emoji at the start if natural, and a realistic number of minutes. The total across all steps should add up to approximately the given budget.

Respond with ONLY a JSON array, no other text, in exactly this form: [{"name": "🌅 Wake Up & Stretch", "duration": 5}]`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
        });
        if (!res.ok) {
            box.textContent = `Couldn't reach Gemini (${res.status}). Check your API key.`;
            return;
        }
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const suggested = JSON.parse(cleaned).filter((s) => s.name && s.duration > 0);
        if (suggested.length === 0) { box.textContent = 'No suggestion returned — try again.'; return; }
        pendingAiRoutine = suggested;
        renderAiRoutinePreview();
    } catch (e) {
        box.textContent = 'Something went wrong generating a suggestion. Try again.';
    }
}

function renderAiRoutinePreview() {
    const box = $('ai-routine-preview');
    if (!pendingAiRoutine) { box.style.display = 'none'; return; }
    const total = pendingAiRoutine.reduce((a, s) => a + s.duration, 0);
    box.innerHTML = `
        <div style="font-size:0.8rem;margin-bottom:6px;">Suggested for "${escapeHTML(getDestination())}" (${total} min total). Nothing is applied yet:</div>
        <ul class="routine-list" style="max-height:220px;">
            ${pendingAiRoutine.map((s) => `<li class="routine-item">${escapeHTML(s.name)} — ${s.duration}m</li>`).join('')}
        </ul>
        <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="add-btn" style="flex:1;" onclick="applyAiRoutine()">Apply This Routine</button>
            <button class="btn-secondary" onclick="dismissAiRoutine()">Cancel</button>
        </div>
    `;
}

function applyAiRoutine() {
    if (!pendingAiRoutine) return;
    routine = pendingAiRoutine.map((s) => ({ name: s.name, duration: Math.max(1, Math.round(s.duration)) }));
    pendingAiRoutine = null;
    saveAndReRender();
    $('ai-routine-preview').style.display = 'none';
}

function dismissAiRoutine() {
    pendingAiRoutine = null;
    $('ai-routine-preview').style.display = 'none';
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

function formatDisplayTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    let hour12 = h % 12; if (hour12 === 0) hour12 = 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function parseTimeToDateToday(hhmm) {
    const [h, m] = (hhmm || '07:50').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
}

function updateTimeTargetsLabel() {
    const label = $('urgency-title-text');
    if (label) label.textContent = `🚨 Goal: Out by ${formatDisplayTime(timeTargets.goal)} · Latest ${formatDisplayTime(timeTargets.latest)}`;
}

function updateTimeTargets() {
    const g = $('goal-time-input').value || '07:50';
    const l = $('latest-time-input').value || '07:55';
    timeTargets = { goal: g, latest: l };
    storageSet('aura-time-targets', timeTargets);
    updateTimeTargetsLabel();
    updateUrgencyBanner();
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

    const goalTime = parseTimeToDateToday(timeTargets.goal);
    const latestTime = parseTimeToDateToday(timeTargets.latest);

    if (projectedExit <= goalTime) {
        statusText.innerHTML = `Routine Left: <strong>${remainingMins} mins</strong> | Projected Exit: <span style="color:#0d8a52;">${exitTimeStr}</span> (On track! 🎉)`;
    } else if (projectedExit <= latestTime) {
        statusText.innerHTML = `Routine Left: <strong>${remainingMins} mins</strong> | Projected Exit: <span style="color:var(--amber);">${exitTimeStr}</span> (In your buffer \u2014 still fine.)`;
    } else {
        statusText.innerHTML = `Routine Left: <strong>${remainingMins} mins</strong> | Projected Exit: <span style="color: var(--cherry-red);">${exitTimeStr}</span> (⚠️ Past ${formatDisplayTime(timeTargets.latest)}!)`;
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
    if (activeTaskName) activeTaskName.textContent = `🚦 Transit Mode: Heading to ${getDestination()}`;
    timeLeft = getWalkMinutes() * 60;
    updateDisplay();
    const banner = $('transit-banner'), title = $('transit-title'), sub = $('transit-sub');
    if (banner) banner.style.background = 'var(--text-color)';
    if (title) title.textContent = "Transit Timer Active ⏱️";
    if (sub) sub.textContent = "Pacing yourself to arrive on time.";
    renderRoutine();
}

function getWalkMinutes() {
    return parseInt(storageGet('aura-walk-minutes', 10)) || 10;
}

function getDestination() {
    return storageGet('aura-destination', 'the office');
}

function updateDestination(newVal) {
    const dest = (newVal || '').trim() || 'the office';
    storageSet('aura-destination', dest);
    refreshDestinationLabels();
}

function refreshDestinationLabels() {
    const dest = getDestination();
    const sub = $('transit-sub');
    const actionBtn = $('transit-action-btn');
    const arrivalBtn = $('arrival-btn');
    const destInput = $('destination-input');
    const occasionInput = $('occasion-input');
    if (sub && !isTransitMode) sub.textContent = `${getWalkMinutes()}-minute transit to ${dest} — hit this when you lock the door and step out.`;
    if (actionBtn) actionBtn.textContent = `🚦 Start Transit to ${dest}`;
    if (arrivalBtn) arrivalBtn.textContent = `🏁 I've Arrived at ${dest}`;
    if (destInput) destInput.value = dest;
    if (occasionInput) occasionInput.value = dest;
}

function updateWalkMinutes(newVal) {
    const minutes = Math.max(1, parseInt(newVal) || 10);
    storageSet('aura-walk-minutes', minutes);
    refreshDestinationLabels();
}

function updateAdaptiveHacks() {
    const hacksBox = $('adaptive-hacks');
    if (!hacksBox) return;
    const totalDuration = getTotalRoutineDuration();
    const bufferMin = Math.round((parseTimeToDateToday(timeTargets.latest) - parseTimeToDateToday(timeTargets.goal)) / 60000);
    hacksBox.innerHTML = `<ul>
        <li><strong>Active Sequence Load:</strong> <strong>${totalDuration} minutes</strong> scheduled. Goal is out the door by ${formatDisplayTime(timeTargets.goal)}, with a ${Math.abs(bufferMin)}-minute buffer to ${formatDisplayTime(timeTargets.latest)} latest.</li>
        <li>📱 <strong>Phone Window:</strong> You have a dedicated 10-minute slot for messages and social media right after stretching. Do not bleed past it!</li>
        <li><strong>Hyperfocus Guard:</strong> Never sit on your bed once your 5-minute wake-up stretch is done. Gravity will trap you.</li>
    </ul>`;
}

function logDeparture() {
    const now = new Date();
    historyLog.unshift({
        date: now.toLocaleDateString(),
        departTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        departTimestamp: now.getTime(),
        arriveTime: null,
        transitMinutes: null,
        destination: getDestination()
    });
    if (historyLog.length > 10) historyLog.pop();
    storageSet('departure-history', historyLog);
    const box = $('door-result-box');
    if (box) box.textContent = `🚪 Threshold crossed at ${historyLog[0].departTime}. Logged and secured!`;
    renderTrends();
    renderOccasionPatterns();
}

function logArrival() {
    const openEntry = historyLog.find((h) => h.arriveTime === null && h.departTimestamp);
    const box = $('door-result-box');
    if (!openEntry) {
        if (box) box.textContent = "No open departure to match this arrival to \u2014 log your departure first.";
        return;
    }
    const now = new Date();
    openEntry.arriveTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    openEntry.transitMinutes = Math.max(1, Math.round((now.getTime() - openEntry.departTimestamp) / 60000));
    storageSet('departure-history', historyLog);
    if (box) box.textContent = `🏁 Arrived at ${openEntry.arriveTime} \u2014 ${openEntry.transitMinutes} min transit.`;
    renderTrends();
    renderOccasionPatterns();
}

function renderOccasionPatterns() {
    const box = $('occasion-patterns-box');
    if (!box) return;
    const completedTrips = historyLog.filter((h) => h.arriveTime && h.transitMinutes);
    if (completedTrips.length === 0) {
        box.innerHTML = '<p style="font-size:0.8rem;color:#888;">Log a few arrivals to see your average transit time by occasion.</p>';
        return;
    }

    const groups = {};
    completedTrips.forEach((h) => {
        const dest = h.destination || 'the office';
        if (!groups[dest]) groups[dest] = { total: 0, count: 0 };
        groups[dest].total += h.transitMinutes;
        groups[dest].count += 1;
    });

    box.innerHTML = Object.keys(groups).map((dest) => {
        const avg = Math.round(groups[dest].total / groups[dest].count);
        const trips = groups[dest].count;
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>${escapeHTML(dest)}</span><span><strong>${avg} min</strong> avg (${trips} trip${trips > 1 ? 's' : ''})</span></div>`;
    }).join('');
}

// ---------- Export data ----------
function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportAllDataJSON() {
    const data = {
        exportedAt: new Date().toISOString(),
        appSettings, routine, nightChecks, historyLog, timeTargets,
        destination: getDestination(), walkMinutes: getWalkMinutes()
    };
    downloadBlob(JSON.stringify(data, null, 2), `aura-export-${getTodayKeyAura()}.json`, 'application/json');
}

function exportHistoryCSV() {
    const rows = [['Date', 'Destination', 'Departed', 'Arrived', 'Transit (min)']];
    historyLog.forEach((h) => rows.push([h.date, h.destination || '', h.departTime || '', h.arriveTime || '', h.transitMinutes || '']));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(csv, `aura-history-${getTodayKeyAura()}.csv`, 'text/csv');
}

function getTodayKeyAura() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderTrends() {
    const logBox = $('trends-log');
    if (!logBox) return;
    if (historyLog.length === 0) {
        logBox.textContent = "No departures logged yet. Hit the threshold button when you walk out!";
        return;
    }
    logBox.innerHTML = historyLog.map((h) => {
        if (h.arriveTime) {
            const estimate = getWalkMinutes();
            const diff = h.transitMinutes - estimate;
            const diffLabel = diff <= 0 ? `${Math.abs(diff)} min under your ${estimate}-min estimate` : `${diff} min over your ${estimate}-min estimate`;
            return `<div>📅 <strong>${h.date}</strong> — Left ${h.departTime}, arrived ${h.arriveTime} (${h.transitMinutes} min, ${diffLabel})</div>`;
        }
        return `<div>📅 <strong>${h.date}</strong> — Left ${h.departTime} <em>(transit in progress)</em></div>`;
    }).join('');
}

// ---------- Optional: AI coaching tip via Gemini API (full dashboard only) ----------
async function getAiTip() {
    const tipBox = $('ai-tip-box');
    if (!tipBox) return;

    const apiKey = storageGet('gemini_api_key', null);
    if (!apiKey) {
        tipBox.textContent = 'Add your Gemini API key in the AI settings section above first.';
        return;
    }

    tipBox.textContent = "Thinking...";

    const recentExits = historyLog.slice(0, 5).map(h => `${h.date} ${h.departTime}`).join(', ') || 'no logged departures yet';
    const prompt_text = `You are a supportive ADHD-friendly morning coach. My routine totals ${getTotalRoutineDuration()} minutes, goal is out the door by ${formatDisplayTime(timeTargets.goal)} (${formatDisplayTime(timeTargets.latest)} latest buffer), heading to ${getDestination()}. My last 5 logged departure times: ${recentExits}. In 2-3 short sentences, give me one specific, encouraging, actionable tip to improve my routine. No generic filler.`;

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
    localStorage.removeItem('gemini_api_key');
    const apiKeyInput = $('gemini-api-key-input');
    if (apiKeyInput) apiKeyInput.value = '';
    const tipBox = $('ai-tip-box');
    if (tipBox) tipBox.textContent = "API key cleared. Add a new one in the AI settings section above.";
}

// ---------- Init ----------
function initApp() {
    applySettings();
    populateAuraTimezoneSelect();
    updateClocks();
    setInterval(updateClocks, 1000);
    renderRoutine();
    renderChecks();
    timeLeft = getTotalRoutineDuration() * 60;
    updateDisplay();
    renderTrends();
    renderOccasionPatterns();
    const latestInput = $('latest-time-input');
    if (goalInput) goalInput.value = timeTargets.goal;
    if (latestInput) latestInput.value = timeTargets.latest;
    updateTimeTargetsLabel();

    const walkInput = $('walk-minutes-input');
    const walkMinutes = getWalkMinutes();
    if (walkInput) walkInput.value = walkMinutes;
    refreshDestinationLabels();

    const apiKeyInput = $('gemini-api-key-input');
    if (apiKeyInput) apiKeyInput.value = storageGet('gemini_api_key', '');
}

document.addEventListener('DOMContentLoaded', initApp);
