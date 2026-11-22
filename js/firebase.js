import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
  off
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDzW2RmlLRRCcqouzGSO22leYv59kZjNjc",
  authDomain: "biz-uygulama-d798c.firebaseapp.com",
  databaseURL: "https://biz-uygulama-d798c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "biz-uygulama-d798c",
  storageBucket: "biz-uygulama-d798c.firebasestorage.app",
  messagingSenderId: "672568758665",
  appId: "1:672568758665:web:413a60b0d61426e28dd158"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export {
  ref,
  set,
  onValue,
  off,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
};
