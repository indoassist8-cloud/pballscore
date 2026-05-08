/**
 * record-match.js
 * Handles the "Record New Match" modal and submits to POST /api/matches
 */

const API_BASE = "https://api.mitrado.net";

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    sportTypeId: 1, // Default 1 (Pickleball)
    isDoubles: true,
    location: "",
    // Each player is { type: 'guest'|'member', value: string|null }
    players: {
        A: [{ type: 'member', value: null }, { type: 'member', value: null }],
        B: [{ type: 'guest', value: null }, { type: 'guest', value: null }],
    },
    sets: [
        { set_number: 1, score_team_a: 0, score_team_b: 0 }
    ]
};

// ─── DOM References ───────────────────────────────────────────────────────────
const modal = document.querySelector(".fixed.inset-0.z-\\[60\\]"); // The outer div
const playerContainers = {
    A: document.querySelector(".bg-slate-900.p-5:nth-of-type(1) .space-y-4"),
    B: document.querySelector(".bg-slate-900.p-5:nth-of-type(2) .space-y-4"),
};
const setListContainer = document.querySelector(".space-y-3:has(.w-10)");
const addSetBtn = document.querySelector("button:has(.group-hover\\:rotate-90)");
const saveBtn = document.querySelector("button:has(span[data-icon='check_circle'])");
const discardBtn = document.querySelector("button:contains('Discard')");

// ─── Initialization ──────────────────────────────────────────────────────────
function init() {
    renderPlayers();
    renderSets();
    setupEventListeners();
}

// ─── UI Rendering ────────────────────────────────────────────────────────────

function renderPlayers() {
    ["A", "B"].forEach(team => {
        const container = playerContainers[team];
        container.innerHTML = "";

        const count = state.isDoubles ? 2 : 1;
        for (let i = 0; i < count; i++) {
            const player = state.players[team][i];
            const row = document.createElement("div");
            row.className = "flex items-center justify-between";

            const isMember = player.type === 'member';

            row.innerHTML = `
                <div class="flex items-center gap-3 flex-1">
                    <div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
                        <span class="material-symbols-outlined text-sm">person</span>
                    </div>
                    ${isMember
                    ? `<select class="bg-transparent border-none p-0 text-white text-sm focus:ring-0 w-full player-val" data-team="${team}" data-index="${i}">
                             <option value="" disabled ${!player.value ? 'selected' : ''}>Select Member...</option>
                             <option value="user_123" ${player.value === 'user_123' ? 'selected' : ''}>Marcus Chen</option>
                           </select>`
                    : `<input type="text" class="bg-transparent border-none p-0 text-white text-sm focus:ring-0 w-full player-val" 
                             placeholder="Guest Name..." data-team="${team}" data-index="${i}" value="${player.value || ''}">`
                }
                </div>
                <label class="flex items-center cursor-pointer toggle-member" data-team="${team}" data-index="${i}">
                    <span class="text-[10px] text-slate-500 mr-2 uppercase font-bold">${isMember ? 'Member' : 'Guest'}</span>
                    <div class="relative w-8 h-4 ${isMember ? 'bg-orange-600' : 'bg-slate-700'} rounded-full transition-colors">
                        <div class="absolute ${isMember ? 'right-0.5' : 'left-0.5'} top-0.5 bg-white w-3 h-3 rounded-full shadow-sm transition-all"></div>
                    </div>
                </label>
            `;
            container.appendChild(row);
        }
    });
}

function renderSets() {
    setListContainer.innerHTML = "";
    state.sets.forEach((set, index) => {
        const row = document.createElement("div");
        row.className = "flex items-center gap-4";
        row.innerHTML = `
            <div class="w-10 text-slate-500 font-black text-xs">SET ${set.set_number}</div>
            <div class="flex-1 flex gap-4">
                <input type="number" class="set-score w-full bg-slate-900 border-slate-700 rounded-lg text-center text-orange-500 font-display-stat text-2xl py-1 focus:border-orange-500 focus:ring-0" 
                    data-index="${index}" data-team="a" value="${set.score_team_a}">
                <input type="number" class="set-score w-full bg-slate-900 border-slate-700 rounded-lg text-center text-white font-display-stat text-2xl py-1 focus:border-orange-500 focus:ring-0" 
                    data-index="${index}" data-team="b" value="${set.score_team_b}">
            </div>
            <button class="delete-set text-slate-600 hover:text-red-500 transition-colors" data-index="${index}">
                <span class="material-symbols-outlined text-sm">delete</span>
            </button>
        `;
        setListContainer.appendChild(row);
    });
}

// ─── Logic & Helpers ─────────────────────────────────────────────────────────

function setupEventListeners() {
    // 1. Toggle Member/Guest
    document.addEventListener("click", e => {
        const toggle = e.target.closest(".toggle-member");
        if (toggle) {
            const { team, index } = toggle.dataset;
            state.players[team][index].type = state.players[team][index].type === 'member' ? 'guest' : 'member';
            state.players[team][index].value = null; // reset value on toggle
            renderPlayers();
        }
    });

    // 2. Sync Player Inputs
    document.addEventListener("change", e => {
        if (e.target.classList.contains("player-val")) {
            const { team, index } = e.target.dataset;
            state.players[team][index].value = e.target.value;
        }
    });

    // 3. Set Scores
    document.addEventListener("input", e => {
        if (e.target.classList.contains("set-score")) {
            const { index, team } = e.target.dataset;
            const val = parseInt(e.target.value) || 0;
            state.sets[index][team === 'a' ? 'score_team_a' : 'score_team_b'] = val;
        }
    });

    // 4. Add/Delete Sets
    addSetBtn.addEventListener("click", () => {
        state.sets.push({ set_number: state.sets.length + 1, score_team_a: 0, score_team_b: 0 });
        renderSets();
    });

    document.addEventListener("click", e => {
        const btn = e.target.closest(".delete-set");
        if (btn) {
            const idx = parseInt(btn.dataset.index);
            state.sets.splice(idx, 1);
            // Re-index set numbers
            state.sets.forEach((s, i) => s.set_number = i + 1);
            renderSets();
        }
    });

    // 5. Submit
    saveBtn.addEventListener("click", submitMatch);
}

function buildPayload() {
    const locInput = document.querySelector("input[placeholder*='Riverside']");

    // Calculate total sets won to provide a "final score"
    let setsA = 0;
    let setsB = 0;
    state.sets.forEach(s => {
        if (s.score_team_a > s.score_team_b) setsA++;
        else if (s.score_team_b > s.score_team_a) setsB++;
    });

    const participants = [];
    ["A", "B"].forEach(team => {
        const count = state.isDoubles ? 2 : 1;
        const totalScore = (team === "A") ? setsA : setsB;

        for (let i = 0; i < count; i++) {
            const p = state.players[team][i];
            if (!p.value) throw new Error(`Please fill in Player ${i + 1} for Team ${team}`);

            participants.push({
                user_id: p.type === 'member' ? p.value : null,
                guest_name: p.type === 'guest' ? p.value : null,
                team_identifier: team,
                score: totalScore // The backend expects a score to determine winner
            });
        }
    });

    return {
        sport_type_id: state.sportTypeId,
        location: locInput.value || "General Location",
        participants: participants,
        sets: state.sets
    };
}

async function submitMatch() {
    try {
        const payload = buildPayload();
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";

        const res = await fetch(`${API_BASE}/api/matches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || "Server Error");
        }

        alert("Match saved successfully! 🎉");
        location.reload(); // Or close modal/reset state
    } catch (err) {
        alert(err.message);
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Match Result";
    }
}

// Run Init
init();