/**
 * record-match.js
 * Handles the "Record New Match" modal and submits to POST /matches
 *
 * Save this file as:  js/record-match.js
 * Then add to index.html (bottom, after the existing script tag):
 *   <script type="module" src="js/record-match.js"></script>
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = "https://api.mitrado.net"; // change to your Go server URL

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    sportTypeId: 1,
    isDoubles: false,
    scores: { A: 0, B: 0 },
    // Each slot holds a numeric user_id (or null if not filled yet)
    players: {
        A: [null, null], // [player1, player2]  — player2 only used in doubles
        B: [null, null],
    },
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const modal = document.getElementById("matchModal");
const backdrop = document.getElementById("modalBackdrop");
const closeBtn = document.getElementById("closeModalBtn");
const openBtn = document.getElementById("recordMatchBtn");
const submitBtn = document.getElementById("submitMatchBtn");
const errorEl = document.getElementById("matchError");
const scoreAEl = document.getElementById("scoreA");
const scoreBEl = document.getElementById("scoreB");
const teamAPlayers = document.getElementById("teamAPlayers");
const teamBPlayers = document.getElementById("teamBPlayers");
const fmtSingles = document.getElementById("fmtSingles");
const fmtDoubles = document.getElementById("fmtDoubles");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
}
function clearError() {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
}

/** Build one player-id input row */
/*
function playerRow(team, index) {
    const label = state.isDoubles
        ? `Player ${index + 1}`
        : (team === "A" ? "You (Player)" : "Opponent");

    const div = document.createElement("div");
    div.className = "flex items-center gap-2";
    div.innerHTML = `
    <span class="text-xs text-slate-500 w-24 shrink-0">${label}</span>
    <input
      type="number" min="1" placeholder="User ID"
      data-team="${team}" data-index="${index}"
      class="player-input flex-1 px-3 py-1.5 rounded-lg border border-slate-200
             focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
      value="${state.players[team][index] ?? ""}"
    />`;
    return div;
}
*/

/** Re-render both team player rows based on current format */
function playerRow(team, index) {
    const div = document.createElement("div");
    div.className = "player-slot flex items-center gap-2 mb-2";

    div.innerHTML = `
        <input type="text" placeholder="Guest name" data-team="${team}" data-index="${index}"
            class="player-input flex-1 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm" />
        <span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-500 shrink-0">Guest</span>
        <button type="button"
            class="toggle-type-btn text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-all shrink-0">
            Member?
        </button>
    `;

    div.querySelector(".toggle-type-btn").addEventListener("click", () => {
        togglePlayerType(div, team, index);
    });

    return div;
}

function togglePlayerType(slot, team, index) {
    const badge = slot.querySelector("span");
    const isGuest = badge.textContent === "Guest";
    const btn = slot.querySelector(".toggle-type-btn");

    if (isGuest) {
        // switch to Member — replace input with select
        const input = slot.querySelector("input");
        const select = document.createElement("select");
        select.dataset.team = team;
        select.dataset.index = index;
        select.className = "player-select flex-1 px-3 py-2 rounded-xl border border-blue-300 bg-blue-50 text-blue-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
        select.innerHTML = `<option disabled selected>Search member...</option>`;
        // TODO: populate with your members from API
        // e.g. members.forEach(m => select.innerHTML += `<option value="${m.id}">${m.name}</option>`)
        select.addEventListener("change", (e) => {
            state.players[team][index] = e.target.value; // Firebase UID
        });
        input.replaceWith(select);
        badge.textContent = "Member";
        badge.className = "text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-blue-600 shrink-0";
        btn.textContent = "Guest?";
        btn.className = "toggle-type-btn text-[11px] font-semibold px-2 py-1 rounded-lg border border-blue-200 text-blue-400 hover:border-slate-300 hover:text-slate-500 transition-all shrink-0";
    } else {
        // switch back to Guest — replace select with input
        const select = slot.querySelector("select");
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Guest name";
        input.dataset.team = team;
        input.dataset.index = index;
        input.className = "player-input flex-1 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm";
        input.addEventListener("input", (e) => {
            state.players[team][index] = e.target.value || null;
        });
        select.replaceWith(input);
        badge.textContent = "Guest";
        badge.className = "text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-500 shrink-0";
        btn.textContent = "Member?";
        btn.className = "toggle-type-btn text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-all shrink-0";
    }
}

function renderPlayers() {
    teamAPlayers.innerHTML = "";
    teamBPlayers.innerHTML = "";

    const slots = state.isDoubles ? [0, 1] : [0];
    slots.forEach((i) => {
        teamAPlayers.appendChild(playerRow("A", i));
        teamBPlayers.appendChild(playerRow("B", i));
    });

    // Sync guest name input changes back to state
    document.querySelectorAll(".player-input").forEach((inp) => {
        inp.addEventListener("input", (e) => {
            const t = e.target.dataset.team;
            const idx = Number(e.target.dataset.index);
            state.players[t][idx] = e.target.value || null;
        });
    });
}

