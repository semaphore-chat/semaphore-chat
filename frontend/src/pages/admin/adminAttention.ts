import type {
  InstanceStorageStatsDto,
  LivekitHealthResponseDto,
} from "../../api-client/types.gen";

/** Server disk use (percent) at which the dashboard asks for attention. */
export const DISK_WARNING_PERCENT = 80;
/** Server disk use (percent) at which the attention item turns red. Matches AdminStoragePage's `> 90` error colour. */
export const DISK_ERROR_PERCENT = 90;

/** Where the "Voice and video are off" item points: the LiveKit setup instructions. */
export const LIVEKIT_SETUP_DOCS_URL =
  "https://docs.semaphorechat.app/installation/docker-compose/#connecting-your-livekit-server";

export type AttentionSeverity = "error" | "warning";

export type AttentionItemId = "disk" | "over-quota" | "storage-unavailable" | "livekit";

export interface AttentionItem {
  id: AttentionItemId;
  severity: AttentionSeverity;
  title: string;
  detail?: string;
  /** In-app route (`to`) or external URL (`href`). Neither: the row offers a retry instead. */
  to?: string;
  href?: string;
  /** Label of the link or action at the end of the row. */
  actionLabel: string;
}

export interface AttentionInput {
  storage?: InstanceStorageStatsDto;
  storageError?: boolean;
  livekit?: LivekitHealthResponseDto;
}

export const diskSeverity = (percent: number): AttentionSeverity | null => {
  if (percent >= DISK_ERROR_PERCENT) return "error";
  if (percent >= DISK_WARNING_PERCENT) return "warning";
  return null;
};

const formatPercent = (percent: number) => `${Math.round(percent)}%`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * What on the instance needs an admin's attention, errors first.
 * Only signals the backend already reports: server disk use, users over 90% of
 * their storage quota, an unreachable storage/server stats endpoint, and whether
 * LiveKit is configured. An empty list means "All good".
 */
export function getAttentionItems({ storage, storageError, livekit }: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (storageError) {
    items.push({
      id: "storage-unavailable",
      severity: "warning",
      title: "Couldn't load storage and server status",
      detail: "Disk and quota checks are unavailable until it loads.",
      actionLabel: "Try again",
    });
  }

  if (storage) {
    const { server } = storage;
    const severity = server.diskTotalBytes > 0 ? diskSeverity(server.diskUsedPercent) : null;
    if (severity) {
      items.push({
        id: "disk",
        severity,
        title: `Server disk is ${formatPercent(server.diskUsedPercent)} full`,
        detail: "Free up space or grow the disk before uploads start failing.",
        to: "/admin/storage",
        actionLabel: "Storage",
      });
    }

    if (storage.usersOverQuota > 0) {
      const n = storage.usersOverQuota;
      items.push({
        id: "over-quota",
        severity: "warning",
        title: `${n.toLocaleString()} ${plural(n, "user is", "users are")} over 90% of their storage quota`,
        detail: "They'll soon be unable to upload files.",
        to: "/admin/storage?minPercent=90",
        actionLabel: "Storage",
      });
    }
  }

  if (livekit && !livekit.configured) {
    items.push({
      id: "livekit",
      severity: "warning",
      title: "Voice and video are off: LiveKit isn't configured",
      detail: "Text chat works without it. Set up LiveKit to enable voice channels and screen sharing.",
      href: LIVEKIT_SETUP_DOCS_URL,
      actionLabel: "Setup guide",
    });
  }

  const rank: Record<AttentionSeverity, number> = { error: 0, warning: 1 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
