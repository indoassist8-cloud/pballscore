/**
 * record-match.js
 * Handles the "Record New Match" modal and submits to POST /api/matches
 *
 * Supports:
 *  - Sport selection
 *  - Singles / Doubles format
 *  - Per-player Guest (text) / Member (select) toggle
 *  - Dynamic set rows (add / delete)
 *  - Auto-computes sets-won score & winner from set point totals
 *  - Validates everything before submitting
 *
 * Save as: js/record-match.js
 * Add to index.html (bottom, after existing scripts):
 *   <script type="module" src="js/record-match.js"></script>
 */

// ─── Config ────────────────────────────────────────────────────────────────────
const API_BASE = "https://api.mitrado.net";
const CURRENT_USER_ID = localStorage.getItem("loggedInUserId"); // Firebase UID

// ─── State ─────────────────────────────────────────────────────────────────────
const state = {
    sportTypeId: 1,
    isDoubles: false,
    // players[team][index] = { type: "guest"|"member", value: string|null }
    players: {
        A: [{ type: "guest", value: null }, { type: "guest", value: null }],
        B: [{ type: "guest", value: null }, { type: "guest", value: null }],
    },
    // sets = [{ scoreA: number, scoreB: number }, ...]
    sets: [
        { scoreA: 0, scoreB: 0 },
        { scoreA: 0, scoreB: 0 },
    ],
};

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const modal = document.getElementById("matchModal");
const backdrop = document.getElementById("modalBackdrop");
const closeBtn = document.getElementById("closeModalBtn");
const openBtn = document.getElementById("recordMatchBtn");
const submitBtn = document.getElementById("submitMatchBtn");
const discardBtn = document.getElementById("discardMatchBtn");
const errorEl = document.getElementById("matchError");
const teamAPlayers = document.getElementById("teamAPlayers");
const teamBPlayers = document.getElementById("teamBPlayers");
const fmtSingles = document.getElementById("fmtSingles");
const fmtDoubles = document.getElementById("fmtDoubles");
const setsContainer = document.getElementById("setsContainer");
const addSetBtn = document.getElementById("addSetBtn");

// ─── Utility ───────────────────────────────────────────────────────────────────
function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    errorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function clearError() {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
}
function showToast(msg) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    toast.className = `fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2
        bg-slate-900 text-white text-sm font-bold px-6 py-3 rounded-full shadow-xl z-[999]
        transition-all duration-300 opacity-100`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── Members cache (populate from your communities API if needed) ───────────────
// Format: [{ uid: "firebaseUID", displayName: "Alice" }, ...]
let communityMembers = [];

async function fetchCommunityMembers() {
    try {
        const res = await fetch(`${API_BASE}/api/communities/user/${CURRENT_USER_ID}`);
        if (!res.ok) return;
        // Adjust based on your actual response shape.
        // This attempts to get members from the user's communities.
        // For now we populate with at least the logged-in user.
        communityMembers = [
            { uid: CURRENT_USER_ID, displayName: "You" },
            // Additional members would be merged here from your community member endpoint
        ];
    } catch (_) {
        communityMembers = [{ uid: CURRENT_USER_ID, displayName: "You" }];
    }
}

function buildMemberOptions(selectedUid = null) {
    const opts = communityMembers.map(
        (m) => `<option value="${m.uid}" ${m.uid === selectedUid ? "selected" : ""}>${m.displayName}</option>`
    );
    return `<option value="" disabled ${!selectedUid ? "selected" : ""}>Select member…</option>` + opts.join("");
}

// ─── Player Slots ──────────────────────────────────────────────────────────────

