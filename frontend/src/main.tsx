import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { ScopeProvider } from "./contexts/ScopeContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ScopeProvider>
          <App />
        </ScopeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
