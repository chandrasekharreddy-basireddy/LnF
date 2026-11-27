import { supabaseServer } from './supabase-server';
import type {
  BoardStats, ClaimDetail, ClaimSummary, ClaimThread, Photo, PublicItem, SearchResult, SessionUser, SignedPhoto,
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
    return { ...result, items: await attachCovers(result.items) };
  } catch {
    return { items: [], total: 0, limit, offset: 0 };
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

export async function getItem(ref: string): Promise<{ item: PublicItem; photos: SignedPhoto[] } | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('get_public_item', { p_ref: ref });
    if (error || !data) return null;
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
  } catch {
    return null;
  }
}

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

export async function zones(): Promise<{ code: string; name: string }[]> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.from('public_zones').select('code,name,sort_order');
    return (data ?? []) as { code: string; name: string }[];
  } catch {
    return [];
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  try {
    const supabase = await supabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const [{ data: roles }, { data: profile }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', auth.user.id),
      supabase
        .from('profiles')
        .select('full_name,email,phone,alerts_opt_in,marketing_opt_in')
        .eq('id', auth.user.id)
        .maybeSingle(),
    ]);
    return {
      id: auth.user.id,
      email: profile?.email ?? auth.user.email ?? null,
      name: profile?.full_name ?? null,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
      alertsOptIn: Boolean(profile?.alerts_opt_in),
      phone: (profile?.phone as string | null) ?? null,
      marketingOptIn: Boolean(profile?.marketing_opt_in),
    };
  } catch {
    return null;
  }
}

export function isStaff(user: SessionUser | null): boolean {
  return Boolean(user && (user.roles.includes('staff') || user.roles.includes('admin')));
}

export function isAdmin(user: SessionUser | null): boolean {
  return Boolean(user && user.roles.includes('admin'));
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

export async function retentionPolicies() {
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
}

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
