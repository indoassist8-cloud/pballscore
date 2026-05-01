import { auth, googleProvider } from './fbauth.js';
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    RecaptchaVerifier,
    createUserWithEmailAndPassword,
    sendEmailVerification,
    sendPasswordResetEmail,
    signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { getFirestore, setDoc, doc } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

// Helper function to show errors in the UI
let errorTimer; // Variable to keep track of the active timer


const GO_SERVER_URL = "https://pball-score.web.app"; // need to change this if we link to a new domain

function showMsg(msg, divId, isSuccess = false) {
    const msgDiv = document.getElementById(divId);
    if (!msgDiv) return;

    if (!msg) {
        msgDiv.classList.add('hidden');
        return;
    }

    // 1. Reset and Show
    msgDiv.innerHTML = msg;
    msgDiv.classList.remove('hidden', 'bg-red-100', 'text-red-700', 'bg-green-100', 'text-green-700');
    msgDiv.style.opacity = "1";
    msgDiv.classList.add('block', 'p-3', 'rounded-lg', 'text-sm', 'mb-4', 'transition-opacity', 'duration-300');

    // 2. Apply Success or Error colors
    if (isSuccess) {
        msgDiv.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-400');
    } else {
        msgDiv.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-400');
    }

    // 3. Auto-hide after 5 seconds
    setTimeout(() => {
        msgDiv.style.opacity = "0";
        setTimeout(() => {
            msgDiv.classList.add('hidden');
        }, 300);
    }, 5000);
}

function clearAllMessages() {
    const boxes = document.querySelectorAll('.msg-box');
    boxes.forEach(box => {
        box.style.display = 'none';
        box.innerHTML = '';
    });
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
    clearAllMessages(); // Clear old errors
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("Email Login Error:", error.message);
        showMsg("Invalid email or password.");
    }
}

// --- 3. PHONE AUTHENTICATION ---
// Initialize reCAPTCHA (Invisible)
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'login-button', {
    'size': 'invisible',
    'callback': (response) => { /* reCAPTCHA solved */ }
});

export async function sendOTP(phoneNumber) {
    clearAllMessages(); // Clear old errors
    try {
        const appVerifier = window.recaptchaVerifier;
        const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
        window.confirmationResult = confirmationResult;
        showMsg("OTP Sent!");
        // Show your OTP input field here
    } catch (error) {
        console.error("SMS Error:", error.message);
        showMsg("Failed to send SMS. Check your number format (e.g., +62812...)");
    }
}

export async function verifyOTP(code) {
    clearAllMessages(); // Clear old errors
    try {
        await window.confirmationResult.confirm(code);
        window.location.href = 'index.html';
    } catch (error) {
        console.error("OTP Error:", error.message);
        showMsg("Invalid OTP code.");
    }
}


async function handleGoogleAuth(msgDivId) {
    clearAllMessages(); // Clear old errors
    const db = getFirestore();

    signInWithPopup(auth, googleProvider)
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
                fullName: displayName,
                photoURL: user.photoURL || '',
                provider: 'google'
            };

            const docRef = doc(db, "users", user.uid);
            await setDoc(docRef, userData, { merge: true });

            // --- DIFFERENTIATION BASED ON msgDivId ---
            // If the ID passed is 'signup-msg', we trigger the Go backend

            // sign up via google auth - only store firebaseid, email, fullname. 
            // phone number save to null 
            if (msgDivId === 'signup-msg') {
                try {
                    await fetch(`${GO_SERVER_URL}/api/signup`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            FirebaseUID: user.uid,
                            Email: user.email,
                            FullName: fullName
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


            window.location.href = 'index.html';

            /*setTimeout(() => {
                
            }, 1000);
            */
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
    handleGoogleAuth('signin-msg');
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
    clearAllMessages(); // Clear old errors
    // Get user data
    const fullName = document.getElementById('signup-fullname').value.trim();
    //const lastName = document.getElementById('signup-lastname').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pwd = document.getElementById('signup-password').value;

    // Validation
    if (!fullName) {
        showMsg('Please enter your full name.', 'signup-msg');
        return;
    }

    if (pwd.length < 8) {
        showMsg('Password must be at least 8 characters long.', 'signup-msg');
        return;
    }


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
                fullName: fullName,
                provider: 'email'
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
//window.loginWithGoogle = loginWithGoogle;
window.sendOTP = sendOTP;
window.verifyOTP = verifyOTP;