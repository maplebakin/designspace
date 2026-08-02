import base64
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


VENDOR = pathlib.Path(__file__).parents[1] / "vendor"
sys.path.insert(0, str(VENDOR))

from ccl_chromium_reader.storage_formats import ccl_leveldb


class RecoveryFixtureTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="design-space-recovery-fixture-"))
        self.backup = self.root / "verified-backup"
        self.leveldb = self.backup / "source" / "leveldb"
        self.leveldb.mkdir(parents=True)
        self.exports = self.root / "exports"
        self.fixture = self.leveldb / "recovery-fixture.ndjson"
        self.script = pathlib.Path(__file__).parents[1] / "recover_indexeddb.py"

    def tearDown(self):
        shutil.rmtree(self.root)

    def write_fixture(self):
        image = "data:image/png;base64," + base64.b64encode(b"same-image-bytes").decode("ascii")

        def payload(name, timestamp, fill, duplicate_assets=True):
            assets = {"asset-a": image}
            objects = [{"type": "image", "id": "image-1", "src": "asset-a"}, {"type": "rect", "id": "shape", "fill": fill}]
            if duplicate_assets:
                assets["asset-b"] = image
                objects[0]["src"] = "asset-b"
            return {
                "projectName": name,
                "lastUpdated": timestamp,
                "canvasData": {"objects": objects},
                "canvasSize": {"width": 800, "height": 600},
                "assets": assets,
            }

        older = json.dumps(payload("Recovered Planner", "2026-01-01T00:00:00Z", "red"), separators=(",", ":"))
        newest = json.dumps(payload("Recovered Planner", "2026-02-01T00:00:00Z", "blue"), separators=(",", ":"))
        other = json.dumps(payload("Other Project", "2026-01-15T00:00:00Z", "green", False), separators=(",", ":"))
        rows = [
            {"store": "projects", "key": "p1", "seq": 1, "value": {"id": "p1", "name": "Recovered Planner", "lastModified": "2026-02-01T00:00:00Z"}},
            {"store": "projects", "key": "p2", "seq": 2, "value": {"id": "p2", "name": "Other Project", "lastModified": "2026-01-15T00:00:00Z"}},
            {"store": "canvasData", "key": "c1", "seq": 10, "value": {"id": "c1", "projectId": "p1", "jsonPayload": older}},
            {"store": "canvasData", "key": "c1", "seq": 11, "value": {"id": "c1", "projectId": "p1", "jsonPayload": older}},
            {"store": "canvasData", "key": "c1", "seq": 12, "value": {"id": "c1", "projectId": "p1", "jsonPayload": newest}},
            {"store": "canvasData", "key": "c1", "seq": 13, "value": {"id": "c1", "projectId": "p1", "jsonPayload": "{corrupt newest"}},
            {"store": "canvasData", "key": "c2", "seq": 20, "value": {"id": "c2", "projectId": "p2", "jsonPayload": other}},
            "this row is corrupt",
        ]
        with self.fixture.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write((json.dumps(row) if isinstance(row, dict) else row) + "\n")

    def test_dry_run_preserves_fixture_and_recovers_deduplicated_projects(self):
        self.write_fixture()
        before = hashlib.sha256(self.fixture.read_bytes()).hexdigest()
        result = subprocess.run(
            [
                "python3", str(self.script),
                "--backup-root", str(self.backup),
                "--export-root", str(self.exports),
                "--source-profile", "Google Chrome / Default",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(hashlib.sha256(self.fixture.read_bytes()).hexdigest(), before)

        report = json.loads((self.exports / "recovery-report.json").read_text())
        self.assertEqual(report["projectsFound"], 2)
        self.assertEqual(report["projectsRecovered"], 2)
        self.assertGreaterEqual(report["duplicateRevisionsRemoved"], 1)
        self.assertGreaterEqual(report["assetsDeduplicated"], 1)
        self.assertGreaterEqual(report["crossProjectDuplicateAssets"], 1)
        self.assertGreaterEqual(report["corruptRecords"], 2)
        self.assertEqual(report["peakRecordLimitBytes"], 128 * 1024 * 1024)

        exports = sorted((self.exports / "projects").glob("*.apocaproject.json"))
        self.assertEqual(len(exports), 2)
        planner = next(json.loads(path.read_text()) for path in exports if "recovered-planner" in path.name)
        self.assertEqual(planner["schemaVersion"], "design-space-project-v2")
        self.assertEqual(planner["canvasData"]["objects"][1]["fill"], "blue")
        self.assertEqual(len(planner["assets"]), 1)
        self.assertEqual(planner["canvasData"]["objects"][0]["src"], "asset-a")
        self.assertTrue(planner["recovery"]["complete"])
        self.assertEqual(planner["recovery"]["sourceBrowserProfile"], "Google Chrome / Default")
        self.assertTrue(report["projects"][0]["complete"])
        self.assertTrue(any(item["usedOlderRevisionBecauseNewerWasCorrupt"] for item in report["projects"]))
        self.assertTrue((self.exports / "forensic" / "corrupt-records.jsonl").exists())

    def test_leveldb_table_indexes_are_loaded_lazily(self):
        table = self.root / "000001.ldb"
        footer = b"\0\0\0\0" + (b"\0" * 36) + ccl_leveldb.LdbFile.MAGIC.to_bytes(8, "little")
        table.write_bytes(footer)

        class FakeBlock(list):
            was_compressed = False
            offset = 0

        index = FakeBlock([
            ccl_leveldb.RawBlockEntry(
                key=b"index",
                value=b"\0\0",
                block_offset=0,
            )
        ])
        data = FakeBlock([
            ccl_leveldb.RawBlockEntry(
                key=b"k" + (b"\0" * 8),
                value=b"value",
                block_offset=0,
            )
        ])
        with mock.patch.object(
            ccl_leveldb.LdbFile,
            "_read_block",
            side_effect=[index, data],
        ) as read_block:
            ldb = ccl_leveldb.LdbFile(table)
            self.assertEqual(read_block.call_count, 0)
            records = list(ldb)
            self.assertEqual(read_block.call_count, 2)
            self.assertEqual(records[0].value, b"value")
            ldb.close()

    def test_document_recovery_validates_pages_groups_ids_and_assets(self):
        image = "data:image/png;base64," + base64.b64encode(b"document-image").decode("ascii")
        document = {
            "schemaVersion": 4,
            "language": "de",
        }
        page = {
            "kind": "document",
            "id": "page-49",
            "name": "Page 49",
            "titleContent": {"type": "doc", "content": [{"type": "paragraph"}]},
            "bodyContent": {"type": "doc", "content": [
                {"type": "documentFlowImage", "attrs": {"id": "duplicate", "assetId": "photo", "wrap": "span-columns", "verticalAnchor": "page-position"}},
                {"type": "documentFlowImage", "attrs": {"id": "duplicate", "assetId": "missing", "wrap": "span-columns", "verticalAnchor": "page-position"}},
            ]},
            "imageGroups": [{"id": "row", "kind": "row", "childImageIds": ["duplicate", "duplicate", "missing"], "gapPx": 900}],
            "overlayObjects": [],
        }
        payload = {
            "editorMode": "document",
            "projectId": "document-project",
            "projectName": "Historical document",
            "document": document,
            "pages": [page, {**page, "id": "page-50", "name": "Page 50"}],
            "assets": {"photo": image},
        }
        with self.fixture.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps({"store": "projects", "key": "document-project", "seq": 1, "value": {"id": "document-project", "name": "Historical document"}}) + "\n")
            handle.write(json.dumps({"store": "canvasData", "key": "document-canvas", "seq": 2, "value": {"id": "document-canvas", "projectId": "document-project", "jsonPayload": json.dumps(payload)}}) + "\n")

        result = subprocess.run(
            [
                "python3", str(self.script),
                "--backup-root", str(self.backup),
                "--export-root", str(self.exports),
                "--source-profile", "Google Chrome / Default",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        recovered_path = next((self.exports / "projects").glob("*.apocaproject.json"))
        recovered = json.loads(recovered_path.read_text())
        self.assertEqual(recovered["document"]["schemaVersion"], 5)
        self.assertEqual(len(recovered["pages"]), 2)
        ids = [
            node["attrs"]["id"]
            for node in recovered["pages"][0]["bodyContent"]["content"]
        ]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("assetMetadata", recovered)
        self.assertTrue(recovered["recovery"]["complete"])
        self.assertTrue(any("Missing referenced assets" in warning for warning in recovered["recovery"]["validationWarnings"]))


if __name__ == "__main__":
    unittest.main()
