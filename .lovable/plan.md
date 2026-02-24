

# Re-import Updated Tax Permit Numbers from CSV

## What Changed
You updated the CSV so that nicknames now match your listings (1:1 where possible). This updated file has 237 rows with data (2 have empty nicknames and will be skipped).

## What Needs to Happen
Run the same upsert operation as before, but with the updated CSV data. This will:
- Update permit numbers and property addresses for all matched listings
- Overwrite any previously imported values with the corrected ones
- Skip the 2 rows with empty nicknames (lines 23 and 48)
- For duplicate nicknames (e.g. "1145 S Atlantic #B", "CC-507", "214 Lucerne", "RFI-709"), use the first occurrence

## Technical Details
- Execute 5 batches of `INSERT ... ON CONFLICT` SQL against `listing_tax_settings`
- Match on `listings.nickname` (exact match) joined to active listings
- Upsert `permit_number` and `property_address` for each match
- Organization ID: `3bd3e141-5af9-4377-a060-f4786c1a742b`

No code changes needed -- this is a one-time database write operation using the migration tool.

