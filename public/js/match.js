// ─────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────
const API_BASE = "https://api.mitrado.net/api";
const CURRENT_USER_ID = localStorage.getItem("loggedInUserId");

// ─────────────────────────────────────────────────────────────────
// SPORT META
// ─────────────────────────────────────────────────────────────────
const SPORT_EMOJI = { Pickleball: "🏓", Padel: "🎾", Badminton: "🏸" };

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
        + " • "
        + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function playerName(p) {
    // p has either username (registered) or guest_name (guest)
    if (p.username) return { name: p.username, isGuest: false };
    if (p.guest_name) return { name: p.guest_name, isGuest: true };
    return { name: "Unknown", isGuest: false };
}

function guestBadge() {
    return `<span class="px-2 py-0.5 bg-slate-100 text-slate-500 font-label-bold text-[10px] rounded uppercase">Guest</span>`;
}

// ─────────────────────────────────────────────────────────────────
// BUILD ONE MATCH CARD  (mirrors the pasted div structure exactly)
// ─────────────────────────────────────────────────────────────────
function buildMatchCard(match) {
    const teamA = match.teams?.A ?? [];
    const teamB = match.teams?.B ?? [];
    const winner = match.winner; // "A" or "B"
    // ── Determine which team the current user is on ──────────────
    const userInA = teamA.some(p => p.user_id === CURRENT_USER_ID);
    const userInB = teamB.some(p => p.user_id === CURRENT_USER_ID);
    // If neither (all-guest match recorded by user), treat Team A as "our" side
    const myTeam = userInA ? "A" : userInB ? "B" : "A";
    const isWin = winner === myTeam;
    const sets = match.sets ?? [];
    const emoji = SPORT_EMOJI[match.sport_type] ?? "🏆";

    // ── ribbon color
    const ribbonClass = isWin ? "bg-orange-600" : "bg-slate-200";

    // ── status badge
    const statusBadge = isWin
        ? `<span class="px-3 py-1 bg-orange-100 text-orange-700 font-label-bold text-[10px] uppercase rounded-full tracking-widest">Victory</span>`
        : `<span class="px-3 py-1 bg-slate-100 text-slate-500 font-label-bold text-[10px] uppercase rounded-full tracking-widest">Defeat</span>`;

    // ── sport icon opacity for loss
    const iconClass = isWin
        ? "w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-4xl shadow-inner"
        : "w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-4xl grayscale opacity-70";

    // ── sets score (e.g. 2 - 0)
    const setsWonA = teamA[0]?.score ?? 0;
    const setsWonB = teamB[0]?.score ?? 0;
    const scoreColor = isWin ? "text-orange-600" : "text-slate-400";

    // ── set pills
    const setPills = sets.map((s, i) => {
        // highlight the set won by the winner
        const aWonSet = s.score_team_a > s.score_team_b;
        const highlight = (isWin && aWonSet) || (!isWin && !aWonSet);
        const pillClass = highlight
            ? "px-3 py-1 bg-slate-900 text-white font-label-bold text-xs rounded-lg"
            : "px-3 py-1 bg-slate-200 text-slate-600 font-label-bold text-xs rounded-lg";
        return `<span class="${pillClass}">S${s.set_number}: ${s.score_team_a}-${s.score_team_b}</span>`;
    }).join("");

    // ── team A players HTML
    const teamAPlayersHtml = teamA.map((p, i) => {
        const { name, isGuest } = playerName(p);
        const nameClass = isWin ? "text-slate-900" : "text-slate-400";
        if (i === 0) {
            // first player is headline
            return `<div class="font-headline-md ${nameClass} mb-1">${name}${isGuest ? " " + guestBadge() : ""}</div>`;
        }
        // doubles second player
        return `<div class="flex md:justify-end items-center gap-2">
            <span class="${nameClass} font-body-md">${name}</span>
            ${isGuest ? guestBadge() : ""}
        </div>`;
    }).join("") || `<div class="font-headline-md text-slate-400 mb-1">—</div>`;

    // ── team B players HTML
    const teamBWinner = winner === "B";
    const teamBPlayersHtml = teamB.map((p, i) => {
        const { name, isGuest } = playerName(p);
        const nameClass = teamBWinner ? "text-slate-900" : "text-slate-400";
        if (i === 0) {
            return `<div class="font-headline-md ${nameClass} mb-1">${name}${isGuest ? " " + guestBadge() : ""}</div>`;
        }
        return `<div class="flex md:justify-start items-center gap-2">
            <span class="${nameClass} font-body-md">${name}</span>
            ${isGuest ? guestBadge() : ""}
        </div>`;
    }).join("") || `<div class="font-headline-md text-slate-400 mb-1">—</div>`;

    // ── winner label under Team B if B won
    const teamBWinnerLabel = teamBWinner
        ? `<div class="flex md:justify-start items-center gap-2 text-orange-600 font-label-bold text-sm mt-1">
               <span>Winner</span>
               <span class="material-symbols-outlined text-sm">verified</span>
           </div>`
        : "";

    // ── meta icons color
    const metaIconColor = isWin ? "text-orange-600" : "text-slate-400";

    // ── community tag (if present)
    const communityTag = match.community_id
        ? `<span class="px-3 py-1 bg-slate-100 text-slate-600 font-label-bold text-[10px] rounded-full uppercase">${match.community_name ?? "Community"}</span>`
        : "";

    return `
    <div class="bg-white rounded-2xl overflow-hidden shadow-xl border border-slate-200 flex flex-col md:flex-row transition-transform hover:translate-y-[-4px]" data-match-id="${match.match_id}">
        <!-- Ribbon -->
        <div class="${ribbonClass} md:w-3 flex items-center justify-center">
            <div class="hidden md:block w-full h-full ${ribbonClass}"></div>
        </div>

        <div class="flex-1 p-6 md:p-8 flex flex-col md:flex-row items-center gap-8">

            <!-- Sport Icon & Status -->
            <div class="flex flex-col items-center gap-2">
                <div class="${iconClass}">${emoji}</div>
                ${statusBadge}
            </div>

            <!-- Match Detail -->
            <div class="flex-1 grid grid-cols-1 md:grid-cols-3 gap-8 items-center w-full">

                <!-- Team A -->
                <div class="text-center md:text-right">
                    ${teamAPlayersHtml}
                </div>

                <!-- Score Center -->
                <div class="flex flex-col items-center">
                    <div class="font-display-stat ${scoreColor} text-5xl mb-2 italic">${setsWonA} - ${setsWonB}</div>
                    <div class="flex gap-2 flex-wrap justify-center">${setPills}</div>
                </div>

                <!-- Team B -->
                <div class="text-center md:text-left">
                    ${teamBPlayersHtml}
                    ${teamBWinnerLabel}
                </div>

            </div>

            <!-- Meta Info -->
            <div class="border-t md:border-t-0 md:border-l border-slate-100 pt-6 md:pt-0 md:pl-8 flex flex-col gap-3 min-w-[200px]">
                <div class="flex items-center gap-2 text-slate-500">
                    <span class="material-symbols-outlined ${metaIconColor} text-lg">location_on</span>
                    <span class="font-body-md">${match.location || "—"}</span>
                </div>
                <div class="flex items-center gap-2 text-slate-500">
                    <span class="material-symbols-outlined ${metaIconColor} text-lg">calendar_today</span>
                    <span class="font-body-md">${formatDate(match.match_date)}</span>
                </div>
                ${communityTag ? `<div class="mt-2">${communityTag}</div>` : ""}
            </div>

        </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
// RENDER LIST
// ─────────────────────────────────────────────────────────────────
function renderMatches(matches, containerId = "matchList") {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!matches || matches.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center py-20 text-slate-400">
                <span class="material-symbols-outlined text-5xl mb-3">sports_tennis</span>
                <p class="font-semibold">No matches yet</p>
                <p class="text-sm mt-1">Record your first match using the + button.</p>
            </div>`;
        return;
    }

    container.innerHTML = `<div class="space-y-6">${matches.map(buildMatchCard).join("")}</div>`;
}

