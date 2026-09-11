"""Print a fresh VAPID key pair for Web Push, in .env format.

Runs inside the backend container, where py_vapid is a runtime dependency. The
Makefile pipes this file over stdin, so it does not need to exist in the image:

    docker compose exec -T backend python < scripts/generate-vapid-keys.py

The public key is the uncompressed P-256 point (0x04 || X || Y), base64url without
padding — the format browsers expect as applicationServerKey.
"""
import base64

from py_vapid import Vapid


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


vapid = Vapid()
vapid.generate_keys()
private = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
point = vapid.private_key.public_key().public_numbers()
public = b"\x04" + point.x.to_bytes(32, "big") + point.y.to_bytes(32, "big")

print(f"VAPID_PRIVATE_KEY={b64url(private)}")
print(f"VAPID_PUBLIC_KEY={b64url(public)}")
