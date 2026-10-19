import React from "react";
import { Navigate } from "react-router-dom";
import { DEMO } from "./demo/demoApi";

export default function ProtectedRoute({ children }) {
  // Public demo: no sign-in, visitors go straight to the dashboard.
  if (DEMO && !localStorage.getItem("token")) {
    localStorage.setItem("token", "demo");
    localStorage.setItem("username", "demo.analyst");
  }
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" />;
}
