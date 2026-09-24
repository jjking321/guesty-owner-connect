// Internal portfolio comparable ("peer") matching helpers.
// Peers are your own properties, so all metrics come straight from PMS data.

export interface PortfolioListing {
  id: string;
  nickname: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  accommodates: number | null;
  property_type: string | null;
  amenities: string[] | null;
  address: any;
  thumbnail: string | null;
  is_listed: boolean | null;
}

export interface StayProfile {
  listing_id: string;
  typical_min_nights: number | null;
  max_min_nights: number | null;
  min_min_nights: number | null;
  days_sampled: number | null;
}

export type StayTier = 'short' | 'mid' | 'monthly' | 'unknown';

export const STAY_TIERS: { key: StayTier; label: string; description: string }[] = [
  { key: 'short', label: 'Short-term', description: '1-6 night minimum' },
  { key: 'mid', label: 'Weekly / mid-term', description: '7-20 night minimum' },
  { key: 'monthly', label: 'Monthly / long-term', description: '21+ night minimum' },
  { key: 'unknown', label: 'Unknown', description: 'No calendar minimums synced' },
];

export function stayTierOf(minNights: number | null | undefined): StayTier {
  if (minNights == null || !Number.isFinite(Number(minNights))) return 'unknown';
  const n = Number(minNights);
  if (n >= 21) return 'monthly';
  if (n >= 7) return 'mid';
  return 'short';
}

export function stayTierLabel(tier: StayTier): string {
  return STAY_TIERS.find((t) => t.key === tier)?.label ?? 'Unknown';
}

export function formatMinNights(minNights: number | null | undefined): string {
  if (minNights == null || !Number.isFinite(Number(minNights))) return '—';
  return `${Math.round(Number(minNights))}-nt min`;
}

export interface PeerMetrics {
  listing_id: string;
  ttm_revenue: number | null;
  ttm_nights: number | null;
  ttm_adr: number | null;
  ttm_occupancy: number | null;
  last30_adr: number | null;
  future_asking_adr: number | null;
  future_available_nights: number | null;
  future_booked_nights: number | null;
}

export interface Suggestion {
  listing: PortfolioListing;
  score: number;
  reasons: string[];
  distanceMiles: number | null;
}


// Amenities that move revenue the most, with the synonyms Guesty uses.
export const KEY_AMENITIES: { key: string; label: string; weight: number; match: string[] }[] = [
  { key: 'pool', label: 'Pool', weight: 22, match: ['pool', 'private pool', 'shared pool', 'heated pool'] },
  { key: 'hot_tub', label: 'Hot tub', weight: 16, match: ['hot tub', 'hottub', 'jacuzzi', 'spa', 'whirlpool'] },
  { key: 'waterfront', label: 'Waterfront', weight: 16, match: ['waterfront', 'lake front', 'lakefront', 'river front', 'oceanfront', 'ocean front'] },
  { key: 'beach_access', label: 'Beach access', weight: 12, match: ['beach access', 'beachfront', 'beach front', 'beach view'] },
  { key: 'pets_allowed', label: 'Pets OK', weight: 6, match: ['pets allowed', 'pet friendly', 'pet-friendly', 'dogs allowed'] },
  { key: 'ev_charger', label: 'EV charger', weight: 3, match: ['ev charger', 'electric vehicle charger'] },
  { key: 'game_room', label: 'Game room', weight: 5, match: ['game room', 'pool table', 'arcade', 'game console'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[_-]+/g, ' ').trim();

export function hasAmenity(amenities: string[] | null | undefined, key: string): boolean {
  if (!amenities?.length) return false;
  const def = KEY_AMENITIES.find((a) => a.key === key);
  if (!def) return false;
  const list = amenities.map(norm);
  return list.some((a) => def.match.some((m) => a.includes(m)));
}

export function amenityBadges(amenities: string[] | null | undefined): string[] {
  return KEY_AMENITIES.filter((a) => hasAmenity(amenities, a.key)).map((a) => a.label);
}

export function haversineMiles(
  lat1?: number | null,
  lon1?: number | null,
  lat2?: number | null,
  lon2?: number | null,
): number | null {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coords(listing: PortfolioListing) {
  const addr = listing.address || {};
  return {
    lat: typeof addr.lat === 'number' ? addr.lat : null,
    lng: typeof addr.lng === 'number' ? addr.lng : null,
    city: (addr.city || addr.locality || '') as string,
  };
}

/**
 * Score portfolio listings against a subject property.
 * Bedrooms are the strongest signal, then key amenities (pool/hot tub/waterfront),
 * then proximity, capacity and property type.
 */
export function suggestPeers(
  subject: PortfolioListing,
  candidates: PortfolioListing[],
  limit = 8,
): Suggestion[] {
  const subj = coords(subject);

  const scored = candidates
    .filter((c) => c.id !== subject.id)
    .map<Suggestion>((c) => {
      const reasons: string[] = [];
      let score = 0;

      // Bedrooms
      if (subject.bedrooms != null && c.bedrooms != null) {
        const diff = Math.abs(subject.bedrooms - c.bedrooms);
        if (diff === 0) {
          score += 35;
          reasons.push(`Same size (${c.bedrooms} BR)`);
        } else if (diff === 1) {
          score += 15;
          reasons.push(`${c.bedrooms} BR (±1)`);
        } else {
          score -= 15 * (diff - 1);
        }
      }

      // Key amenities
      for (const a of KEY_AMENITIES) {
        const subjHas = hasAmenity(subject.amenities, a.key);
        const peerHas = hasAmenity(c.amenities, a.key);
        if (subjHas && peerHas) {
          score += a.weight;
          reasons.push(a.label);
        } else if (subjHas !== peerHas && a.weight >= 12) {
          // Missing a high-impact amenity is a real revenue difference
          score -= a.weight;
        }
      }

      // Location
      const peer = coords(c);
      const distance = haversineMiles(subj.lat, subj.lng, peer.lat, peer.lng);
      if (distance != null) {
        if (distance <= 1) {
          score += 20;
          reasons.push('Under 1 mi away');
        } else if (distance <= 5) {
          score += 14;
          reasons.push(`${distance.toFixed(1)} mi away`);
        } else if (distance <= 15) {
          score += 7;
          reasons.push(`${distance.toFixed(0)} mi away`);
        } else {
          score -= 10;
        }
      } else if (subj.city && peer.city && norm(subj.city) === norm(peer.city)) {
        score += 10;
        reasons.push(subj.city);
      }

      // Capacity
      if (subject.accommodates != null && c.accommodates != null) {
        const diff = Math.abs(subject.accommodates - c.accommodates);
        if (diff <= 1) {
          score += 8;
        } else if (diff <= 3) {
          score += 4;
        } else {
          score -= 5;
        }
      }

      // Property type
      if (subject.property_type && c.property_type && subject.property_type === c.property_type) {
        score += 6;
      }

      return { listing: c, score, reasons, distanceMiles: distance };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

export function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function average(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
