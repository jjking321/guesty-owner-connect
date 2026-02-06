

# Review Dispute Pipeline - Implementation Plan

## Overview

Build a Kanban-style pipeline for managing negative Airbnb review disputes. This will be a new tab in the Reviews section that helps identify and dispute reviews violating Airbnb's content policies.

## Architecture Summary

```text
+------------------+     +------------------------+     +-------------------+
|  Reviews Page    |     |  Dispute Pipeline Tab  |     |  Detail Sheet     |
|  (new tab)       | --> |  (Kanban board)        | --> |  (review + AI)    |
+------------------+     +------------------------+     +-------------------+
                                    |
                                    v
                         +------------------------+
                         |  Edge Functions        |
                         |  - analyze-dispute     |
                         |  - fetch-conversations |
                         +------------------------+
```

## Phase 1: Database Schema

### New Columns on `reviews` Table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `dispute_status` | text | null | Pipeline stage: triage, analyzing, not_eligible, submit_claim, submitted, pending, resolved |
| `dispute_resolution` | text | null | Final outcome: removed, denied |
| `dispute_likelihood_score` | integer | null | AI-calculated score 0-100 |
| `dispute_violation_category` | text | null | Which of the 5 Airbnb categories applies |
| `dispute_case_file` | jsonb | null | Pre-written dispute text with category_reason and description |
| `dispute_analyzed_at` | timestamptz | null | When AI analysis was performed |
| `dispute_is_high_priority` | boolean | false | True if likelihood >= 70 |
| `dispute_message_history` | jsonb | null | Array of conversation messages from Guesty |
| `dispute_conversation_summary` | text | null | AI-generated summary of conversation |
| `dispute_has_threats` | boolean | false | Detected threats in conversation |
| `dispute_has_pressure` | boolean | false | Detected pressure/coercion in conversation |
| `dispute_has_refund_demands` | boolean | false | Detected refund demands in conversation |
| `dispute_submitted_at` | timestamptz | null | When claim was submitted |
| `dispute_resolved_at` | timestamptz | null | When resolution received |
| `dispute_notes` | text | null | User notes on the dispute |

### New AI Prompt Config

Add a new prompt key `review_dispute_analysis` to `ai_prompt_configs` table for customizable analysis prompt.

## Phase 2: Edge Functions

### 1. `fetch-dispute-conversation` Edge Function

Fetches message history from Guesty for a specific reservation.

**Inputs:**
- `reviewId`: ID of the review
- `reservationId`: Guesty reservation ID

**Flow:**
1. Get Guesty account credentials from review's listing
2. Call `GET /v1/communication/conversations?reservation._id={reservationId}`
3. Get conversation ID from response
4. Call `GET /v1/communication/conversations/{conversationId}/posts`
5. Store messages in `dispute_message_history` on the review
6. Return conversation data

**Key Implementation Details:**
- Follow existing Guesty rate limit pattern (from custom knowledge)
- Use cached OAuth token pattern from `sync-reviews`
- Parse sender info to identify guest vs host messages

### 2. `analyze-review-dispute` Edge Function

Analyzes a review for dispute eligibility using Lovable AI.

**Inputs:**
- `reviewId`: ID of the review to analyze
- `includeConversation`: boolean - whether to fetch conversation first

**Flow:**
1. Fetch review details, listing info, reservation info
2. If `includeConversation` and no conversation yet, invoke `fetch-dispute-conversation`
3. Load custom prompt from `ai_prompt_configs` or use default
4. Call Lovable AI with review text, ratings, and conversation history
5. Parse AI response using tool calling for structured output:
   - `likelihoodScore`: 0-100
   - `violationCategory`: one of the 5 categories
   - `caseFile`: { category_reason, description }
   - `conversationSummary`: summary of conversation
   - `hasThrears`, `hasPressure`, `hasRefundDemands`: boolean flags
6. Update review with analysis results
7. Set `dispute_status` based on score:
   - 0% -> `not_eligible`
   - Otherwise -> `submit_claim`
8. Set `dispute_is_high_priority` if score >= 70

**Default AI Prompt Structure:**
```text
You are an expert at analyzing vacation rental reviews for Airbnb policy violations.

OBJECTIVE: Analyze whether this review can be disputed and removed based on Airbnb's 5 official dispute categories. Be aggressive in finding reasons for removal - we want to exploit Airbnb's policy in our favor.

## Airbnb's 5 Dispute Categories

1. **Retaliatory** - Review was left in retaliation for enforcing house rules, policies, or requesting payment for damages.

2. **Irrelevant** - Review doesn't relate to the stay, or guest never checked in.

3. **Pressure or Coercion** - Guest threatened a bad review to get refund/discount, or was incentivized.

4. **Competitor** - Review from someone affiliated with or competing with the listing.

5. **Content Policy Violation** - Discriminatory content, private info disclosure, profanity, or harassment.

## Analysis Guidelines

- Look for ANY evidence that could fit these categories
- Guest complaints about being charged for damages = potential retaliation
- Guest demanding refunds in messages = potential coercion
- Vague or off-topic complaints = potential irrelevance
- Be creative in framing the case

## Conversation Red Flags
- Threats to leave bad review
- Requests for refunds with implied consequences
- Aggressive or harassing language
- Mentions of competitors or alternative listings
```

## Phase 3: Frontend Components

### 1. `DisputePipelineBoard.tsx` - Kanban Board Component

