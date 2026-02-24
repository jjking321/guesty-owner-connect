

# One-Time Import: Permit Numbers and Addresses from CSV

## What This Does
Imports the permit numbers and property addresses from the Brevard Tourism Tax CSV into the `listing_tax_settings` table, matching each CSV row to a listing by nickname.

## Matching Results
- **~180+ listings matched** by exact nickname
- Nicknames with multiple CSV rows (e.g. "400 S Atlantic Full" has 8 permits, "505 Fillmore #15" has 15) will use the **first** permit number from the CSV
- 2 CSV rows with empty nicknames will be skipped
- A few CSV nicknames (like "214 Lucerne") that don't match any listing will be skipped

## Technical Steps
1. Run a series of SQL `INSERT ... ON CONFLICT` statements against `listing_tax_settings`
2. Each statement maps a listing_id (looked up by nickname) to the CSV's permit_number and property_address
3. Existing rows will be updated; new rows will be created
4. Done in ~8 batches of ~25 rows each

No code changes needed -- this is purely a one-time database operation.

