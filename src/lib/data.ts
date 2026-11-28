import { cache } from 'react';
import { supabaseServer } from './supabase-server';
import type { ReportSnapshot } from './monthly-report';
import type { CustodyPayload } from './custody';
import type { DeskSheetPayload } from './offline';
import type {
  BoardStats, ClaimDetail, ClaimSummary, ClaimThread, Conversation, DisputableClaim, DisputeQueueRow,
  DisputeRoom, DisputeSummary, Photo, PublicItem, PublicTrust, SearchResult, SessionUser, SignedPhoto, TrustCounts,
} from './types';

export type SearchParams = {
  q?: string;
  type?: string;
  category?: string;
  zone?: string;
  from?: string;
  to?: string;
  status?: string;
  sort?: string;
  page?: number;
  limit?: number;
};

function safe<T>(value: T | null, fallback: T): T {
  return value ?? fallback;
}

export async function searchItems(params: SearchParams): Promise<SearchResult> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const page = Math.max(params.page ?? 1, 1);
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('search_items', {
      p: {
        q: params.q ?? '',
        type: params.type ?? '',
        category: params.category ?? '',
        zone: params.zone ?? '',
        from: params.from ?? '',
        to: params.to ?? '',
        status: params.status ?? '',
        sort: params.sort ?? 'best',
        limit,
        offset: (page - 1) * limit,
      },
    });
    if (error) throw error;
    const result = safe(data as SearchResult | null, { items: [], total: 0, limit, offset: 0 });
    return { ...result, items: await attachCovers(result.items), ok: true };
  } catch {
    return { items: [], total: 0, limit, offset: 0, ok: false };
  }
}

/** One signed-URL call for a whole page of cards. */
async function attachCovers(items: PublicItem[]): Promise<PublicItem[]> {
  const withCover = items.filter((i) => i.coverPath);
  if (!withCover.length) return items;
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.storage
      .from('item-photos')
      .createSignedUrls(withCover.map((i) => i.coverPath as string), 60 * 60);
    const map = new Map<string, string>();
    withCover.forEach((item, index) => {
      const signed = data?.[index]?.signedUrl;
      if (signed && item.coverPath) map.set(item.coverPath, signed);
    });
    return items.map((item) =>
      item.coverPath && map.has(item.coverPath)
        ? { ...item, coverUrl: map.get(item.coverPath) as string }
        : item,
    );
  } catch {
    return items;
  }
}

export async function signPhotos(photos: Photo[]): Promise<SignedPhoto[]> {
  if (!photos.length) return [];
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.storage
      .from('item-photos')
      .createSignedUrls(photos.map((p) => p.path), 60 * 60);
    if (!data) return [];
    return photos.map((p, i) => ({
      url: data[i]?.signedUrl ?? '',
      alt: p.alt,
      width: p.width,
      height: p.height,
    })).filter((p) => p.url);
  } catch {
    return [];
  }
}

export const getItem = cache(async function getItem(ref: string): Promise<{ item: PublicItem; photos: SignedPhoto[] } | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('get_public_item', { p_ref: ref });
    // A transport failure is not a missing item. Returning null for both made the
    // page call notFound(), so poor wifi told a student their listing had been
    // removed. Throwing renders error.tsx, which offers a retry.
    if (error) throw new Error(error.message);
    if (!data) return null;
    const payload = data as { item: Partial<PublicItem> & { ref: string; status: PublicItem['status'] }; photos: Photo[] };

    // get_public_item returns a stub for a quarantined listing: reference and
    // status only. Fill the rest with empty values so the page can render its
    // neutral "held at the desk" state without a private field anywhere.
    if (payload.item.status === 'quarantined') {
      const stub: PublicItem = {
        id: payload.item.id ?? '',
        ref: payload.item.ref,
        type: payload.item.type ?? 'found',
        status: 'quarantined',
        category: 'documents',
        title: '',
        description: '',
        zoneLabel: null,
        zoneCode: null,
        spot: null,
        eventDate: '',
        custodyLabel: null,
        verificationQuestion: null,
        sensitiveHiddenPhoto: true,
        isSample: false,
        createdAt: '',
      };
      return { item: stub, photos: [] };
    }

    const photos = payload.item.sensitiveHiddenPhoto ? [] : await signPhotos(payload.photos ?? []);
    return { item: payload.item as PublicItem, photos };
  } catch (cause) {
    // rethrow: the page's error boundary shows "This screen did not load"
    throw cause instanceof Error ? cause : new Error('Could not read the listing');
  }
});

