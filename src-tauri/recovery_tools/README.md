# Design Space IndexedDB recovery reader

`recover_indexeddb.py` is launched only by the constrained Tauri recovery
commands and only after `backup-manifest.json` has passed full SHA-256
verification. It never receives the live Chrome profile path.

The Chromium-aware decoder is the minimal IndexedDB dependency set vendored
from CCL Forensics' MIT-licensed projects:

- `ccl_chromium_reader` commit `9639a318ce0f7b546e1d8d02d89423ab6b4ae202`
- `ccl_simplesnappy` commit `3d085230baa8c46cf2090ebba29bf6e8eab31087`

The upstream license texts are stored beside the vendor packages. Three local
safety adaptations are intentionally maintained:

1. IndexedDB raw records are exposed through a reusable streaming iterable
   instead of caching the entire LevelDB in Python memory.
2. LevelDB manifest parsing is disabled. Recovery consumes immutable `.ldb`,
   `.sst`, and `.log` records directly; the damaged Design Space database has a
   multi-gigabyte manifest that is not needed to recover record values.
3. LevelDB table indexes are decompressed lazily, one immutable table at a
   time. Retaining every decoded index multiplied a large recovery copy into
   more than the process memory ceiling before any project record was yielded.
   Chromium metadata is collected in the same bounded table pass, and one
   wrapper is reused for the project and canvas stores.

The process also has a 1.5 GiB address-space ceiling, a 128 MiB decoded-record
boundary, streaming asset hashes, capped in-memory report details, and
forensic JSONL output for isolated failures. Full raw evidence always remains
in the verified backup.
