# proxy.py — Netflix TV Bot proxy parsing & formatting
from typing import Dict, Optional, Any


def parse_proxy_line(raw: str) -> Optional[Dict[str, Any]]:
    """
    Parse proxy format: host:port:user:pass
    Also supports:
    - host:port (no auth)
    - user:pass@host:port (classic format)
    - scheme://... (http/socks5/etc.)
    Returns dict ready for httpx.
    """
    if not raw:
        return None

    raw = raw.strip()

    scheme = "http"
    original_scheme = "http"
    if "://" in raw:
        scheme_part, raw = raw.split("://", 1)
        original_scheme = scheme_part.lower()
        scheme = original_scheme
        if scheme in ["socks5h", "socks5"]:
            scheme = "socks5"

    raw = raw.lstrip("/@")
    parts = raw.split(":")

    user = pwd = host = port = None

    if len(parts) == 4:
        # Ambiguity: two common 4-part formats in the wild.
        # Format A: host:port:user:pass  — parts[1] is the port (numeric, ≤65535)
        # Format B: user:pass:host:port  — parts[3] is the port (numeric, ≤65535)
        # Strategy: try Format A first. If parts[1] fails the port range check,
        # fall back to Format B. This handles proxy-list providers that export
        # in either order without requiring the admin to know or manually convert.
        try:
            candidate_port_a = int(parts[1])
            if 1 <= candidate_port_a <= 65535:
                host, port, user, pwd = parts  # Format A: host:port:user:pass
            else:
                raise ValueError("not a valid port")
        except (ValueError, TypeError):
            # Try Format B: user:pass:host:port
            user, pwd, host, port = parts

    elif '@' in raw:
        auth, host_port = raw.split('@', 1)
        if ':' in auth:
            user, pwd = auth.split(':', 1)
        else:
            user = auth
        if ':' in host_port:
            host, port = host_port.split(':', 1)
        else:
            host = host_port

    elif len(parts) == 2:
        host, port = parts

    else:
        return None

    try:
        port = int(port)
        if not 1 <= port <= 65535:
            return None
    except (ValueError, TypeError):
        return None

    if not host:
        return None

    return {
        "scheme": scheme,
        "original_scheme": original_scheme,
        "ip": host.strip(),
        "port": str(port),
        "user": user.strip() if user else None,
        "pass": pwd.strip() if pwd else None
    }


def get_httpx_proxy_dict(proxy_info: Optional[Dict]) -> Optional[Dict[str, str]]:
    """
    Convert parsed info → httpx proxy dict (http/https/socks5 compatible)
    """
    if not proxy_info:
        return None

    import urllib.parse
    scheme = proxy_info["scheme"]
    auth = ""
    if proxy_info["user"]:
        user_enc = urllib.parse.quote(proxy_info['user'], safe='')
        pass_enc = urllib.parse.quote(proxy_info['pass'] or '', safe='')
        auth = f"{user_enc}:{pass_enc}@" if pass_enc else f"{user_enc}@"

    proxy_url = f"{scheme}://{auth}{proxy_info['ip']}:{proxy_info['port']}"

    proxies = {
        "http://": proxy_url,
        "https://": proxy_url,
    }

    if scheme == "socks5" and "socks5h" in proxy_info.get("original_scheme", ""):
        proxies["all://"] = proxy_url

    return proxies


def _format_proxy_url(proxy_row) -> Optional[str]:
    """
    Convert a DB proxy row (dict with scheme/ip/port/username/password)
    to a single proxy URL string.
    """
    if not proxy_row:
        return None

    import urllib.parse
    scheme = proxy_row.get('scheme', 'http')
    ip = proxy_row['ip']
    port = proxy_row['port']
    user = proxy_row.get('username') or proxy_row.get('user')
    pwd = proxy_row.get('password') or proxy_row.get('pass')

    auth = ""
    if user:
        user_enc = urllib.parse.quote(str(user), safe='')
        pass_enc = urllib.parse.quote(str(pwd or ''), safe='')
        auth = f"{user_enc}:{pass_enc}@" if pass_enc else f"{user_enc}@"

    return f"{scheme}://{auth}{ip}:{port}"
