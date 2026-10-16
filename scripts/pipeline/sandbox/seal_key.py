"""Hand AUDIO_KEY to a sandbox without the key ever appearing in an agent's transcript.

The sandbox makes a one-time RSA key pair and prints only the public half. The agent's own machine,
which holds the key in a file, encrypts it for that public key and prints the sealed blob; the blob
is useless without the private half, which never leaves the sandbox. The sandbox then opens the
blob and runs one command with AUDIO_KEY in its environment.

    # 1. in the sandbox
    python3 scripts/pipeline/sandbox/seal_key.py init                 → prints PUB=<base64>
    # 2. on the agent's machine (the key file is read, never printed)
    python3 scripts/pipeline/sandbox/seal_key.py seal <PUB> <key-file> → prints SEALED=<base64>
    # 3. in the sandbox
    python3 scripts/pipeline/sandbox/seal_key.py run <SEALED> -- python3 scripts/pipeline/decrypt_audio.py <slug>

`run` deletes the private key afterwards (pass --keep to reuse it for several commands), so a
persistent sandbox snapshot never holds anything that could open the blob.
"""
from __future__ import annotations

import base64
import os
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

PRIVATE = Path('/tmp/seal/private.pem')
OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


def init() -> None:
    PRIVATE.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(PRIVATE.parent, 0o700)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    PRIVATE.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chmod(PRIVATE, 0o600)
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    print('PUB=' + base64.b64encode(pub).decode())


def seal(pub_b64: str, key_file: str) -> None:
    pub = serialization.load_der_public_key(base64.b64decode(pub_b64.removeprefix('PUB=')))
    secret = Path(key_file).read_text(encoding='utf-8').strip().encode()
    print('SEALED=' + base64.b64encode(pub.encrypt(secret, OAEP)).decode())


def run(sealed_b64: str, cmd: list[str], keep: bool) -> int:
    key = serialization.load_pem_private_key(PRIVATE.read_bytes(), password=None)
    secret = key.decrypt(base64.b64decode(sealed_b64.removeprefix('SEALED=')), OAEP).decode()
    if not keep:
        PRIVATE.unlink()
    return subprocess.run(cmd, env={**os.environ, 'AUDIO_KEY': secret}).returncode


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        raise SystemExit(__doc__)
    if a[0] == 'init':
        init()
    elif a[0] == 'seal' and len(a) == 3:
        seal(a[1], a[2])
    elif a[0] == 'run' and '--' in a:
        i = a.index('--')
        sys.exit(run(a[1], a[i + 1:], '--keep' in a[:i]))
    else:
        raise SystemExit(__doc__)
