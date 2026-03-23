"use client";

import { DPoPAuthProvider } from "@/components/DPoPAuthProvider";

export default function DPoPLayout({ children }: { children: React.ReactNode }) {
    return <DPoPAuthProvider>{children}</DPoPAuthProvider>;
}
