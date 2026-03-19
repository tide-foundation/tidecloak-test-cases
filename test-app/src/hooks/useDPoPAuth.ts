"use client";

import { useContext } from "react";
import { DPoPAuthContext } from "@/components/DPoPAuthProvider";

export function useDPoPAuth() {
    const context = useContext(DPoPAuthContext);
    if (!context) {
        throw new Error("useDPoPAuth must be used within a DPoPAuthProvider");
    }
    return context;
}
