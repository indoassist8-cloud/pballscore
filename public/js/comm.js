// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — adjust to match your backend
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = "https://api.mitrado.net/api";

// TODO: replace with real auth (e.g. read from Firebase JWT / localStorage)
const CURRENT_USER_ID = localStorage.getItem('loggedInUserId');

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let activeTab = "my"; // "my" | "all"
let communities = [];

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const grid = document.getElementById("communityGrid");
const loadingState = document.getElementById("loadingState");
const emptyState = document.getElementById("emptyState");

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load & render
// ─────────────────────────────────────────────────────────────────────────────
async function loadCommunities() {
    showLoading();
    try {
        const endpoint = activeTab === "my"
            ? `/communities/user/${CURRENT_USER_ID}`
            : "/communities";
        communities = await apiFetch(endpoint);
        renderGrid(communities);
    } catch (e) {
        showEmpty();
        console.error(e);
    }
}

function renderGrid(list) {
    if (!list || list.length === 0) { showEmpty(); return; }

    grid.innerHTML = list.map(c => `
        <div class="community-card bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-3 fade-in" data-id="${c.id}">
            <!-- Header row -->
            <div class="flex items-start justify-between gap-2">
                <div class="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-orange-600">groups</span>
                </div>
                <div class="flex-1 min-w-0">
                    <h4 class="font-black text-slate-900 text-base leading-tight truncate">${escHtml(c.name)}</h4>
                    <p class="text-xs text-slate-400 mt-0.5">${formatDate(c.created_at)}</p>
                </div>
                ${c.user_role ? `<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${c.user_role === 'admin' ? 'badge-admin' : 'badge-member'}">${c.user_role}</span>` : ''}
            </div>

            <!-- Description -->
            <p class="text-sm text-slate-500 leading-relaxed line-clamp-2 flex-1">${c.description ? escHtml(c.description) : '<span class="italic opacity-60">No description</span>'}</p>

            <!-- Stats row -->
            <div class="flex items-center gap-3 text-xs text-slate-500">
                <span class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-sm">person</span>
                    ${c.member_count ?? '—'} member${c.member_count !== 1 ? 's' : ''}
                </span>
                <button class="btn-copy-invite ml-auto flex items-center gap-1 text-orange-500 hover:text-orange-700 font-semibold transition-colors" data-code="${escHtml(c.invite_code)}" title="Copy invite code">
                    <span class="material-symbols-outlined text-sm">content_copy</span>
                    ${c.invite_code}
                </button>
            </div>

            <!-- Action buttons — shown for admins/creators -->
            ${(c.user_role === 'admin' || c.creator_id === CURRENT_USER_ID) ? `
            <div class="flex gap-2 pt-1 border-t border-slate-100">
                <button class="btn-edit flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-all"
                    data-id="${c.id}" data-name="${escHtml(c.name)}" data-desc="${escHtml(c.description || '')}">
                    <span class="material-symbols-outlined text-sm">edit</span> Edit
                </button>
                <button class="btn-delete flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    data-id="${c.id}">
                    <span class="material-symbols-outlined text-sm">delete</span> Delete
                </button>
            </div>` : (activeTab === 'all' ? `
            <div class="pt-1 border-t border-slate-100">
                <button class="btn-join-code w-full py-1.5 text-xs font-bold text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                    data-code="${escHtml(c.invite_code)}">
                    Join this community
                </button>
            </div>` : `
            <div class="pt-1 border-t border-slate-100">
                <button class="btn-leave w-full py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-lg transition-all"
                    data-id="${c.id}">
                    Leave community
                </button>
            </div>`)}
        </div>
    `).join("");

    grid.classList.remove("hidden");
    loadingState.classList.add("hidden");
    emptyState.classList.add("hidden");
    bindCardActions();
}

function bindCardActions() {
    document.querySelectorAll(".btn-copy-invite").forEach(btn => {
        btn.addEventListener("click", () => copyInvite(btn.dataset.code));
    });
    document.querySelectorAll(".btn-edit").forEach(btn => {
        btn.addEventListener("click", () => openEditModal(btn.dataset.id, btn.dataset.name, btn.dataset.desc));
    });
    document.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => openDeleteModal(btn.dataset.id));
    });
    document.querySelectorAll(".btn-join-code").forEach(btn => {
        btn.addEventListener("click", () => {
            document.getElementById("joinCode").value = btn.dataset.code;
            openModal("joinModal");
        });
    });
    document.querySelectorAll(".btn-leave").forEach(btn => {
        btn.addEventListener("click", () => leaveCommunity(btn.dataset.id));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI state helpers
// ─────────────────────────────────────────────────────────────────────────────
function showLoading() {
    loadingState.classList.remove("hidden");
    grid.classList.add("hidden");
    emptyState.classList.add("hidden");
}
function showEmpty() {
    emptyState.classList.remove("hidden");
    grid.classList.add("hidden");
    loadingState.classList.add("hidden");
}
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }
function setError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.toggle("hidden", !msg);
}
function showToast(msg) {
    const toast = document.getElementById("inviteToast");
    document.getElementById("inviteToastMsg").textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2500);
}
function escHtml(str) {
    return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD actions
// ─────────────────────────────────────────────────────────────────────────────
async function createCommunity() {
    const name = document.getElementById("createName").value.trim();
    const desc = document.getElementById("createDesc").value.trim();
    setError("createError", "");
    if (!name) { setError("createError", "Community name is required."); return; }

    const btn = document.getElementById("createSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Creating…";
    try {
        await apiFetch("/communities", {
            method: "POST",
            body: JSON.stringify({ name, description: desc, creator_id: CURRENT_USER_ID }),
        });
        closeModal("createModal");
        document.getElementById("createName").value = "";
        document.getElementById("createDesc").value = "";
        showToast("Community created! 🎉");
        loadCommunities();
    } catch (e) {
        setError("createError", e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-base">add_circle</span> Create Community';
    }
}

function openEditModal(id, name, desc) {
    document.getElementById("editId").value = id;
    document.getElementById("editName").value = name;
    document.getElementById("editDesc").value = desc;
    setError("editError", "");
    openModal("editModal");
}

async function updateCommunity() {
    const id = document.getElementById("editId").value;
    const name = document.getElementById("editName").value.trim();
    const desc = document.getElementById("editDesc").value.trim();
    setError("editError", "");
    if (!name) { setError("editError", "Name is required."); return; }

    const btn = document.getElementById("editSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
        await apiFetch(`/communities/${id}`, {
            method: "PUT",
            body: JSON.stringify({ name, description: desc }),
        });
        closeModal("editModal");
        showToast("Community updated ✓");
        loadCommunities();
    } catch (e) {
        setError("editError", e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-base">save</span> Save Changes';
    }
}

function openDeleteModal(id) {
    document.getElementById("deleteId").value = id;
    openModal("deleteModal");
}

async function deleteCommunity() {
    const id = document.getElementById("deleteId").value;
    try {
        await apiFetch(`/communities/${id}`, { method: "DELETE" });
        closeModal("deleteModal");
        showToast("Community deleted.");
        loadCommunities();
    } catch (e) {
        closeModal("deleteModal");
        showToast("Delete failed: " + e.message);
    }
}

async function joinCommunity() {
    const code = document.getElementById("joinCode").value.trim().toUpperCase();
    setError("joinError", "");
    document.getElementById("joinSuccess").classList.add("hidden");
    if (!code) { setError("joinError", "Please enter an invite code."); return; }

    const btn = document.getElementById("joinSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Joining…";
    try {
        await apiFetch("/communities/join", {
            method: "POST",
            body: JSON.stringify({ user_id: CURRENT_USER_ID, invite_code: code }),
        });
        const suc = document.getElementById("joinSuccess");
        suc.textContent = "You've joined! Welcome 🎉";
        suc.classList.remove("hidden");
        document.getElementById("joinCode").value = "";
        setTimeout(() => { closeModal("joinModal"); loadCommunities(); }, 1200);
    } catch (e) {
        setError("joinError", e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-base">login</span> Join Community';
    }
}

async function leaveCommunity(id) {
    if (!confirm("Leave this community?")) return;
    try {
        await apiFetch(`/communities/${id}/leave?user_id=${CURRENT_USER_ID}`, { method: "DELETE" });
        showToast("You've left the community.");
        loadCommunities();
    } catch (e) {
        showToast("Error: " + e.message);
    }
}

function copyInvite(code) {
    navigator.clipboard.writeText(code).then(() => showToast(`Copied: ${code}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Event wiring
// ─────────────────────────────────────────────────────────────────────────────

// Tabs
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("tab-active"));
        btn.classList.add("tab-active");
        activeTab = btn.dataset.tab;
        loadCommunities();
    });
});

// Create modal
document.getElementById("btnCreateOpen").addEventListener("click", () => openModal("createModal"));
document.getElementById("btnCreateClose").addEventListener("click", () => closeModal("createModal"));
document.getElementById("createSubmitBtn").addEventListener("click", createCommunity);

// Edit modal
document.getElementById("btnEditClose").addEventListener("click", () => closeModal("editModal"));
document.getElementById("editSubmitBtn").addEventListener("click", updateCommunity);

// Join modal
document.getElementById("btnJoinOpen").addEventListener("click", () => openModal("joinModal"));
document.getElementById("btnJoinClose").addEventListener("click", () => closeModal("joinModal"));
document.getElementById("joinSubmitBtn").addEventListener("click", joinCommunity);

// Delete modal
document.getElementById("btnDeleteCancel").addEventListener("click", () => closeModal("deleteModal"));
document.getElementById("btnDeleteConfirm").addEventListener("click", deleteCommunity);

// Close modals on backdrop click
["createModal", "editModal", "joinModal", "deleteModal"].forEach(id => {
    document.getElementById(id).addEventListener("click", e => {
        if (e.target.id === id) closeModal(id);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
loadCommunities();