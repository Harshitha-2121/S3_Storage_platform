"use client";

import { api } from "@v1/backend/convex/_generated/api";
import { useAuthToken } from "@convex-dev/auth/react";
import { useAction } from "convex/react";
import { backendConfig } from "./backend.config";

/**
 * DIRECT path — browser calls the external backend directly, carrying the Convex JWT.
 * The backend verifies it via JWKS (no shared secret). Best for reads + streaming.
 */
export function useDirectBackend() {
  const token = useAuthToken();
  return async (path: string, init?: RequestInit) => {
    const res = await fetch(`${backendConfig.url}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    return res.json();
  };
}

/**
 * PROXY path — dashboard -> Convex action -> external backend (service key + userId).
 * Best for privileged / server-only operations.
 */
export function useProxyBackend() {
  return useAction(api.backend.callBackend);
}
