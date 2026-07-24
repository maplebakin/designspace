#!/usr/bin/env python3
"""Read-only Design Space IndexedDB recovery from a verified backup.

The real database path is never accepted by this process. The Tauri backend
passes the `source/leveldb` directory inside a verified backup. A small NDJSON
fixture adapter is supported for deterministic tests; production LevelDB files
are decoded by the vendored CCL Chromium forensic reader.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import itertools
import json
import os
import pathlib
import re
import resource
import sys
import traceback
from collections.abc import Iterable
from typing import Any

MAX_RECORD_CHARS = 128 * 1024 * 1024
MAX_ASSET_HASH_CHARS = 112 * 1024 * 1024
MAX_REPORT_DETAILS = 10_000
MEMORY_LIMIT_BYTES = 1536 * 1024 * 1024
VENDOR = pathlib.Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR))


def emit(event: str, **payload: Any) -> None:
    print(json.dumps({"event": event, **payload}, separators=(",", ":")), flush=True)


def json_default(value: Any) -> Any:
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return {"__bytes__": base64.b64encode(value[:4096]).decode("ascii"), "truncated": len(value) > 4096}
    return str(value)


def append_jsonl(path: pathlib.Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, default=json_default, separators=(",", ":")) + "\n")


def add_report_detail(report: dict[str, Any], key: str, value: dict[str, Any]) -> None:
    details = report[key]
    if len(details) < MAX_REPORT_DETAILS:
        details.append(value)
    elif len(details) == MAX_REPORT_DETAILS:
        report["warnings"].append(
            f"{key} details were capped at {MAX_REPORT_DETAILS}; the forensic JSONL files and verified backup retain the remaining evidence."
        )
        details.append({"detailsCapped": True})


def parse_time(value: Any) -> float:
    if isinstance(value, dt.datetime):
        return value.timestamp()
    if not isinstance(value, str) or not value:
        return 0.0
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, OverflowError):
        return 0.0


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "untitled-project"


def iter_fixture_records(path: pathlib.Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError("record is not an object")
                record.setdefault("origin_file", f"{path.name}:{line_number}")
                record.setdefault("seq", line_number)
                record.setdefault("is_live", True)
                yield record
            except Exception as error:  # isolate a single corrupt fixture row
                yield {
                    "store": "__decode_error__",
                    "seq": line_number,
                    "origin_file": f"{path.name}:{line_number}",
                    "error": str(error),
                    "raw_fragment": line[:4096],
                }


def iter_chromium_records(
    leveldb: pathlib.Path,
    blob: pathlib.Path | None,
    forensic: pathlib.Path,
    store_names: tuple[str, ...],
) -> Iterable[dict[str, Any]]:
    from ccl_chromium_reader import ccl_chromium_indexeddb

    def bad_record(key: Any, raw: bytes) -> None:
        append_jsonl(forensic / "corrupt-record-fragments.jsonl", {
            "key": str(key),
            "raw_prefix_base64": base64.b64encode(raw[:4096]).decode("ascii"),
            "raw_bytes": len(raw),
            "note": "Full bytes remain in the verified backup.",
        })

    wrapper = ccl_chromium_indexeddb.WrappedIndexDB(leveldb, blob if blob and blob.is_dir() else None)
    try:
        for db_meta in wrapper.database_ids:
            database = wrapper[db_meta.dbid_no]
            if database.name != "DesignSpaceDB":
                continue
            if "projects" in store_names:
                yield {
                    "store": "__inventory__",
                    "value": {
                        "database": database.name,
                        "objectStores": list(database.object_store_names),
                    },
                    "seq": 0,
                    "origin_file": str(leveldb),
                    "is_live": True,
                }
            for store_name in store_names:
                if store_name not in database:
                    continue
                store = database[store_name]
                for record in store.iterate_records(
                    live_only=False,
                    bad_deserializer_data_handler=bad_record,
                ):
                    yield {
                        "store": store_name,
                        "key": str(record.key.value),
                        "value": record.value,
                        "is_live": record.is_live,
                        "seq": record.ldb_seq_no,
                        "origin_file": str(record.origin_file),
                    }
    finally:
        wrapper.close()


def hash_data_url(value: str) -> tuple[str, int] | None:
    if not value.startswith("data:") or "," not in value:
        return None
    header, encoded = value.split(",", 1)
    digest = hashlib.sha256()
    decoded_bytes = 0
    if ";base64" not in header:
        raw = encoded.encode("utf-8")
        digest.update(raw)
        return digest.hexdigest(), len(raw)
    if len(encoded) > MAX_ASSET_HASH_CHARS:
        return None
    chunk_chars = 1024 * 1024
    for offset in range(0, len(encoded), chunk_chars):
        chunk = encoded[offset:offset + chunk_chars]
        if offset + chunk_chars < len(encoded):
            chunk = chunk[:len(chunk) - (len(chunk) % 4)]
        try:
            raw = base64.b64decode(chunk, validate=False)
        except Exception:
            return None
        digest.update(raw)
        decoded_bytes += len(raw)
    return digest.hexdigest(), decoded_bytes


def replace_asset_refs(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {key: replace_asset_refs(child, replacements) for key, child in value.items()}
    if isinstance(value, list):
        return [replace_asset_refs(child, replacements) for child in value]
    if isinstance(value, str) and value in replacements:
        return replacements[value]
    return value


def validate_and_migrate(payload: Any, project_id: str, fallback_name: str, recovered_at: str) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(payload, dict):
        raise ValueError("payload is not a JSON object")
    warnings: list[str] = []
    name = str(payload.get("projectName") or payload.get("metadata", {}).get("name") or fallback_name or "Recovered Project").strip()
    pages = payload.get("pages")
    canvas_data = payload.get("canvasData")
    if pages is not None and not isinstance(pages, list):
        raise ValueError("pages is not an array")
    if not pages:
        if not isinstance(canvas_data, dict) or not isinstance(canvas_data.get("objects"), list):
            raise ValueError("project has no valid canvas page or canvasData objects array")
        pages = [{
            "kind": "canvas",
            "id": "recovered-page-1",
            "name": "Page 1",
            "canvasData": canvas_data,
            "canvasSize": payload.get("canvasSize") or {"width": 2550, "height": 3300},
        }]
        warnings.append("Migrated legacy root canvasData into a v2 page.")
    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            raise ValueError(f"page {index + 1} is not an object")
        page.setdefault("kind", "canvas")
        if page.get("kind") == "canvas":
            data = page.get("canvasData")
            if data is not None and (not isinstance(data, dict) or not isinstance(data.get("objects"), list)):
                raise ValueError(f"page {index + 1} has invalid Fabric canvas data")
    mode = payload.get("editorMode") if payload.get("editorMode") in ("canvas", "document") else "canvas"
    if mode == "document" and not any(isinstance(page, dict) and page.get("kind") == "document" for page in pages):
        raise ValueError("document project has no document pages")
    updated = payload.get("updatedAt") or payload.get("lastUpdated") or recovered_at
    migrated = dict(payload)
    migrated.update({
        "schemaVersion": "design-space-project-v2",
        "editorMode": mode,
        "projectId": str(payload.get("projectId") or project_id),
        "projectName": name,
        "updatedAt": updated,
        "lastUpdated": payload.get("lastUpdated") or updated,
        "pages": pages,
    })
    metadata = dict(payload.get("metadata")) if isinstance(payload.get("metadata"), dict) else {}
    metadata.update({"name": name, "sourceApp": "design-space"})
    migrated["metadata"] = metadata
    if not isinstance(migrated.get("document"), dict):
        size = payload.get("canvasSize") if isinstance(payload.get("canvasSize"), dict) else {"width": 2550, "height": 3300}
        migrated["document"] = {
            "pageSize": {
                "width": size.get("width", 2550),
                "height": size.get("height", 3300),
                "unitMode": payload.get("unitMode", "in"),
                "dpi": 300,
            },
            "background": {"value": "#FAF8F5"},
        }
        warnings.append("Added v2 document metadata required by the portable format.")
    return migrated, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup-root", required=True)
    parser.add_argument("--export-root", required=True)
    parser.add_argument("--source-profile", required=True)
    args = parser.parse_args()

    try:
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
    except (ValueError, OSError):
        pass

    backup_root = pathlib.Path(args.backup_root).resolve()
    export_root = pathlib.Path(args.export_root).resolve()
    leveldb = backup_root / "source" / "leveldb"
    blob = backup_root / "source" / "blob"
    fixture = backup_root / "source" / "recovery-fixture.ndjson"
    if not fixture.is_file():
        fixture = leveldb / "recovery-fixture.ndjson"
    if not leveldb.is_dir() and not fixture.is_file():
        raise SystemExit("Verified backup has neither source/leveldb nor a recovery fixture.")

    recovered_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    projects_dir = export_root / "projects"
    forensic_dir = export_root / "forensic"
    staging_dir = export_root / ".recovery-staging"
    projects_dir.mkdir(parents=True, exist_ok=True)
    forensic_dir.mkdir(parents=True, exist_ok=True)
    staging_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {
        "version": 1,
        "sourceProfile": args.source_profile,
        "backupRoot": str(backup_root),
        "exportRoot": str(export_root),
        "recoveredAt": recovered_at,
        "recordsScanned": 0,
        "projectsFound": 0,
        "projectsRecovered": 0,
        "projectsSkipped": 0,
        "corruptRecords": 0,
        "duplicateRevisionsRemoved": 0,
        "distinctRevisionsSuperseded": 0,
        "assetsHashed": 0,
        "assetsDeduplicated": 0,
        "crossProjectDuplicateAssets": 0,
        "estimatedDuplicateAssetBytes": 0,
        "originalBackupBytes": 0,
        "recoveredExportBytes": 0,
        "peakRecordLimitBytes": MAX_RECORD_CHARS,
        "storesObserved": [],
        "nonProjectStoresSkipped": [],
        "thumbnailsFound": 0,
        "thumbnailBytesExcluded": 0,
        "projects": [],
        "failures": [],
        "warnings": [],
    }
    for root, _, files in os.walk(backup_root / "source"):
        for filename in files:
            try:
                report["originalBackupBytes"] += (pathlib.Path(root) / filename).stat().st_size
            except OSError:
                pass

    metadata: dict[str, dict[str, Any]] = {}
    selected: dict[str, dict[str, Any]] = {}
    seen_revision_hashes: dict[str, set[str]] = {}
    global_assets: dict[str, tuple[str, int]] = {}

    emit("phase", phase="scan-indexeddb", message="Scanning IndexedDB records from the verified backup.")

    # Use two bounded passes. Metadata is small and retained by stable project
    # ID; canvas revisions are decoded and released one record at a time.
    recovery_records = iter(
        iter_fixture_records(fixture)
        if fixture.is_file()
        else iter_chromium_records(leveldb, blob, forensic_dir, ("projects", "canvasData"))
    )
    first_canvas_record = None
    metadata_records = recovery_records
    for record in metadata_records:
        if record.get("store") == "canvasData":
            first_canvas_record = record
            break
        report["recordsScanned"] += 1
        if report["recordsScanned"] % 100 == 0:
            emit("progress", recordsScanned=report["recordsScanned"], projectsRecovered=report["projectsRecovered"])
        if record.get("store") == "__decode_error__":
            report["corruptRecords"] += 1
            append_jsonl(forensic_dir / "corrupt-record-fragments.jsonl", record)
            continue
        if record.get("store") == "__inventory__":
            stores = record.get("value", {}).get("objectStores", [])
            report["storesObserved"] = stores
            report["nonProjectStoresSkipped"] = [
                store for store in stores if store not in ("projects", "canvasData")
            ]
            continue
        value = record.get("value")
        if record.get("store") == "projects" and isinstance(value, dict):
            project_id = str(value.get("id") or record.get("key") or "")
            if project_id and int(record.get("seq", 0)) >= int(metadata.get(project_id, {}).get("_seq", -1)):
                cleaned = dict(value)
                thumbnail = cleaned.pop("thumbnail", None)
                if isinstance(thumbnail, str):
                    report["thumbnailsFound"] += 1
                    report["thumbnailBytesExcluded"] += len(thumbnail.encode("utf-8"))
                metadata[project_id] = {**cleaned, "_seq": int(record.get("seq", 0))}
            continue
    canvas_records = itertools.chain(
        () if first_canvas_record is None else (first_canvas_record,),
        recovery_records,
    )
    emit("phase", phase="validate-projects", message="Validating and migrating recovered project revisions.")
    for record in canvas_records:
        report["recordsScanned"] += 1
        if report["recordsScanned"] % 100 == 0:
            emit("progress", recordsScanned=report["recordsScanned"], projectsRecovered=report["projectsRecovered"])
        value = record.get("value")
        location = str(record.get("origin_file", "unknown"))
        seq = int(record.get("seq", 0))
        if not isinstance(value, dict):
            report["corruptRecords"] += 1
            append_jsonl(forensic_dir / "corrupt-records.jsonl", {"location": location, "seq": seq, "reason": "canvasData value is not an object"})
            continue
        project_id = str(value.get("projectId") or "").strip()
        raw = value.get("jsonPayload")
        if not project_id or not isinstance(raw, str):
            report["corruptRecords"] += 1
            append_jsonl(forensic_dir / "corrupt-records.jsonl", {"location": location, "seq": seq, "reason": "missing projectId or jsonPayload"})
            continue
        if len(raw) > MAX_RECORD_CHARS:
            report["corruptRecords"] += 1
            add_report_detail(report, "failures", {"projectId": project_id, "location": location, "reason": "payload exceeds 128 MiB bounded-record limit", "bytes": len(raw)})
            continue
        payload_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        project_hashes = seen_revision_hashes.setdefault(project_id, set())
        if payload_hash in project_hashes:
            report["duplicateRevisionsRemoved"] += 1
            continue
        project_hashes.add(payload_hash)
        project_meta = metadata.get(project_id, {})
        fallback_name = str(project_meta.get("name") or f"Recovered {project_id[:8]}")
        try:
            decoded = json.loads(raw)
            migrated, warnings = validate_and_migrate(decoded, project_id, fallback_name, recovered_at)
        except Exception as error:
            report["corruptRecords"] += 1
            append_jsonl(forensic_dir / "corrupt-records.jsonl", {
                "projectId": project_id,
                "location": location,
                "seq": seq,
                "payloadHash": payload_hash,
                "reason": str(error),
                "rawPrefix": raw[:4096],
                "fullRecordPreservedInBackup": True,
            })
            current = selected.get(project_id)
            if current is not None and seq > current["seq"]:
                current["newerCorruptRevision"] = True
            continue

        assets = migrated.get("assets") if isinstance(migrated.get("assets"), dict) else {}
        canonical_by_hash: dict[str, str] = {}
        replacements: dict[str, str] = {}
        asset_warnings: list[str] = []
        for asset_id, source in list(assets.items()):
            if not isinstance(source, str):
                asset_warnings.append(f"Asset {asset_id} was not a string and was preserved for import validation.")
                continue
            hashed = hash_data_url(source)
            if hashed is None:
                if source.startswith("data:"):
                    asset_warnings.append(f"Asset {asset_id} could not be hashed within the bounded asset limit; it was preserved.")
                continue
            digest, decoded_bytes = hashed
            report["assetsHashed"] += 1
            if digest in canonical_by_hash:
                replacements[str(asset_id)] = canonical_by_hash[digest]
                del assets[asset_id]
                report["assetsDeduplicated"] += 1
                report["estimatedDuplicateAssetBytes"] += decoded_bytes
            else:
                canonical_by_hash[digest] = str(asset_id)
            if digest in global_assets and global_assets[digest][0] != project_id:
                report["crossProjectDuplicateAssets"] += 1
                # Cross-file removal would break the existing portable format.
            else:
                global_assets[digest] = (project_id, decoded_bytes)
        if replacements:
            migrated = replace_asset_refs(migrated, replacements)
            migrated["assets"] = assets
        warnings.extend(asset_warnings)

        timestamp = parse_time(migrated.get("updatedAt")) or parse_time(project_meta.get("lastModified"))
        # LevelDB sequence is the authoritative revision order. Persisted
        # timestamps are a secondary signal because malformed historical
        # payloads may contain missing, stale, or user-edited dates.
        rank = (seq, timestamp, 1 if record.get("is_live") else 0)
        current = selected.get(project_id)
        if current is not None and rank <= current["rank"]:
            report["distinctRevisionsSuperseded"] += 1
            continue
        if current is not None:
            report["distinctRevisionsSuperseded"] += 1
        recovery_meta = {
            "originalProjectId": project_id,
            "originalTimestamp": migrated.get("updatedAt") or project_meta.get("lastModified"),
            "recoveredAt": recovered_at,
            "sourceBrowserProfile": args.source_profile,
            "sourceRecord": location,
            "sourceSequence": seq,
            "validationWarnings": warnings,
            "assetsDeduplicated": len(replacements),
            "complete": True,
            "payloadHash": payload_hash,
        }
        migrated["recovery"] = recovery_meta
        staging_path = staging_dir / f"{safe_slug(project_id)}.json"
        staging_temp = staging_path.with_suffix(".json.partial")
        with staging_temp.open("w", encoding="utf-8") as handle:
            json.dump(migrated, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        staging_temp.replace(staging_path)
        selected[project_id] = {
            "stagingPath": str(staging_path),
            "rank": rank,
            "seq": seq,
            "name": migrated["projectName"],
            "updatedAt": migrated.get("updatedAt") or recovered_at,
            "warnings": warnings,
            "assetsDeduplicated": len(replacements),
            "payloadHash": payload_hash,
            "source": location,
            "newerCorruptRevision": False,
        }

    report["projectsFound"] = len(set(metadata) | set(seen_revision_hashes))
    emit("phase", phase="write-exports", message="Writing validated portable project exports.")
    used_names: set[str] = set()
    for project_id in sorted(selected):
        item = selected[project_id]
        timestamp = str(item["updatedAt"])[:10]
        base = f"{safe_slug(item['name'])}-{safe_slug(project_id)[:16]}-{timestamp}.apocaproject.json"
        filename = base
        suffix = 2
        while filename in used_names or (projects_dir / filename).exists():
            filename = base.replace(".apocaproject.json", f"-{suffix}.apocaproject.json")
            suffix += 1
        used_names.add(filename)
        output_path = projects_dir / filename
        pathlib.Path(item["stagingPath"]).replace(output_path)
        size = output_path.stat().st_size
        report["recoveredExportBytes"] += size
        report["projectsRecovered"] += 1
        report["projects"].append({
            "projectId": project_id,
            "name": item["name"],
            "path": str(output_path),
            "bytes": size,
            "payloadHash": item["payloadHash"],
            "sourceRecord": item["source"],
            "warnings": item["warnings"],
            "assetsDeduplicated": item["assetsDeduplicated"],
            "usedOlderRevisionBecauseNewerWasCorrupt": item["newerCorruptRevision"],
            "complete": True,
        })

    report["projectsSkipped"] = max(0, report["projectsFound"] - report["projectsRecovered"])
    if report["crossProjectDuplicateAssets"]:
        report["warnings"].append("Identical assets across separate project files were reported but retained for portable-file compatibility.")
    try:
        staging_dir.rmdir()
    except OSError:
        pass
    emit("phase", phase="recovery-report", message="Generating the recovery report.")
    report_path = export_root / "recovery-report.json"
    report_path.write_text(json.dumps(report, indent=2, default=json_default), encoding="utf-8")
    emit("complete", reportPath=str(report_path), **{key: report[key] for key in (
        "recordsScanned", "projectsFound", "projectsRecovered", "projectsSkipped",
        "corruptRecords", "duplicateRevisionsRemoved", "assetsDeduplicated",
    )})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        message = f"{type(error).__name__}: {error}".rstrip()
        emit("fatal", message=message, traceback=traceback.format_exc(limit=12))
        raise SystemExit(1)
