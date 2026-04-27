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
/*export async function loginWithGoogle() {
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
*/
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


async function handleGoogleAuth(msgDivId) {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    const db = getFirestore();

    signInWithPopup(auth, provider)
        .then(async (result) => {
            const user = result.user;

            // Extract name from Google profile
            const displayName = user.displayName || '';
            const nameParts = displayName.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            // Save user data to Firestore
            const userData = {
                email: user.email,
                firstName: firstName,
                lastName: lastName,
                displayName: displayName,
                photoURL: user.photoURL || '',
                provider: 'google'
            };

            const docRef = doc(db, "users", user.uid);
            await setDoc(docRef, userData, { merge: true });

            // --- DIFFERENTIATION BASED ON msgDivId ---
            // If the ID passed is 'signup-msg', we trigger the Go backend
            if (msgDivId === 'signup-msg') {
                try {
                    await fetch(`${GO_SERVER_URL}/register`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            FirebaseUID: user.uid,
                            Email: user.email,
                            FirstName: firstName,
                            LastName: lastName
                        }),
                    });
                    console.log("Signup detected via msgDivId: Plan initialized in Go.");
                } catch (err) {
                    console.error('Go backend error:', err);
                }
            }
            // -----------------------------------------

            showMsg('Successfully signed in with Google!', msgDivId, true);
            localStorage.setItem('loggedInUserId', user.uid);
            localStorage.setItem("loginTime", Date.now()); // add for session timeout

            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
        })
        .catch((error) => {
            console.error('Google sign in error:', error);
            showMsg('Failed to sign in with Google. Please try again.', msgDivId);
        });
}


// Google Sign In (login form)
const btnGoogleLogin = document.getElementById('google-btn');
btnGoogleLogin.addEventListener('click', (event) => {
    event.preventDefault();
    handleGoogleAuth('login-msg');
});

// Google Sign Up (register form)
const btnGoogleSignup = document.getElementById('google-signup-btn');
btnGoogleSignup.addEventListener('click', (event) => {
    event.preventDefault();
    handleGoogleAuth('signup-msg');
});

// Sign Up Form
const signupForm = document.querySelector('#signup-form');
signupForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Get user data
    const firstName = document.getElementById('signup-firstname').value.trim();
    const lastName = document.getElementById('signup-lastname').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pwd = document.getElementById('signup-password').value;

    // Validation
    if (!firstName || !lastName) {
        showMsg('Please enter your first and last name.', 'signup-msg');
        return;
    }

    if (pwd.length < 6) {
        showMsg('Password must be at least 6 characters long.', 'signup-msg');
        return;
    }

    const auth = getAuth();
    const db = getFirestore();

    // Disable button to prevent double submission
    const submitBtn = signupForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    createUserWithEmailAndPassword(auth, email, pwd)
        .then(async (userCredential) => {
            const user = userCredential.user;

            // Prepare user data
            const userData = {
                email: email,
                firstName: firstName,
                lastName: lastName,
                displayName: `${firstName} ${lastName}`,
                provider: 'email',
                createdAt: new Date().toISOString()
            };

            // Save to Firestore
            const docRef = doc(db, "users", user.uid);
            await setDoc(docRef, userData);

            // Send verification email
            await sendEmailVerification(user);

            showMsg('Account created successfully! Please check your email for verification.', 'signup-msg', true);

            // Clear form
            signupForm.reset();

            // Redirect to login after 2 seconds
            setTimeout(() => {
                showForm('login-form');
            }, 2000);
        })
        .catch((error) => {
            const errorCode = error.code;
            console.log("DEBUG ERROR:", error.code, error.message);
            let errorMessage = 'Unable to create account. Please try again.';

            if (errorCode === 'auth/email-already-in-use') {
                errorMessage = 'This email is already registered. Please sign in instead.';
            } else if (errorCode === 'auth/invalid-email') {
                errorMessage = 'Please enter a valid email address.';
            } else if (errorCode === 'auth/weak-password') {
                errorMessage = 'Password is too weak. Please use a stronger password.';
            }
            showMsg(errorMessage, 'signup-msg');
            // If you see 'permission-denied', it's your Firestore write failing, not the Auth.
        })

        .finally(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create account';
        });
});

// Make functions globally accessible for simple HTML onclicks
window.loginWithGoogle = loginWithGoogle;
window.sendOTP = sendOTP;
window.verifyOTP = verifyOTP;