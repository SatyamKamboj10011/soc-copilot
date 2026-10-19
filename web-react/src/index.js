import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import Login from "./Login";
import Register from "./Register";
import LandingPage from "./LandingPage";
import ProtectedRoute from "./ProtectedRoute";
import FAQ from "./Faq";
import { installDemoApi, DEMO } from "./demo/demoApi";
import DemoBanner from "./demo/DemoBanner";
import 'leaflet/dist/leaflet.css';

// Public demo build: answer API calls from bundled synthetic data (no server).
installDemoApi();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={DEMO ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/register" element={DEMO ? <Navigate to="/dashboard" /> : <Register />} />
      <Route path="/dashboard" element={
        <ProtectedRoute><App /></ProtectedRoute>
      } />
      <Route path="/faq" element={<FAQ />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    {DEMO && <DemoBanner />}
  </BrowserRouter>
);
