import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBtv30hnVryB461BCLdWPFUWLSXrQ1bhXU",
  authDomain: "m8readinglog.firebaseapp.com",
  projectId: "m8readinglog",
  storageBucket: "m8readinglog.firebasestorage.app",
  messagingSenderId: "361872149538",
  appId: "1:361872149538:web:f9b8838fd594aa0d110e7b"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
