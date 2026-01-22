"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function RedirectPage() {
    const { isAuthenticated, isLoading } = useAuth();

    useEffect(() => {
        if (!isLoading) {
            if (isAuthenticated) {
                window.location.href = "/admin";
            } else {
                window.location.href = "/";
            }
        }
    }, [isLoading, isAuthenticated]);

    return <p>Redirecting...</p>;
}
