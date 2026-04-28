import { auth, signOut } from './fbauth-sc.js';

// Logout functionality
document.getElementById('logout').addEventListener('click', (e) => {
    e.preventDefault();
    closeProfileDropdown();
    signOut(auth);
});

const settingsBtn = document.getElementById('settingsBtn');
const profileDropdown = document.getElementById('profileDropdown');

// Toggle dropdown on click
settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent immediate closing
    profileDropdown.classList.toggle('hidden');
});

// Close when clicking outside
window.addEventListener('click', () => {
    if (!profileDropdown.classList.contains('hidden')) {
        profileDropdown.classList.add('hidden');
    }
});

// Helper to close manually from links
function toggleDropdown() {
    profileDropdown.classList.add('hidden');
}