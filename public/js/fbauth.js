import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyA8zoh5sEzNN6QyWepTCPpIJyM9X_SPC3A",
    authDomain: "pball-score.firebaseapp.com",
    projectId: "pball-score",
    storageBucket: "pball-score.firebasestorage.app",
    messagingSenderId: "74527160758",
    appId: "1:74527160758:web:7c74e331179c83de252917",
    measurementId: "G-26JH56D26T"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();