/** Returns null when the board cannot be reached, so callers can tell "zero" from "unknown". */
export async function boardStats(): Promise<BoardStats | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('board_stats');
    if (error || !data) return null;
    return data as BoardStats;
  } catch {
    return null;
  }
}

export const zones = cache(async function zones(): Promise<{ code: string; name: string }[]> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.from('public_zones').select('code,name,sort_order');
    return (data ?? []) as { code: string; name: string }[];
  } catch {
    return [];
  }
});

export const currentUser = cache(async function currentUser(): Promise<SessionUser | null> {
  try {
    const supabase = await supabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const [{ data: roles, error: rolesError }, { data: profile }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', auth.user.id),
      supabase
        .from('profiles')
        .select('full_name,email,phone,alerts_opt_in,push_opt_in,marketing_opt_in')
        .eq('id', auth.user.id)
        .maybeSingle(),
    ]);
    return {
      id: auth.user.id,
      email: profile?.email ?? auth.user.email ?? null,
      name: profile?.full_name ?? null,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
      alertsOptIn: Boolean(profile?.alerts_opt_in),
      pushOptIn: Boolean(profile?.push_opt_in),
      phone: (profile?.phone as string | null) ?? null,
      marketingOptIn: Boolean(profile?.marketing_opt_in),
      roleCheckFailed: Boolean(rolesError),
    };
  } catch {
    return null;
  }
});

export function isStaff(user: SessionUser | null): boolean {
  return Boolean(user && (user.roles.includes('staff') || user.roles.includes('admin')));
}

export function isAdmin(user: SessionUser | null): boolean {
  return Boolean(user && user.roles.includes('admin'));
}

export type PushState = { optIn: boolean; devices: number; lastSeenAt: string | null };

/**
 * The push preference and a device count. Never an endpoint or a key: those are
 * bearer secrets and no page has a reason to hold one.
 */
export async function myPushState(): Promise<PushState> {
  const empty: PushState = { optIn: false, devices: 0, lastSeenAt: null };
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('my_push_state');
    if (error || !data || typeof data !== 'object') return empty;
    const row = data as { ok?: boolean; optIn?: boolean; devices?: number; lastSeenAt?: string | null };
    if (row.ok === false) return empty;
    return {
      optIn: Boolean(row.optIn),
      devices: Number(row.devices ?? 0),
      lastSeenAt: row.lastSeenAt ?? null,
    };
  } catch {
    return empty;
  }
}

export async function myClaims(): Promise<ClaimSummary[]> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('my_claims');
    return (data ?? []) as ClaimSummary[];
  } catch {
    return [];
  }
}

export async function myClaim(ref: string): Promise<ClaimDetail | null> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('my_claim', { p_ref: ref });
    return (data as ClaimDetail | null) ?? null;
  } catch {
    return null;
  }
}

export async function myItems() {
  try {
    const supabase = await supabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return [];
    const { data } = await supabase
      .from('items')
      .select('id, ref_code, type, status, title, category, created_at, event_date')
      .eq('reporter_id', auth.user.id)
      .order('created_at', { ascending: false });
    return (data ?? []) as {
      id: string; ref_code: string; type: string; status: string;
      title: string; category: string; created_at: string; event_date: string;
    }[];
  } catch {
    return [];
  }
}

export async function claimThread(ref: string): Promise<ClaimThread | null> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('claim_thread', { p_claim_ref: ref });
    return (data as ClaimThread | null) ?? null;
  } catch {
    return null;
  }
}

/** Days since the service-role key was last rotated, from KEY_ROTATED_AT. */
export function keyRotationDays(): number | null {
  const stamp = process.env.KEY_ROTATED_AT;
  if (!stamp) return null;
  const then = new Date(stamp).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

export async function myConversations(): Promise<Conversation[]> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('my_conversations');
    if (error) return [];
    return (data ?? []) as Conversation[];
  } catch {
    return [];
  }
}

export async function unreadMessages(): Promise<number> {
  const threads = await myConversations();
  return threads.reduce((sum, thread) => sum + Number(thread.unread ?? 0), 0);
}

export async function staffDirectory(): Promise<{ id: string; name: string }[]> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('staff_directory');
    return (data ?? []) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

export async function verifyAuditChain(): Promise<{ ok: boolean; checked?: number; brokenAt?: number; error?: string } | null> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('verify_audit_chain', { p_limit: 5000 });
    return (data as { ok: boolean } | null) ?? null;
  } catch {
    return null;
  }
}

