"""25 พ.ย. 2569: สร้างใบรับรอง https สำหรับใช้ในวง LAN (self-signed) → data/certs/vora-lan.crt + vora-lan.key

ใส่ชื่อ/IP ไว้ในใบรับรอง: localhost, 127.0.0.1, ชื่อเครื่อง, IP ทุกการ์ดเครือข่ายของเครื่องนี้ (+ ที่ระบุเพิ่มด้วย --ip)
อายุ 825 วัน · ไฟล์ .key เป็นความลับ ห้ามส่งต่อ (สคริปต์ไม่พิมพ์เนื้อหาออกมา)
ใช้:  python scripts/make_lan_cert.py           สร้างใหม่เมื่อยังไม่มี หรือ IP ของเครื่องไม่อยู่ในใบรับรองเดิม
      python scripts/make_lan_cert.py --force   สร้างใหม่เสมอ
      python scripts/make_lan_cert.py --ip 192.168.1.50
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import os
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("VORA_DATA_DIR", ROOT / "data"))
OUT = DATA_DIR / "certs"


def local_ips() -> set[str]:
    ips = {"127.0.0.1"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return {i for i in ips if not i.startswith("169.254.")}


def existing_ips(path: Path) -> set[str]:
    from cryptography import x509
    try:
        cert = x509.load_pem_x509_certificate(path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        if cert.not_valid_after_utc < dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30):
            return set()                                 # ใกล้หมดอายุ → สร้างใหม่
        return {str(i) for i in san.get_values_for_type(x509.IPAddress)}
    except Exception:  # noqa: BLE001
        return set()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--ip", action="append", default=[])
    a = ap.parse_args()
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
    except ImportError:
        print("[ERROR] ต้องติดตั้งแพ็กเกจ cryptography ก่อน:  pip install cryptography")
        return 2
    ips = local_ips() | {i.strip() for i in a.ip if i.strip()}
    for i in list(ips):
        try:
            ipaddress.ip_address(i)
        except ValueError:
            print(f"[WARN] ข้าม IP ไม่ถูกต้อง: {i}")
            ips.discard(i)
    crt, key = OUT / "vora-lan.crt", OUT / "vora-lan.key"
    if crt.exists() and key.exists() and not a.force and ips <= existing_ips(crt):
        print(f"ใบรับรองเดิมใช้ได้อยู่ (IP: {', '.join(sorted(ips))}) — ไม่สร้างใหม่")
        return 0
    host = socket.gethostname()
    names = [x509.DNSName("localhost"), x509.DNSName(host)] + [x509.IPAddress(ipaddress.ip_address(i)) for i in sorted(ips)]
    pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"VORA LAN ({host})"),
                         x509.NameAttribute(NameOID.ORGANIZATION_NAME, "VORA Robot")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(pk.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(now + dt.timedelta(days=825))
            .add_extension(x509.SubjectAlternativeName(names), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(pk, hashes.SHA256()))
    OUT.mkdir(parents=True, exist_ok=True)
    key.write_bytes(pk.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                     serialization.NoEncryption()))
    crt.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"สร้างใบรับรองแล้ว: {crt}")
    print(f"  ใช้กับ: localhost, {host}, {', '.join(sorted(ips))}  (อายุ 825 วัน)")
    print("  ไฟล์ vora-lan.key เป็นความลับ ห้ามส่งต่อหรืออัปโหลด")
    return 0


if __name__ == "__main__":
    sys.exit(main())
