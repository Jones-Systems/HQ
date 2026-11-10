"""Checked-in fixtures must be reproducible from the actual HTTP service."""
import hashlib
import importlib.util
import socket
import unittest

from support import ROOT


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "contract" / f"{name}.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


class ContractDrift(unittest.TestCase):
    def test_reference_vector_generation_has_no_drift(self):
        # Byte-exact: tools/hq-cli pins this file's SHA-256.
        self.assertEqual(module("build_vectors").rendered(), (ROOT / "contract/reference-vectors.json").read_text())

    def test_real_http_exchanges_have_no_drift(self):
        generator = module("generate")
        expected = {path.name: path.read_text() for path in (ROOT / "contract/exchanges").glob("*.json")}
        self.assertTrue(expected, "Golden exchanges must exist")
        self.assertEqual(generator.rendered(generator.capture()), expected)

    def test_manifest_pins_every_shared_json_file(self):
        folder = ROOT / "contract"
        expected = [(str(path.relative_to(folder)), hashlib.sha256(path.read_bytes()).hexdigest())
                    for path in [folder / "reference-vectors.json", *sorted((folder / "exchanges").glob("*.json"))]]
        actual = []
        for line in (folder / "SHA256SUMS").read_text().splitlines():
            digest, path = line.split("  ", 1)
            actual.append((path, digest))
        self.assertEqual(actual, expected)
        files = {path.name: path.read_text() for path in (folder / "exchanges").glob("*.json")}
        self.assertEqual(module("generate").manifest(files), (folder / "SHA256SUMS").read_text())

    def test_disposable_service_cleanup_on_failure_and_interrupt(self):
        generator = module("generate")
        scratch = ROOT / "tests/.scratch"
        before = set(scratch.iterdir()) if scratch.exists() else set()
        for failure in (RuntimeError, KeyboardInterrupt):
            with self.subTest(failure=failure.__name__), self.assertRaises(failure):
                with generator.service() as port:
                    raise failure("synthetic cancellation")
            with self.assertRaises(OSError):
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    self.fail("Disposable service still accepts connections")
            self.assertEqual(set(scratch.iterdir()) if scratch.exists() else set(), before)
