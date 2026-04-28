import { auth, signOut } from './fbauth-sc.js';

const signOutBtn = document.getElementById('signOutBtn');

if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
        signOut(auth)
            .then(() => {
                // Sign-out successful.
                console.log("User signed out successfully.");

                // Redirect to login page
                window.location.href = "login.html";
            })
            .catch((error) => {
                // An error happened.
                console.error("Sign out error:", error.message);
                alert("Error signing out. Please try again.");
            });
    });
}