export async function lastOpsReview() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase
      .from('ops_reviews')
      .select('week_of, reviewed_by, notes, created_at')
      .order('week_of', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { week_of: string; reviewed_by: string | null; notes: string | null; created_at: string } | null) ?? null;
  } catch {
    return null;
  }
}

export async function disposalQueue() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('disposal_queue');
    return (data ?? []) as {
      ref: string; title: string; category: string; status: string; zone: string | null;
      eventDate: string; expiresAt: string; daysLeft: number;
      disposition: string | null; suggested: string;
    }[];
  } catch {
    return [];
  }
}

export const retentionPolicies = cache(async function retentionPolicies() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase
      .from('retention_policies')
      .select('category,retention_days,requires_photo_id,auto_hide_photos,notes')
      .order('retention_days', { ascending: false });
    return (data ?? []) as {
      category: string; retention_days: number; requires_photo_id: boolean;
      auto_hide_photos: boolean; notes: string | null;
    }[];
  } catch {
    return [];
  }
});

export async function mySavedItems(): Promise<PublicItem[]> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('my_saved_items');
    return (data ?? []) as PublicItem[];
  } catch {
    return [];
  }
}

export async function mySavedSearches() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('my_saved_searches');
    return (data ?? []) as {
      id: string; label: string; query: string | null; type: string | null;
      category: string | null; zone: string | null; active: boolean;
      lastNotifiedAt: string | null; createdAt: string;
    }[];
  } catch {
    return [];
  }
}

export async function isItemSaved(ref: string): Promise<boolean> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('is_item_saved', { p_ref: ref });
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function staffQueue() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('staff_claim_queue');
    return (data ?? null) as {
      claims: { ref: string; status: string; createdAt: string; answerMatched: boolean; itemRef: string; itemTitle: string; itemStatus: string; claimant: string; claimantEmail: string | null }[];
      intake: { ref: string; title: string; status: string; type: string; createdAt: string; zone: string | null }[];
      awaitingHandover: { claimRef: string; itemRef: string; itemTitle: string; approvedAt: string; codeUsed: boolean }[];
    } | null;
  } catch {
    return null;
  }
}

export type MatchCandidate = {
  lostRef: string;
  lostTitle: string;
  lostCategory: string;
  foundRef: string;
  foundTitle: string;
  foundCategory: string;
  zone: string | null;
  score: number;
  titleScore: number | null;
  photoScore: number | null;
  photoDistance: number | null;
  dayGap: number;
  notifiedAt: string | null;
  createdAt: string;
};

/**
 * Possible matches for the desk, with the numbers behind each score. The function
 * returns null for anyone who is not staff, so an empty list here means "staff,
 * nothing to look at" and null means "not staff".
 */
export async function matchQueue(limit = 50): Promise<MatchCandidate[] | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('match_queue', { p_limit: limit });
    if (error) return null;
    return (data as MatchCandidate[] | null) ?? null;
  } catch {
    return null;
  }
}

export async function staffItem(ref: string) {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('staff_item_detail', { p_ref: ref });
    return data as {
      item: PublicItem;
      private: { hasAnswer: boolean; notes: string | null; serial: string | null; bin: string | null; finderContact: string | null };
      contactEmail: string | null;
      claims: { ref: string; status: string; createdAt: string; answerMatched: boolean; proof: string | null; reason: string | null; claimant: string; claimantEmail: string | null }[];
      history: { action: string; at: string; detail: Record<string, unknown> }[];
    } | null;
  } catch {
    return null;
  }
}

export async function adminMetrics() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('admin_metrics');
    return data as {
      itemsByStatus: Record<string, number>;
      claimsByStatus: Record<string, number>;
      cohort60d: { handedIn: number; recovered: number; rate: number | null };
      medianDays: number | null;
      openReports: number;
      users: number;
      staff: number;
      zones: { zone: string; found: number }[];
    } | null;
  } catch {
    return null;
  }
}

export async function adminUsers() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('admin_list_users');
    return (data ?? []) as { id: string; email: string | null; name: string | null; roles: string[]; createdAt: string }[];
  } catch {
    return [];
  }
}

export async function adminAudit(limit = 100) {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('admin_audit_log', { p_limit: limit });
    return (data ?? []) as { id: number; action: string; resourceType: string | null; resourceId: string | null; detail: Record<string, unknown>; severity: string; at: string; actor: string }[];
  } catch {
    return [];
  }
}

