import { useQuery, useMutation } from "@tanstack/react-query";
import { getApiBaseUrl } from "../config/env";
import { getAccessToken } from "../utils/tokenService";

interface DebugEmitDto {
  event: string;
  roomType: "channel" | "dmGroup" | "user" | "community" | "raw";
  roomId: string;
  payload: Record<string, unknown>;
}

interface DebugEmitResponse {
  success: boolean;
  room: string;
  event: string;
}

async function debugFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${getApiBaseUrl()}/debug${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`Debug API error: ${res.status}`);
  }

  return res.json();
}

export function useDebugStatus() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["debugStatus"],
    queryFn: () => debugFetch<{ enabled: boolean }>("/status"),
    retry: false,
  });

  return {
    isEnabled: !!data?.enabled,
    isLoading,
    isUnavailable: isError,
  };
}

export function useDebugEmit() {
  return useMutation({
    mutationFn: (dto: DebugEmitDto) =>
      debugFetch<DebugEmitResponse>("/emit", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
  });
}