function playerRow(team, index) {
    const div = document.createElement("div");
    div.className = "flex items-center justify-between gap-3";
    div.dataset.team = team;
    div.dataset.index = index;

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0";
    avatarDiv.innerHTML = `<span class="material-symbols-outlined text-sm">person</span>`;

    const inputWrap = document.createElement("div");
    inputWrap.className = "flex-1";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Guest name";
    input.className = "player-input w-full bg-transparent border-none p-0 text-white text-sm focus:ring-0 focus:outline-none";
    input.addEventListener("input", (e) => {
        state.players[team][index] = { type: "guest", value: e.target.value.trim() || null };
    });

    inputWrap.appendChild(input);

    // Toggle label + switch
    const toggleWrap = document.createElement("label");
    toggleWrap.className = "flex items-center cursor-pointer gap-1.5 shrink-0";

    const toggleLabel = document.createElement("span");
    toggleLabel.className = "text-[10px] text-slate-500 uppercase font-bold member-label";
    toggleLabel.textContent = "Guest";

    const switchTrack = document.createElement("div");
    switchTrack.className = "relative w-8 h-4 bg-slate-700 rounded-full transition-colors member-switch";
    switchTrack.innerHTML = `<div class="absolute left-0.5 top-0.5 bg-slate-400 w-3 h-3 rounded-full shadow-sm member-knob transition-all"></div>`;

    toggleWrap.appendChild(toggleLabel);
    toggleWrap.appendChild(switchTrack);
    toggleWrap.addEventListener("click", (e) => {
        e.preventDefault();
        togglePlayerType(div, team, index);
    });

    div.appendChild(avatarDiv);
    div.appendChild(inputWrap);
    div.appendChild(toggleWrap);

    // Init state
    state.players[team][index] = { type: "guest", value: null };

    return div;
}

