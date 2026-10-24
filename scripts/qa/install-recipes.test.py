"""Exercise release recipe generation with a real tarball and checksum validation."""
import hashlib
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import sys
import unittest

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("recipes", ROOT / "packaging/linux/render-recipes.py")
recipes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipes)


class ReleaseRecipes(unittest.TestCase):
    def test_installers_pin_the_exact_tarball_bytes(self):
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            payload = work / "wh3mm-1.2.3-linux-x86_64"
            payload.mkdir()
            (payload / "wh3mm").write_bytes(b"synthetic executable")
            tarball = work / "wh3mm-1.2.3-linux-x86_64.tar.gz"
            with tarfile.open(tarball, "w:gz") as archive:
                archive.add(payload, arcname=payload.name)
            out = work / "out"
            recipes.render(tarball, out, "1.2.3", "owner/repo")
            data = tarball.read_bytes()
            nix = (out / "nix/default.nix").read_text()
            self.assertIn(hashlib.sha256(data).hexdigest(), nix)
            self.assertIn("https://github.com/owner/repo/releases/download/v1.2.3/", nix)
            manifest = (out / "gentoo/games-util/wh3mm-bin/Manifest").read_text()
            self.assertIn(hashlib.blake2b(data).hexdigest(), manifest)
            self.assertIn(hashlib.sha512(data).hexdigest(), manifest)
            self.assertIn(f" {len(data)} BLAKE2B ", manifest)
            for name in ["nix", "gentoo"]:
                with tarfile.open(out / f"wh3mm-{name}-1.2.3.tar.gz") as archive:
                    self.assertTrue(all(n.startswith(f"wh3mm-{name}-1.2.3") for n in archive.getnames()))
            self.assertNotIn("@", nix)

    def test_rejects_version_url_and_filename_mismatches(self):
        with tempfile.TemporaryDirectory() as work:
            work = Path(work)
            for version, repository, filename in [
                ("1.2", "owner/repo", "x"),
                ("1.2.3", "owner/repo;echo nope", "x"),
                ("1.2.3", "owner/repo", "wrong.tar.gz"),
            ]:
                with self.assertRaises(ValueError):
                    recipes.render(work / filename, work / "out", version, repository)


if __name__ == "__main__":
    unittest.main()