// ─────────────────────────────────────────────────────────────────
// FETCH FROM BACKEND
// ─────────────────────────────────────────────────────────────────
async function loadMatches(filter = "all") {
    const container = document.getElementById("matchList");
    if (container) {
        container.innerHTML = `
            <div class="flex justify-center items-center py-16">
                <div class="spinner"></div>
            </div>`;
    }

    try {
        // GET /api/matches?user_id=xxx&limit=20
        const res = await fetch(`${API_BASE}/matches?user_id=${CURRENT_USER_ID}&limit=20`, {
            headers: { "Content-Type": "application/json" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let matches = await res.json();

        // For each match summary we need full detail (sets + players)
        // Fetch full detail in parallel
        /*ori from claude - remark to use the new func shared by gemini 
        matches = await Promise.all(
            matches.map(async (summary) => {
                const detailRes = await fetch(`${API_BASE}/matches/${summary.match_id}`, {
                    headers: { "Content-Type": "application/json" }
                });
                if (!detailRes.ok) return summary; // fallback to summary if detail fails
                return await detailRes.json();
            })
        );
        */

        // Apply filter tab
        if (filter === "wins") {
            matches = matches.filter(m => m.winner === "A"); // adjust if your API returns user's team
        } else if (filter === "losses") {
            matches = matches.filter(m => m.winner === "B");
        }

        renderMatches(matches);
    } catch (err) {
        console.error("Failed to load matches:", err);
        if (container) {
            container.innerHTML = `
                <div class="flex flex-col items-center py-16 text-slate-400">
                    <span class="material-symbols-outlined text-4xl mb-2">wifi_off</span>
                    <p class="text-sm">Failed to load matches. Please try again.</p>
                </div>`;
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// FILTER TABS  (call this once DOM is ready)
// ─────────────────────────────────────────────────────────────────
function initMatchFilters() {
    document.querySelectorAll(".match-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".match-filter-btn").forEach(b => {
                b.classList.remove("tab-active");
            });
            btn.classList.add("tab-active");
            loadMatches(btn.dataset.filter);
        });
    });
}

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initMatchFilters();
    loadMatches("all");
});