function updateScoreDisplay() {
    scoreAEl.textContent = state.scores.A;
    scoreBEl.textContent = state.scores.B;
    // Colour hint
    scoreAEl.className = `font-black text-2xl w-8 text-center ${state.scores.A > state.scores.B ? "text-green-600" : "text-slate-900"
        }`;
    scoreBEl.className = `font-black text-2xl w-8 text-center ${state.scores.B > state.scores.A ? "text-green-600" : "text-slate-900"
        }`;
}

/** Open / close modal */
function openModal() {
    clearError();
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
}
function closeModal() {
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
}

// ─── Build the POST /matches payload ─────────────────────────────────────────
function buildPayload() {
    const location = document.getElementById("matchLocation").value.trim();
    const communityId = null; // extend later if you add a community selector

    const participants = [];
    const slots = state.isDoubles ? [0, 1] : [0];

    for (const team of ["A", "B"]) {
        for (const idx of slots) {
            const uid = state.players[team][idx];
            if (!uid) throw new Error(`Missing User ID for Team ${team} Player ${idx + 1}`);
            participants.push({
                user_id: uid,
                team_identifier: team,
                score: state.scores[team],
            });
        }
    }

    if (state.scores.A === state.scores.B) {
        throw new Error("Scores are tied — a winner must be determined.");
    }

    return {
        sport_type_id: state.sportTypeId,
        community_id: communityId,
        location,
        participants,
    };
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function submitMatch() {
    clearError();
    let payload;
    try {
        payload = buildPayload();
    } catch (err) {
        showError(err.message);
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `
    <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
    </svg>
    Saving…`;

    try {
        const res = await fetch(`${API_BASE}/api/matches`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error ?? "Server error");
        }

        // Success — show a toast-style message then close
        closeModal();
        showToast(`Match #${data.match_id} saved! 🎉`);

        // Reset state for next entry
        state.scores = { A: 0, B: 0 };
        state.players = { A: [null, null], B: [null, null] };
        document.getElementById("matchLocation").value = "";
        renderPlayers();
        updateScoreDisplay();

    } catch (err) {
        showError(err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
      <span class="material-symbols-outlined text-base">check_circle</span>
      Save Match Result`;
    }
}

/** Minimal toast notification */
function showToast(msg) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    toast.className = `
    fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2
    bg-slate-900 text-white text-sm font-bold px-6 py-3 rounded-full shadow-xl z-[999]
    transition-all duration-300 opacity-100`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Open / close
openBtn?.addEventListener("click", openModal);
closeBtn.addEventListener("click", closeModal);
backdrop.addEventListener("click", closeModal);

// Sport selector
document.getElementById("sportSelector").addEventListener("click", (e) => {
    const btn = e.target.closest(".sport-btn");
    if (!btn) return;
    state.sportTypeId = Number(btn.dataset.sportId);
    document.querySelectorAll(".sport-btn").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("bg-orange-500", active);
        b.classList.toggle("text-white", active);
        b.classList.toggle("border-orange-500", active);
        b.classList.toggle("border-slate-200", !active);
        b.classList.toggle("text-slate-600", !active);
    });
});

// Format toggle
fmtSingles.addEventListener("click", () => {
    state.isDoubles = false;
    fmtSingles.className = "fmt-btn py-3 rounded-xl border-2 border-orange-500 bg-orange-50 text-orange-700 font-bold text-sm transition-all";
    fmtDoubles.className = "fmt-btn py-3 rounded-xl border-2 border-slate-200 text-slate-500 font-bold text-sm hover:border-orange-300 transition-all";
    renderPlayers();
});
fmtDoubles.addEventListener("click", () => {
    state.isDoubles = true;
    fmtDoubles.className = "fmt-btn py-3 rounded-xl border-2 border-orange-500 bg-orange-50 text-orange-700 font-bold text-sm transition-all";
    fmtSingles.className = "fmt-btn py-3 rounded-xl border-2 border-slate-200 text-slate-500 font-bold text-sm hover:border-orange-300 transition-all";
    renderPlayers();
});

// Score +/- buttons
document.addEventListener("click", (e) => {
    const btn = e.target.closest(".score-btn");
    if (!btn) return;
    const team = btn.dataset.team;
    const action = btn.dataset.action;
    if (action === "inc") state.scores[team] = Math.min(99, state.scores[team] + 1);
    if (action === "dec") state.scores[team] = Math.max(0, state.scores[team] - 1);
    updateScoreDisplay();
});

// Submit
submitBtn.addEventListener("click", submitMatch);

// ─── Init ─────────────────────────────────────────────────────────────────────
renderPlayers();
updateScoreDisplay();