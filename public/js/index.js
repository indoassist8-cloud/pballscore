import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

const auth = getAuth();
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