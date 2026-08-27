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


def quick_validate_proxy(proxy_url: str, timeout: int = 5) -> bool:
    """
    Perform a fast HTTPS connectivity test before using a proxy for activation.
    Uses 'requests' to match the proven validation in proxy_checker.py.
    Checks Netflix specifically since that's the ultimate target.
    """
    if not proxy_url:
        return False
        
    import requests
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    proxies = {
        "http": proxy_url,
        "https": proxy_url
    }
    
    # Try Netflix specifically since that's what we actually need
    test_urls = [
        "https://www.netflix.com/title/80014749",  # Rick and Morty
        "https://www.netflix.com/browse",
        "https://api.ipify.org?format=json"        # Fallback
    ]
    
    for url in test_urls:
        try:
            r = requests.get(
                url, 
                proxies=proxies, 
                timeout=timeout,
                verify=False,
                allow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            )
            if r.status_code < 500:
                return True
        except requests.exceptions.ProxyError:
            # Proxy refused connection — definitively dead
            return False
        except (requests.exceptions.RequestException, Exception):
            continue
            
    return False

from concurrent.futures import ThreadPoolExecutor
import threading
import time as _time

_proxy_tester_pool = ThreadPoolExecutor(max_workers=100)

# ── Proxy Cache: reuse a recently-validated proxy for 60s ──
# This eliminates 5-15s of redundant proxy testing on retry attempts
# during TV activation (where get_validated_proxy_url is called up to 3 times
# within seconds for the same user's activation loop).
_proxy_cache_lock = threading.Lock()
_proxy_cache = {"url": None, "expires": 0}

def _invalidate_proxy_cache(bad_url=None):
    """Clear the cache, optionally only if it holds a specific URL."""
    with _proxy_cache_lock:
        if bad_url is None or _proxy_cache["url"] == bad_url:
            _proxy_cache["url"] = None
            _proxy_cache["expires"] = 0

async def get_validated_proxy_url():
    """
    Get a proxy URL that has been pre-validated to work with Netflix.
    Uses a 60-second cache to avoid redundant validation on retry attempts.
    Tries up to 3 different proxies from the active pool if cache is empty.
    """
    try:
        import database as db
        if not db.is_proxy_mode():
            return None
    except ImportError:
        # Website worker environment (no database.py)
        return None
        
    import asyncio
    
    # ── Check cache first — instant return if recently validated ──
    now = _time.time()
    with _proxy_cache_lock:
        if _proxy_cache["url"] and now < _proxy_cache["expires"]:
            return _proxy_cache["url"]
    
    loop = asyncio.get_running_loop()
    
    for _ in range(3):
        p = db.get_random_valid_proxy()
        if not p:
            return None
            
        proxy_url = _format_proxy_url(p)
        if not proxy_url:
            continue
            
        # Run synchronous HTTPS test in dedicated high-capacity thread pool
        is_working = await loop.run_in_executor(_proxy_tester_pool, quick_validate_proxy, proxy_url, 5)
        if is_working:
            # Cache for 60 seconds — retry attempts reuse this instantly
            with _proxy_cache_lock:
                _proxy_cache["url"] = proxy_url
                _proxy_cache["expires"] = _time.time() + 60
            return proxy_url
            
        # Mark proxy invalid so we don't pick it again on the next loop iteration
        db.mark_proxy_invalid(p['id'])
        
    return None
