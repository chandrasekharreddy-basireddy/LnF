export type ItemType = 'lost' | 'found';

export type ItemStatus =
  | 'pending_moderation'
  | 'available'
  | 'claimed'
  | 'recovered'
  | 'expired'
  | 'quarantined'
  | 'archived';

export type ClaimStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';

export type PublicItem = {
  id: string;
  ref: string;
  type: ItemType;
  status: ItemStatus;
  category: string;
  title: string;
  description: string;
  zoneLabel: string | null;
  zoneCode: string | null;
  spot: string | null;
  eventDate: string;
  custodyLabel: string | null;
  verificationQuestion: string | null;
  sensitiveHiddenPhoto: boolean;
  isSample: boolean;
  createdAt: string;
  coverPath?: string | null;
  coverUrl?: string | null;
};

export type Photo = { path: string; alt: string; width: number | null; height: number | null };
export type SignedPhoto = { url: string; alt: string; width: number | null; height: number | null };

export type SearchResult = { items: PublicItem[]; total: number; limit: number; offset: number };

export type BoardStats = {
  open_found: number;
  open_lost: number;
  recovered_total: number;
  recovered_30d: number;
  median_days_to_recovery: number | null;
};

export type SessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  roles: string[];
  alertsOptIn: boolean;
};

export type ClaimSummary = {
  ref: string;
  status: ClaimStatus;
  createdAt: string;
  itemRef: string;
  itemTitle: string;
  itemType: ItemType;
  itemCategory: string;
};

export type ClaimDetail = {
  claim: {
    ref: string;
    status: ClaimStatus;
    createdAt: string;
    decidedAt: string | null;
    reason: string | null;
    proof: string | null;
  };
  item: PublicItem;
  timeline: { status: ClaimStatus; note: string | null; at: string }[];
  handover: {
    code: string | null;
    alreadyShown: boolean;
    used: boolean;
    expiresAt: string | null;
  };
};

export type ActionResult = { ok: boolean; error?: string; message?: string; ref?: string };