export async function openReports() {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc('admin_open_reports');
    return (data ?? []) as { id: string; reason: string; details: string | null; status: string; at: string; itemRef: string | null; itemTitle: string | null }[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- disputes (0030)
// Every read here returns a typed shape or a null that the page can tell apart
// from "empty": a null from dispute_queue() means "not staff", and an empty list
// means "staff, nothing waiting". Rendering those two the same way is how a
// permission failure gets shown as good news.

export async function myDisputes(): Promise<DisputeSummary[]> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('my_disputes');
    if (error || !Array.isArray(data)) return [];
    return data as DisputeSummary[];
  } catch {
    return [];
  }
}

export async function myDisputableClaims(): Promise<DisputableClaim[]> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('my_disputable_claims');
    if (error || !Array.isArray(data)) return [];
    return data as DisputableClaim[];
  } catch {
    return [];
  }
}

/** null means "not yours, or not there" — the page answers both with notFound(). */
export async function disputeRoom(ref: string): Promise<DisputeRoom | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('dispute_room', { p_ref: ref });
    if (error) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as DisputeRoom;
  } catch {
    return null;
  }
}

/** null means "not staff". An empty array is a staff member with nothing waiting. */
export async function disputeQueue(limit = 50): Promise<DisputeQueueRow[] | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('dispute_queue', { p_limit: limit });
    if (error || !Array.isArray(data)) return null;
    return data as DisputeQueueRow[];
  } catch {
    return null;
  }
}

export async function claimantTrust(claimRef: string): Promise<TrustCounts | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('claimant_trust', { p_claim_ref: claimRef });
    if (error) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as TrustCounts;
  } catch {
    return null;
  }
}

/** Public and person-free. Null when the board cannot answer, so the block is hidden. */
export async function publicTrust(): Promise<PublicTrust | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('public_trust');
    if (error) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as PublicTrust;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- analytics (0031)
// The numbers arrive as one jsonb snapshot from a staff-only function. Three
// outcomes are kept apart on purpose: a refusal (the database said no), a bad
// range (the caller asked for something that is not a period), and a failure
// (the board could not answer). Rendering all three as "no data" is how a
// permission error gets shown as good news.

export type AnalyticsResult =
  | { ok: true; snapshot: ReportSnapshot }
  | { ok: false; error: 'RANGE_INVALID' | 'FORBIDDEN' | 'UNAVAILABLE' };

export async function institutionAnalytics(from: string, to: string): Promise<AnalyticsResult> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('institution_analytics', { p_from: from, p_to: to });
    if (error) return { ok: false, error: 'UNAVAILABLE' };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'FORBIDDEN' };
    const payload = data as { ok?: boolean; error?: string } & ReportSnapshot;
    if (payload.ok !== true) {
      return { ok: false, error: payload.error === 'RANGE_INVALID' ? 'RANGE_INVALID' : 'FORBIDDEN' };
    }
    return { ok: true, snapshot: payload };
  } catch {
    return { ok: false, error: 'UNAVAILABLE' };
  }
}

/**
 * One audit row per download. A false return means the record was not written,
 * which the route reports in its log but does not use to withhold the file: the
 * person asking is already staff, and the numbers are already on the page.
 */
export async function logReportExport(from: string, to: string): Promise<boolean> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('log_report_export', { p_from: from, p_to: to });
    if (error) return false;
    return Boolean(data && typeof data === 'object' && (data as { ok?: boolean }).ok === true);
  } catch {
    return false;
  }
}

/**
 * The chain of custody for one item, as its reporter (or staff) sees it. The
 * function behind this returns NOT_FOUND for anyone else, so a null here means
 * "no such item, or not yours" — the page answers both the same way.
 */
export async function custodyTimeline(ref: string): Promise<CustodyPayload | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('item_custody_timeline', { p_ref: ref });
    if (error || !data || typeof data !== 'object') return null;
    const payload = data as CustodyPayload;
    return payload.ok === true ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The board, as a sheet the desk can keep offline. Staff only — the function
 * behind this returns NOT_STAFF (and null here) for anyone else.
 */
export async function deskSheet(limit = 300): Promise<DeskSheetPayload | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('desk_sheet', { p_limit: limit });
    if (error || !data || typeof data !== 'object') return null;
    const payload = data as DeskSheetPayload;
    return payload.ok === true ? payload : null;
  } catch {
    return null;
  }
}
