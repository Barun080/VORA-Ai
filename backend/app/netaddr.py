"""25 พ.ย. 2569: หา IP ของเครื่องหลักที่มือถือ/เครื่องอื่นในวง LAN เข้าถึงได้ (ไลบรารีมาตรฐานเท่านั้น)

ปัญหาเดิม: ใช้ IP ของเส้นทางออกอินเทอร์เน็ตอย่างเดียว → เครื่องที่มี VPN (Radmin 26.x, Hamachi 25.x, Tailscale 100.64/10)
หรือไม่มีเครือข่าย (ได้ 127.0.0.1) จะได้คิวอาร์ที่มือถือสแกนแล้วเข้าไม่ได้
ลำดับเลือก: IP ของเส้นทางหลัก (ถ้าเป็นวง LAN) → 192.168.x → 10.x → 172.16–31.x → ไม่มี (ok=False)
"""
from __future__ import annotations

import ipaddress
import socket

VPN_NETS = [ipaddress.ip_network(n) for n in ("25.0.0.0/8", "26.0.0.0/8", "100.64.0.0/10")]
RANK = [ipaddress.ip_network("192.168.0.0/16"), ipaddress.ip_network("10.0.0.0/8"), ipaddress.ip_network("172.16.0.0/12")]


def kind_of(ip: str) -> str:
    """lan | vpn | loopback | linklocal | other"""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return "other"
    if a.version != 4:
        return "other"
    if a.is_loopback:
        return "loopback"
    if a.is_link_local:
        return "linklocal"
    if any(a in n for n in VPN_NETS):
        return "vpn"
    if any(a in n for n in RANK):
        return "lan"
    return "other"


def route_ip() -> str:
    """IP ที่ระบบใช้ส่งออก (ไม่ส่งข้อมูลจริง เป็นแค่การถามตารางเส้นทาง)"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:  # noqa: BLE001
        return "127.0.0.1"


def host_ips() -> list[str]:
    out: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in out:
                out.append(ip)
    except OSError:
        pass
    return out


def candidates(route: str | None = None, others: list[str] | None = None) -> list[dict]:
    """ทุก IPv4 ของเครื่อง พร้อมชนิด เรียงจากที่แนะนำที่สุด"""
    route = route_ip() if route is None else route
    ips = [route] + [i for i in (host_ips() if others is None else others) if i != route]

    def score(ip: str) -> tuple:
        k = kind_of(ip)
        if k != "lan":
            return (9, 0)
        a = ipaddress.ip_address(ip)
        return (0 if ip == route else 1, next(i for i, n in enumerate(RANK) if a in n))
    return [{"ip": ip, "kind": kind_of(ip), "route": ip == route} for ip in sorted(ips, key=score)]


def best_lan_ip(route: str | None = None, others: list[str] | None = None) -> tuple[str, bool]:
    """(ip, ok) — ok=False เมื่อไม่มี IP วง LAN ที่มือถือเข้าถึงได้"""
    c = candidates(route, others)
    lan = [x for x in c if x["kind"] == "lan"]
    if lan:
        return lan[0]["ip"], True
    return (c[0]["ip"] if c else "127.0.0.1"), False
