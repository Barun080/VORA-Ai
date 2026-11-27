"""pytest plugin: block every non-loopback network connection; log attempts (no real TTS/LLM calls)."""
import os, socket
LOG = os.path.expanduser("~/vguard/blocked.log")
_orig_connect = socket.socket.connect
_orig_gai = socket.getaddrinfo
def _ok(host):
    return host in ("127.0.0.1", "::1", "localhost", "testserver", "testclient") or (isinstance(host, str) and host.startswith("127."))
def _log(what):
    with open(LOG, "a") as f: f.write(what + "\n")
def connect(self, addr):
    if self.family == getattr(socket, "AF_UNIX", None) or (isinstance(addr, tuple) and _ok(addr[0])):
        return _orig_connect(self, addr)
    _log(f"connect {addr}"); raise OSError("network blocked by netguard")
def getaddrinfo(host, *a, **k):
    if host is None or _ok(host): return _orig_gai(host, *a, **k)
    _log(f"dns {host}"); raise socket.gaierror("network blocked by netguard")
socket.socket.connect = connect
socket.getaddrinfo = getaddrinfo