function togglePlayerType(slotEl, team, index) {
    const label = slotEl.querySelector(".member-label");
    const track = slotEl.querySelector(".member-switch");
    const knob = slotEl.querySelector(".member-knob");
    const wrap = slotEl.querySelector("div.flex-1");
    const isGuest = label.textContent === "Guest";

    if (isGuest) {
        // → Member: replace text input with select
        const select = document.createElement("select");
        select.className = "player-select w-full bg-transparent border-none p-0 text-white text-sm focus:ring-0 focus:outline-none";
        select.innerHTML = buildMemberOptions();
        select.addEventListener("change", (e) => {
            state.players[team][index] = { type: "member", value: e.target.value };
        });
        wrap.innerHTML = "";
        wrap.appendChild(select);

        label.textContent = "Member";
        track.classList.replace("bg-slate-700", "bg-orange-600");
        knob.classList.replace("left-0.5", "right-0.5");
        knob.classList.replace("bg-slate-400", "bg-white");
        state.players[team][index] = { type: "member", value: null };
    } else {
        // → Guest: replace select with text input
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Guest name";
        input.className = "player-input w-full bg-transparent border-none p-0 text-white text-sm focus:ring-0 focus:outline-none";
        input.addEventListener("input", (e) => {
            state.players[team][index] = { type: "guest", value: e.target.value.trim() || null };
        });
        wrap.innerHTML = "";
        wrap.appendChild(input);

        label.textContent = "Guest";
        track.classList.replace("bg-orange-600", "bg-slate-700");
        knob.classList.replace("right-0.5", "left-0.5");
        knob.classList.replace("bg-white", "bg-slate-400");
        state.players[team][index] = { type: "guest", value: null };
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
}

// ─── Set Scoring ───────────────────────────────────────────────────────────────

function createSetRow(setIndex) {
    const setNum = setIndex + 1;
    const row = document.createElement("div");
    row.className = "flex items-center gap-4";
    row.dataset.setIndex = setIndex;

    row.innerHTML = `
        <div class="w-10 text-slate-500 font-black text-xs shrink-0">SET ${setNum}</div>
        <div class="flex-1 flex gap-4">
            <input
                type="number" min="0" max="99" value="0"
                data-team="A"
                class="set-input w-full bg-slate-900 border border-slate-700 rounded-lg text-center
                       text-orange-500 font-display-stat text-2xl py-1
                       focus:border-orange-500 focus:ring-0 focus:outline-none transition-colors" />
            <input
                type="number" min="0" max="99" value="0"
                data-team="B"
                class="set-input w-full bg-slate-900 border border-slate-700 rounded-lg text-center
                       text-white font-display-stat text-2xl py-1
                       focus:border-orange-500 focus:ring-0 focus:outline-none transition-colors" />
        </div>
        <button type="button" class="delete-set-btn text-slate-600 hover:text-red-500 transition-colors shrink-0">
            <span class="material-symbols-outlined text-sm">delete</span>
        </button>
    `;

    // Sync inputs → state
    row.querySelectorAll(".set-input").forEach((inp) => {
        inp.addEventListener("input", () => syncSetState());
        inp.addEventListener("change", () => syncSetState());
    });

    // Delete set
    row.querySelector(".delete-set-btn").addEventListener("click", () => {
        if (setsContainer.children.length <= 1) {
            showError("You need at least one set.");
            return;
        }
        row.remove();
        renumberSetRows();
        syncSetState();
    });

    return row;
}

function renumberSetRows() {
    Array.from(setsContainer.children).forEach((row, i) => {
        row.dataset.setIndex = i;
        const label = row.querySelector("div.w-10");
        if (label) label.textContent = `SET ${i + 1}`;
    });
}

function syncSetState() {
    state.sets = Array.from(setsContainer.children).map((row) => {
        const inputs = row.querySelectorAll(".set-input");
        return {
            scoreA: parseInt(inputs[0]?.value, 10) || 0,
            scoreB: parseInt(inputs[1]?.value, 10) || 0,
        };
    });
}

function renderSets() {
    setsContainer.innerHTML = "";
    state.sets.forEach((_, i) => setsContainer.appendChild(createSetRow(i)));
}

// Pre-fill existing set values (used when re-opening modal)
function hydrateSetInputs() {
    Array.from(setsContainer.children).forEach((row, i) => {
        const inputs = row.querySelectorAll(".set-input");
        if (state.sets[i]) {
            inputs[0].value = state.sets[i].scoreA;
            inputs[1].value = state.sets[i].scoreB;
        }
    });
}

// ─── Payload builder ───────────────────────────────────────────────────────────

function computeSetsWon() {
    let winsA = 0, winsB = 0;
    state.sets.forEach(({ scoreA, scoreB }) => {
        if (scoreA > scoreB) winsA++;
        else if (scoreB > scoreA) winsB++;
    });
    return { winsA, winsB };
}

function buildPayload() {
    const location = document.getElementById("matchLocation").value.trim();
    const communityId = null; // extend later with a community selector

    // ── Validate location ──
    if (!location) throw new Error("Please enter a match location.");

    // ── Validate & build participants ──
    const slots = state.isDoubles ? [0, 1] : [0];
    const participants = [];
    const { winsA, winsB } = computeSetsWon();

    // Need at least one set with a winner
    if (winsA === 0 && winsB === 0) {
        throw new Error("No sets have been won yet. Enter point scores for each set.");
    }
    if (winsA === winsB) {
        throw new Error("Sets are tied — a final deciding set must determine a winner.");
    }

    for (const team of ["A", "B"]) {
        const setsWon = team === "A" ? winsA : winsB;
        const isWinner = team === "A" ? winsA > winsB : winsB > winsA;

        for (const idx of slots) {
            const player = state.players[team][idx];
            if (!player || !player.value) {
                throw new Error(
                    `Team ${team} Player ${idx + 1} is empty. Fill in a guest name or select a member.`
                );
            }

            if (player.type === "member") {
                participants.push({
                    user_id: player.value,
                    guest_name: null,
                    team_identifier: team,
                    score: setsWon,
                    is_winner: isWinner,
                });
            } else {
                participants.push({
                    user_id: null,
                    guest_name: player.value,
                    team_identifier: team,
                    score: setsWon,
                    is_winner: isWinner,
                });
            }
        }
    }

    // ── Validate sets ──
    syncSetState();
    if (state.sets.length === 0) throw new Error("Add at least one set.");

    const sets = state.sets.map((s, i) => {
        if (s.scoreA === s.scoreB) {
            throw new Error(`Set ${i + 1} is tied (${s.scoreA}-${s.scoreB}). Sets can't end in a draw.`);
        }
        return {
            set_number: i + 1,
            score_team_a: s.scoreA,
            score_team_b: s.scoreB,
        };
    });

    return {
        sport_type_id: state.sportTypeId,
        community_id: communityId,
        location,
        participants,
        sets,
    };
}

// ─── Submit ────────────────────────────────────────────────────────────────────

async function submitMatch() {
    clearError();
    syncSetState();

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
        if (!res.ok) throw new Error(data.error ?? "Server error");

        closeModal();
        showToast(`Match #${data.match_id} saved! 🎉`);
        resetState();

    } catch (err) {
        showError(err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            <span class="material-symbols-outlined text-base">check_circle</span>
            Save Match Result`;
    }
}

// ─── Reset ─────────────────────────────────────────────────────────────────────

function resetState() {
    state.sportTypeId = 1;
    state.isDoubles = false;
    state.players = {
        A: [{ type: "guest", value: null }, { type: "guest", value: null }],
        B: [{ type: "guest", value: null }, { type: "guest", value: null }],
    };
    state.sets = [{ scoreA: 0, scoreB: 0 }, { scoreA: 0, scoreB: 0 }];

    document.getElementById("matchLocation").value = "";

    // Reset sport buttons
    document.querySelectorAll(".sport-btn").forEach((b, i) => {
        const active = i === 0;
        b.classList.toggle("bg-orange-600", active);
        b.classList.toggle("text-white", active);
        b.classList.toggle("border-orange-500", active);
        b.classList.toggle("bg-slate-800", !active);
        b.classList.toggle("text-slate-300", !active);
        b.classList.toggle("border-slate-700", !active);
    });

    // Reset format buttons to Singles
    setFormat(false);
}

// ─── Modal open / close ────────────────────────────────────────────────────────

function openModal() {
    clearError();
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
}
function closeModal() {
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
}

// ─── Format toggle ─────────────────────────────────────────────────────────────

function setFormat(isDoubles) {
    state.isDoubles = isDoubles;

    fmtSingles.className = `fmt-btn px-4 py-2 rounded-xl font-label-bold transition-all border flex-1 ${!isDoubles
            ? "bg-orange-600 text-white border-orange-500 shadow-lg shadow-orange-900/20"
            : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
        }`;
    fmtDoubles.className = `fmt-btn px-4 py-2 rounded-xl font-label-bold transition-all border flex-1 ${isDoubles
            ? "bg-orange-600 text-white border-orange-500 shadow-lg shadow-orange-900/20"
            : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
        }`;

    renderPlayers();
}

// ─── Event wiring ──────────────────────────────────────────────────────────────

openBtn?.addEventListener("click", openModal);
closeBtn?.addEventListener("click", closeModal);
discardBtn?.addEventListener("click", closeModal);
backdrop?.addEventListener("click", closeModal);
submitBtn?.addEventListener("click", submitMatch);

// Format
fmtSingles?.addEventListener("click", () => setFormat(false));
fmtDoubles?.addEventListener("click", () => setFormat(true));

// Sport selector (event delegation)
document.getElementById("sportSelector")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".sport-btn");
    if (!btn) return;
    state.sportTypeId = Number(btn.dataset.sportId);
    document.querySelectorAll(".sport-btn").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("bg-orange-600", active);
        b.classList.toggle("text-white", active);
        b.classList.toggle("border-orange-500", active);
        b.classList.toggle("bg-slate-800", !active);
        b.classList.toggle("text-slate-300", !active);
        b.classList.toggle("border-slate-700", !active);
    });
});

// Add set
addSetBtn?.addEventListener("click", () => {
    if (setsContainer.children.length >= 7) {
        showError("Maximum 7 sets allowed.");
        return;
    }
    const newIndex = setsContainer.children.length;
    state.sets.push({ scoreA: 0, scoreB: 0 });
    setsContainer.appendChild(createSetRow(newIndex));
});

// ─── Init ──────────────────────────────────────────────────────────────────────

(async () => {
    await fetchCommunityMembers();
    renderPlayers();
    renderSets();
    setFormat(false); // start in Singles
})();