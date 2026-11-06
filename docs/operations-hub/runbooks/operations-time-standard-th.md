# Operations Hub time standard

Operations Hub uses one time model throughout the application:

- **Storage and API:** UTC timestamps as ISO 8601 instants, preferably with a `Z` suffix.
- **Web display:** `Asia/Bangkok` (`UTC+07:00`) using the browser's timezone formatter.

This represents the same moment without ambiguity. The UI must not add seven hours manually after parsing an API timestamp. The previous legacy display switch was removed because it could apply the Bangkok offset twice and make the displayed time incorrect.

Do not bulk-rewrite SharePoint timestamps to Bangkok wall-clock values. Existing migration notes identify ambiguous legacy records that require record-level evidence before any data migration. If a storage correction is needed, keep the corrected value as a canonical UTC instant and verify it against the source event time.

## Verification

From `operations-ui/`:

```text
npm run build
```

The build must complete before publishing. API/SharePoint data remains read-only for this display fix.
