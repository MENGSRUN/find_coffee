"""Create a local CA and IP certificate. Never installs trust or exposes private keys."""

import argparse
import ipaddress
import os
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ip", type=ipaddress.ip_address, help="Computer's Wi-Fi/LAN IP address")
    args = parser.parse_args()
    root = Path(".local-tls")
    if root.exists():
        parser.error(
            ".local-tls already exists; reuse its certificates or move it before regenerating"
        )
    os.umask(0o077)
    root.mkdir(mode=0o700)
    public = root / "public"
    public.mkdir()

    def run(*options):
        subprocess.run(["openssl", *options], check=True, capture_output=True)

    run(
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "365",
        "-keyout",
        str(root / "ca.key"),
        "-out",
        str(public / "coffee-local-ca.crt"),
        "-subj",
        "/CN=Find Coffee Local Development CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE,pathlen:0",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
    )
    run(
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(root / "server.key"),
        "-out",
        str(root / "server.csr"),
        "-subj",
        "/CN=Find Coffee Local",
    )
    extensions = root / "server.ext"
    extensions.write_text(
        "basicConstraints=critical,CA:FALSE\n"
        "keyUsage=critical,digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n"
        f"subjectAltName=IP:{args.ip},IP:127.0.0.1,DNS:localhost\n"
    )
    run(
        "x509",
        "-req",
        "-in",
        str(root / "server.csr"),
        "-CA",
        str(public / "coffee-local-ca.crt"),
        "-CAkey",
        str(root / "ca.key"),
        "-CAcreateserial",
        "-out",
        str(root / "server.crt"),
        "-days",
        "30",
        "-sha256",
        "-extfile",
        str(extensions),
    )
    print(f"Created certificates for https://{args.ip}:8443")
    print("Install only .local-tls/public/coffee-local-ca.crt on your phone.")
    print("Keep ca.key and server.key on this computer; see docs/PHONE.md.")


if __name__ == "__main__":
    main()
