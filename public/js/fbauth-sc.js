import { auth } from './fbauth.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

/**
 * This function protects the page. 
 * It hides the body by default to prevent "flickering" 
 * and only shows it if the user is authenticated.
 */
export function protectPage() {
    // 1. Hide the body immediately so unauthorized users don't see content
    document.body.style.opacity = '0';

    onAuthStateChanged(auth, (user) => {
        if (user) {
            // USER IS LOGGED IN
            console.log("Authenticated:", user.email || user.phoneNumber);

            // Show the page content
            document.body.style.transition = 'opacity 0.4s';
            document.body.style.opacity = '1';
        } else {
            // USER IS NOT LOGGED IN
            console.warn("Unauthorized access. Redirecting to login...");
            window.location.href = 'login.html';
        }
    });
}

window.handleLogout = async () => {
    try {
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
};

// Auto-run when imported
protectPage();