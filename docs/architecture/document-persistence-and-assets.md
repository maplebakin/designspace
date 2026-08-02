# Document persistence, assets, and recovery

The canonical persisted project is the normalized Zustand document payload.
Document pages contain stories, settings, image groups, and overlay/reference
records; `assets` contains source strings and `assetMetadata` contains bounded
content fingerprints and import metadata. The nested document schema is v5.
Older pages are normalized through the existing schema chain and receive empty
group metadata, canonical image geometry, named styles, drop-cap settings, and
asset metadata without changing unknown portable fields.

Asset sources are referenced by stable IDs from image nodes, overlays, and
reference scans. `src/document/model/documentAssets.ts` traverses every page
story and page-owned visual record to compute reachability. Identical imported
data URLs reuse the first canonical asset ID. Save, bounded autosave, and
portable download compact unreachable asset entries. Missing references are
visible in the editor; printable export refuses to emit a blank image and
reports the missing count.

The IndexedDB `projects` row points to exactly one canonical `canvasDataId`.
`DesignSpaceDB.updateProject` updates that row by primary key. It does not use
`where(projectId).modify`, which could rewrite superseded duplicate rows on
every autosave. `getProjectStorageDiagnostics` reports duplicate rows without
destroying forensic evidence. Startup gates, verified backup requirements, and
cleanup confirmation remain unchanged.

The Python recovery reader hashes data-URL assets with SHA-256, deduplicates
identical assets within each portable payload, repairs malformed IDs and group
membership, reports missing references, and validates current multi-page
document pages. Rust validates the generated report and deep-checks recovered
document schema, page stories, and group shape before recovery is considered
complete. Unknown fields are retained for a future schema migration.