Main Kanban-style board with 7 columns.

**Features:**
- Horizontal scrolling board with columns
- Cards show: property name, guest name, rating, date, likelihood score badge
- High priority cards have accent border
- Drag-and-drop to move between columns (except analyzing/not_eligible)
- Click card to open detail sheet
- Filter by property dropdown
- "Analyze New" button to batch-analyze triage items

**Column Configuration:**
```typescript
const COLUMNS = [
  { id: 'triage', label: 'Triage', color: 'bg-yellow-500' },
  { id: 'analyzing', label: 'Analyzing', color: 'bg-blue-500' },
  { id: 'not_eligible', label: 'Not Eligible', color: 'bg-gray-500' },
  { id: 'submit_claim', label: 'Submit Claim', color: 'bg-orange-500' },
  { id: 'submitted', label: 'Submitted', color: 'bg-purple-500' },
  { id: 'pending', label: 'Pending', color: 'bg-indigo-500' },
  { id: 'resolved', label: 'Resolved', color: 'bg-green-500' },
];
```

### 2. `DisputeCard.tsx` - Kanban Card Component

Individual review card in the pipeline.

**Display:**
- Property name (truncated)
- Star rating with color (1-3 stars = red/orange/yellow)
- Guest name
- Review date
- Likelihood score badge (color coded: red < 30, yellow 30-69, green >= 70)
- High priority indicator (flame icon)

### 3. `DisputeDetailSheet.tsx` - Review Detail Sheet

Full detail view when a card is clicked.

**Sections:**
1. **Header** - Property name, guest, date, rating, platform
2. **Review Text** - Full review with category ratings
3. **AI Analysis** (if analyzed)
   - Likelihood score with progress bar
   - Violation category badge
   - Case file preview
   - Conversation flags (threats, pressure, refund demands)
4. **Message History** (if fetched)
   - Scrollable chat-style view of guest-host messages
   - Timestamp and sender for each message
5. **Case File** (if analyzed)
   - Editable text area with pre-written dispute
   - Category reason field
   - Dispute description field
6. **Actions**
   - "Analyze" button (if not analyzed)
   - "Fetch Conversation" button (if no messages)
   - "Move to Submit Claim" / "Move to Not Eligible"
   - Link to Airbnb dispute form
   - "Mark as Submitted" button
   - Resolution dropdown (removed/denied)

### 4. Updates to `AIPromptsSettings.tsx`

Add a new tab for "Review Dispute" prompt configuration.

## Phase 4: Reviews Page Integration

### Updates to `Reviews.tsx`

1. Add new tab: "Airbnb Disputes" with Gavel icon
2. Tab content renders `DisputePipelineBoard`
3. Auto-populate triage:
   - On first load, find all Airbnb reviews with rating < 4 that have no `dispute_status`
   - Set their `dispute_status` to 'triage'

## Implementation Sequence

### Step 1: Database Migration
- Add new columns to `reviews` table
- Add index on `dispute_status` for query performance

### Step 2: Edge Function - fetch-dispute-conversation
- Guesty conversation API integration
- Message parsing and storage

### Step 3: Edge Function - analyze-review-dispute
- Lovable AI integration with tool calling
- Structured output parsing
- Review update logic

### Step 4: Frontend - DisputeCard Component
- Card display component

### Step 5: Frontend - DisputePipelineBoard Component
- Kanban board layout
- Drag-and-drop functionality
- Data fetching with React Query

### Step 6: Frontend - DisputeDetailSheet Component
- Full detail view
- Action buttons
- Case file editing

### Step 7: Reviews Page Integration
- New tab addition
- Auto-triage logic

### Step 8: Settings Page Integration
- Add dispute analysis prompt to AIPromptsSettings

## Data Flow

```text
1. Negative Airbnb review synced
          |
          v
2. User visits Disputes tab
          |
          v
3. Reviews with rating < 4 auto-added to Triage
          |
          v
4. User clicks "Analyze" on a card
          |
          v
5. Edge function fetches conversation (if available)
          |
          v
6. AI analyzes review + conversation
          |
          v
7. Review moves to Submit Claim or Not Eligible
          |
          v
8. User edits case file if needed
          |
          v
9. User opens Airbnb link, submits, marks as Submitted
          |
          v
10. User tracks through Pending -> Resolved
```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/xxx.sql` | Create | Add dispute columns to reviews |
| `supabase/functions/fetch-dispute-conversation/index.ts` | Create | Guesty conversation fetcher |
| `supabase/functions/analyze-review-dispute/index.ts` | Create | AI dispute analysis |
| `src/components/DisputeCard.tsx` | Create | Kanban card component |
| `src/components/DisputePipelineBoard.tsx` | Create | Kanban board component |
| `src/components/DisputeDetailSheet.tsx` | Create | Detail sheet component |
| `src/pages/Reviews.tsx` | Modify | Add Disputes tab |
| `src/components/AIPromptsSettings.tsx` | Modify | Add dispute prompt tab |

## Drag-and-Drop Implementation

Since no drag-and-drop library is currently installed, we'll use a simple implementation:
- CSS-based drag visual feedback
- Native HTML5 drag events (draggable, onDragStart, onDragOver, onDrop)
- No external dependency needed for basic functionality

## Airbnb Dispute Link

The case file will include a direct link to:
`https://www.airbnb.com/resolution/review_dispute/intro?_entry=macro`

Users can copy the case file and paste it into Airbnb's form.

