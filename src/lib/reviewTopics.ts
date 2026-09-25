// Zero-cost, rule-based topic mining for guest review text.
// Runs entirely in the browser — no AI tokens, no external API calls.

export interface ReviewTopic {
  key: string;
  label: string;
  /** Lowercase keyword/phrase fragments. Matched on word boundaries. */
  keywords: string[];
}

export const REVIEW_TOPICS: ReviewTopic[] = [
  {
    key: "cleanliness",
    label: "Cleanliness & Odor",
    keywords: [
      "not clean", "wasn't clean", "was not clean", "needs cleaning", "deep clean", "cleaning fee",
      "dirty", "filthy", "grimy", "dusty", "dust", "grime", "stain", "stained", "stains",
      "hair", "hairs", "crumbs", "sticky", "mold", "moldy", "mildew", "smell", "smelled",
      "smelly", "odor", "odour", "musty", "trash", "garbage", "bugs", "roach", "roaches",
      "ants", "spiders", "cobwebs", "sheets were", "dirty towels", "dirty dishes",
    ],
  },
  {
    key: "hvac",
    label: "HVAC & Climate",
    keywords: [
      "air conditioning", "air conditioner", "a/c", " ac ", "ac was", "ac did", "ac unit",
      "heater", "heating", "heat did", "no heat", "furnace", "thermostat", "too hot",
      "too cold", "freezing", "stuffy", "humid", "fan didn", "no fan",
    ],
  },
  {
    key: "pool_outdoor",
    label: "Pool, Spa & Outdoor",
    keywords: [
      "pool", "hot tub", "hottub", "spa", "jacuzzi", "grill", "bbq", "barbecue",
      "patio", "deck", "balcony", "lanai", "yard", "outdoor furniture", "lounge chair",
    ],
  },
  {
    key: "tech",
    label: "Wi-Fi, TV & Tech",
    keywords: [
      "wifi", "wi-fi", "internet", "connection was", "no signal", "password didn",
      " tv ", "tv didn", "tv was", "television", "cable", "streaming", "netflix",
      "remote", "smart tv", "speaker",
    ],
  },
  {
    key: "checkin",
    label: "Check-in & Access",
    keywords: [
      "check in", "check-in", "checkin", "checkout", "check out", "check-out",
      "keypad", "key pad", "lock box", "lockbox", "door code", "access code",
      "the code", "couldn't get in", "could not get in", "locked out", "key",
      "instructions were", "no instructions", "front desk", "parking pass", "gate code",
    ],
  },
  {
    key: "noise_location",
    label: "Noise, Sleep & Location",
    keywords: [
      "noise", "noisy", "loud", "loudly", "couldn't sleep", "could not sleep",
      "construction", "traffic", "neighbors", "neighbours", "party", "barking",
      "train", "airport", "thin walls", "mattress", "bed was", "uncomfortable bed",
      "pillows", "sleep",
    ],
  },
  {
    key: "maintenance",
    label: "Maintenance & Fixtures",
    keywords: [
      "broken", "broke", "didn't work", "did not work", "doesn't work", "does not work",
      "not working", "leak", "leaking", "clogged", "plumbing", "toilet", "shower",
      "water pressure", "hot water", "no hot water", "drain", "faucet", "sink",
      "dishwasher", "washer", "dryer", "fridge", "refrigerator", "microwave", "oven",
      "light bulb", "lightbulb", "door wouldn", "screen door", "needs repair",
      "outdated", "worn", "dated", "needs updating", "needs upgrades", "upgrades",
    ],
  },
  {
    key: "value_fees",
    label: "Value & Fees",
    keywords: [
      "overpriced", "too expensive", "not worth", "worth the price", "value for",
      "poor value", "pricey", "fees", "fee was", "extra charge", "deposit",
      "refund", "charged", "for the price",
    ],
  },
  {
    key: "accuracy",
    label: "Accuracy & Expectations",
    keywords: [
      "photos", "pictures", "misleading", "not as described", "as described",
      "smaller than", "looked different", "expected", "disappointed", "disappointing",
      "listing said", "advertised", "inaccurate",
    ],
  },
  {
    key: "communication",
    label: "Host Communication & Staff",
    keywords: [
      "unresponsive", "never responded", "no response", "didn't respond",
      "did not respond", "rude", "unhelpful", "staff", "management", "manager",
      "took hours", "slow to respond", "hard to reach",
    ],
  },
];

/**
 * Booking.com text often arrives as "Positive: ... Negative: ...".
 * Returns the portion of the text most likely to hold the complaint.
 */
export function extractCriticalText(text: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const negIdx = lower.indexOf("negative:");
  const posIdx = lower.indexOf("positive:");

  if (negIdx >= 0) {
    // Everything before "Positive:" (the free-form comment) plus the Negative block.
    const head = posIdx >= 0 && posIdx < negIdx ? text.slice(0, posIdx) : text.slice(0, negIdx);
    return `${head} ${text.slice(negIdx)}`.trim();
  }
  if (posIdx >= 0) {
    // Only a positive block exists — keep the free-form comment before it.
    return text.slice(0, posIdx).trim();
  }
  return text;
}

function matches(haystack: string, keyword: string): boolean {
  if (keyword.startsWith(" ") || keyword.endsWith(" ") || keyword.includes(" ")) {
    return haystack.includes(keyword);
  }
  const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(haystack);
}

export interface TopicHit {
  topicKey: string;
  matchedKeywords: string[];
  snippet: string;
}

/** Classify one review's text into zero or more topics. */
export function classifyReviewText(text: string | null | undefined): TopicHit[] {
  if (!text) return [];
  const critical = extractCriticalText(text);
  const haystack = ` ${critical.toLowerCase().replace(/\s+/g, " ")} `;
  const hits: TopicHit[] = [];

  for (const topic of REVIEW_TOPICS) {
    const matched = topic.keywords.filter((k) => matches(haystack, k));
    if (matched.length === 0) continue;
    hits.push({
      topicKey: topic.key,
      matchedKeywords: matched,
      snippet: buildSnippet(critical, matched[0]),
    });
  }
  return hits;
}

/** Pull a readable sentence-sized window around the first matched keyword. */
export function buildSnippet(text: string, keyword: string, window = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const idx = clean.toLowerCase().indexOf(keyword.trim().toLowerCase());
  if (idx < 0) return clean.slice(0, window);
  const start = Math.max(0, idx - Math.floor(window / 2));
  const end = Math.min(clean.length, idx + Math.ceil(window / 2));
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

export const TOPIC_LABELS: Record<string, string> = REVIEW_TOPICS.reduce(
  (acc, t) => ({ ...acc, [t.key]: t.label }),
  {} as Record<string, string>,
);
