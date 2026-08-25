import React from "react";
import {useNavigate} from "react-router-dom";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import Login from "./Login";
import Register from "./Register";
import LandingPage from "./LandingPage";
import ProtectedRoute from "./ProtectedRoute";
import FAQ from "./Faq";
import 'leaflet/dist/leaflet.css';

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={
        <ProtectedRoute><App /></ProtectedRoute>
      } />
      <Route path="/faq" element={<FAQ />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  </BrowserRouter>
);
