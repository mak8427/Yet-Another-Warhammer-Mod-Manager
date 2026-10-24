#!/usr/bin/env python3
"""Generate hash-pinned Nix/Gentoo installers from the exact release tarball."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import tarfile


def render(tarball, out, version, repository):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("version must be X.Y.Z")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("repository must be owner/name")
    expected = f"wh3mm-{version}-linux-x86_64.tar.gz"
    if tarball.name != expected:
        raise ValueError(f"expected tarball named {expected}")
    data = tarball.read_bytes()
    root = Path(__file__).resolve().parents[1]
    url = f"https://github.com/{repository}/releases/download/v{version}/{expected}"
    replacements = {"@VERSION@": version, "@URL@": url, "@SHA256@": hashlib.sha256(data).hexdigest()}
    nix = out / "nix"
    gentoo = out / "gentoo"
    (gentoo / "profiles").mkdir(parents=True, exist_ok=True)
    (gentoo / "metadata").mkdir(exist_ok=True)
    package = gentoo / "games-util/wh3mm-bin"
    package.mkdir(parents=True, exist_ok=True)
    nix.mkdir(parents=True, exist_ok=True)
    for template, target in [
        (root / "nix/default.nix.in", nix / "default.nix"),
        (root / "gentoo/wh3mm-bin.ebuild.in", package / f"wh3mm-bin-{version}.ebuild"),
    ]:
        content = template.read_text()
        for key, value in replacements.items():
            content = content.replace(key, value)
        target.write_text(content)
    shutil.copyfile(root / "nix/flake.nix", nix / "flake.nix")
    (gentoo / "profiles/repo_name").write_text("wh3mm\n")
    (gentoo / "metadata/layout.conf").write_text("masters = gentoo\nthin-manifests = true\n")
    (package / "Manifest").write_text(
        f"DIST {expected} {len(data)} BLAKE2B {hashlib.blake2b(data).hexdigest()} SHA512 {hashlib.sha512(data).hexdigest()}\n"
    )
    for name, directory in [("nix", nix), ("gentoo", gentoo)]:
        with tarfile.open(out / f"wh3mm-{name}-{version}.tar.gz", "w:gz") as archive:
            archive.add(directory, arcname=f"wh3mm-{name}-{version}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("tarball", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--repository", default="mak8427/Warhammer_mod_manager")
    args = parser.parse_args()
    render(args.tarball, args.output, args.version, args.repository)
