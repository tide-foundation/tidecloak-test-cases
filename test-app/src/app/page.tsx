"use client";

import { useEffect } from "react";
import { IAMService } from "@tidecloak/js";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      window.location.href = "/admin";
    }
  }, [isAuthenticated, isLoading]);

  const handleLogin = () => {
    IAMService.doLogin();
  };

  return (
    <div>
      <img src="/logo.svg" alt="Test App Logo" />
      <p>TideCloak Integration Testing Application</p>
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}
