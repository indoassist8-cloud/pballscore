import { auth, googleProvider } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    RecaptchaVerifier,
    signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

// Helper function to show errors in the UI
let errorTimer; // Variable to keep track of the active timer

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    clearTimeout(errorTimer);

    if (message) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('error-hidden'); // Show it
        errorDiv.hidden = false;

        errorTimer = setTimeout(() => {
            errorDiv.classList.add('error-hidden'); // Start the fade

            // Wait for the CSS animation (0.5s) to finish before actually hiding the element
            setTimeout(() => { errorDiv.hidden = true; }, 500);
        }, 5000);

    } else {
        errorDiv.hidden = true;
    }
}

// --- 1. GOOGLE AUTHENTICATION ---
export async function loginWithGoogle() {
    showError(null); // Clear old errors
    try {
        const result = await signInWithPopup(auth, googleProvider);
        console.log("Logged in as:", result.user.displayName);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Google Login Error:", error.message);
        showError("Google login failed. Please try again.");

    }
}

// --- 2. EMAIL/PASSWORD AUTHENTICATION ---
export async function loginWithEmail(email, password) {
    showError(null); // Clear old errors
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Email Login Error:", error.message);
        showError("Invalid email or password.");
    }
}

// --- 3. PHONE AUTHENTICATION ---
// Initialize reCAPTCHA (Invisible)
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'login-button', {
    'size': 'invisible',
    'callback': (response) => { /* reCAPTCHA solved */ }
});

export async function sendOTP(phoneNumber) {
    showError(null); // Clear old errors
    try {
        const appVerifier = window.recaptchaVerifier;
        const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
        window.confirmationResult = confirmationResult;
        showError("OTP Sent!");
        // Show your OTP input field here
    } catch (error) {
        console.error("SMS Error:", error.message);
        showError("Failed to send SMS. Check your number format (e.g., +62812...)");
    }
}

export async function verifyOTP(code) {
    showError(null); // Clear old errors
    try {
        await window.confirmationResult.confirm(code);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("OTP Error:", error.message);
        showError("Invalid OTP code.");
    }
}

// Make functions globally accessible for simple HTML onclicks
window.loginWithGoogle = loginWithGoogle;
window.sendOTP = sendOTP;
window.verifyOTP = verifyOTP;