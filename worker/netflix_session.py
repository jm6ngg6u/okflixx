import httpx
import json
import logging
import re
import asyncio
import random
from bs4 import BeautifulSoup

# NOTE: Do NOT call logging.basicConfig() here — bot.py already configures the
# root logger with a RotatingFileHandler and a StreamHandler.  Calling it again
# at module-import time would silently replace those handlers with a plain
# StreamHandler and lose the file-log output for the entire process.
logger = logging.getLogger(__name__)

# ───────────────────────────────────────────────
#  PLAN NORMALIZATION (ported from netflix_checker.py)
# ───────────────────────────────────────────────
def standardize_plan_details(plan_name):
    """
    Standardize plan details with multi-language support.
    Returns (normalized_name, video_quality)
    """
    if not plan_name:
        return "Unknown", "Unknown"

    name_lower = plan_name.lower()

    # 1. PREMIUM / UHD / 4K Plans
    premium_keywords = [
        'premium', 'ultra', 'uhd', '4k', 'platinum', 'delux', 'privilege',
        'prémium', 'プレミアム', '프리미엄', '高級', '高级',
        'พรีเมียม', 'cao cấp', 'مميزة', 'بريميوم', 'super',
        'özel', 'najlepszy', 'פרימיום', 'प्रीमियम',
    ]
    if any(k in name_lower or k in plan_name for k in premium_keywords):
        return "Premium", "UHD"

    # 2. STANDARD WITH ADS (check before Standard)
    # BUG FIX: found by testing against real live cookie labels. The UK's official
    # Netflix wording is "Standard with adverts" (not "ads"), which didn't match any
    # keyword here and fell through to the plain "Standard" branch below — silently
    # losing the ad-tier distinction for every UK account. Added "advert"/"adverts".
    ads_keywords = [
        'ads', 'ad-supported', 'with ads', 'advert', 'adverts', 'with adverts',
        'anúncios', 'com anúncios',
        'anuncios', 'con anuncios', 'pub', 'avec pub', 'publicités',
        'werbung', 'mit werbung', 'reklam', 'reklamlı', 'pubblicità',
        'advertenties', 'reklamy', 'z reklamami', '広告付き', '広告',
        '광고', '광고형', '广告', '廣告', 'โฆษณา', 'quảng cáo',
        'إعلانات', 'iklan', 'dengan iklan', 'विज्ञापन',
    ]
    if any(k in name_lower or k in plan_name for k in ads_keywords):
        return "Standard with Ads", "HD"

    # 3. STANDARD Plans
    standard_keywords = [
        'standard', 'padrão', 'padrao', 'estándar', 'estandar',
        'standart', 'standardowa', 'standardní', 'スタンダード',
        '스탠다드', '標準', '标准', 'มาตรฐาน', 'tiêu chuẩn',
        'قياسي', 'standar', 'standaard', 'κανονικό', 'סטנדרט', 'स्टैंडर्ड',
    ]
    if any(k in name_lower or k in plan_name for k in standard_keywords):
        return "Standard", "HD"

    # 4. BASIC Plans
    basic_keywords = [
        'basic', 'essential', 'básico', 'basico', 'basique', 'essentiel',
        'basis', 'essenziale', 'base', 'temel', 'podstawowy', 'základní',
        'ベーシック', '베이식', '基本', 'พื้นฐาน', 'cơ bản',
        'أساسي', 'dasar', 'बेसिक',
    ]
    # BUG FIX: Basic was mapped to "HD" — real Netflix Basic plans have only ever
    # streamed in SD (480p); HD/1080p was never offered on Basic in any region.
    # Mapping it to "HD" caused Basic-plan cookies to be miscategorized as a higher
    # quality tier than they actually support whenever the checker had to infer
    # quality from the plan name (normalize_video_quality() in database.py only
    # falls back to this function when the raw video_quality field is empty).
    if any(k in name_lower or k in plan_name for k in basic_keywords):
        return "Basic", "SD"

    # 5. MOBILE Plans
    mobile_keywords = [
        'mobile', 'móvil', 'movil', 'celular', 'モバイル', '모바일',
        'มือถือ', 'di động', 'محمول', 'seluler', 'मोबाइल',
    ]
    if any(k in name_lower or k in plan_name for k in mobile_keywords):
        return "Mobile", "SD"

    return plan_name, "Unknown"


# ───────────────────────────────────────────────
#  PROFILE EXTRACTION (ported from netflix_checker.py)
# ───────────────────────────────────────────────
def _decode_hex_escapes(text):
    """Decode \\x hex escape sequences like \\x40 → @"""
    if not text or not isinstance(text, str):
        return text
    try:
        return re.sub(r'\\x([0-9a-fA-F]{2})', lambda m: chr(int(m.group(1), 16)), text)
    except Exception:
        return text


def _decode_unicode_escapes(text):
    """Decode \\u unicode escape sequences like \\u0040 → @"""
    if not text or not isinstance(text, str):
        return text
    try:
        return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), text)
    except Exception:
        return text


def _clean_value(value):
    """Clean and decode a value extracted from Netflix HTML — handles \\x and \\u escapes."""
    if not value or value in ('None', 'null', 'Unknown', ''):
        return None
    if isinstance(value, str):
        try:
            value = value.encode('utf-8', 'replace').decode('utf-8')
        except Exception:
            pass
        value = _decode_unicode_escapes(value)
        value = _decode_hex_escapes(value)
        value = value.strip().replace('\x00', '').replace('\r', '').replace('\n', ' ')
        value = ' '.join(value.split())
    return value if value else None


def _extract_react_context(html_text):
    """
    Parse netflix.reactContext JSON from HTML — the primary data source.
    Ported from netflix_checker.py's extract_json_from_html().
    """
    try:
        match = re.search(r'netflix\.reactContext\s*=\s*(\{.+?\});', html_text, re.DOTALL)
        if match:
            json_str = match.group(1)
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                try:
                    json_str = _decode_hex_escapes(json_str)
                    return json.loads(json_str)
                except Exception:
                    pass
    except Exception:
        pass
    return None


# ───────────────────────────────────────────────
#  TV ACTIVATION CONSTANTS
# ───────────────────────────────────────────────
TV_CODE_ERROR_PATTERNS = [
    r"that code wasn'?t right", r"code (is )?(incorrect|invalid|wrong)", r"try again",
    r"c[oó]digo (es |que ingresaste |no es |incorrecto|inv[aá]lido)", r"ese c[oó]digo no", r"int[ée]ntalo de nuevo", r"intenta (de )?nuevo",
    r"c[oó]digo (est[aá] |n[aã]o est[aá] |incorreto|inv[aá]lido)", r"esse c[oó]digo n[aã]o", r"tente novamente",
    r"code (est |n'est pas |incorrect|invalide)", r"ce code n'est", r"r[ée]essayez", r"essayez encore",
    r"code (ist |ung[uü]ltig|falsch)", r"versuchen sie es erneut",
    r"codice (non [eè] |sbagliato|non valido)", r"riprova",
    r"kod (yanlış|ge[çc]ersiz|hatalı|doğru değil)", r"tekrar dene",
    r"الرمز (غير صحيح|خطأ|خاطئ)", r"حاول مرة أخرى",
    r"הקוד (שהזנת |שגוי|לא נכון)", r"כדאי לנסות שוב",
    r"m[ãa] (đó|không đúng|không ch[íi]nh x[áa]c|sai)", r"thử lại",
    r"kod (jest |nieprawidłowy|błędny)", r"spr[óo]buj ponownie",
    r"код (неверный|неправильный|ошибочный)", r"попробуйте",
    r"代码(有误|错误|无效|不正确)", r"请重试", r"再试一[次遍]",
    r"代碼(有誤|錯誤|無效|不正確)", r"請重試", r"再試一[次遍]",
    r"kode (salah|tidak valid|tidak tepat)", r"coba lagi",
    r"รหัส(ที่คุณป้อน)?(ไม่ถูกต้อง|ผิด)", r"ลองอีกครั้ง",
    r"코드(가|는)?(잘못|틀렸|올바르지 않)", r"다시 시도",
    r"コード(が|は)?(間違|違|正しく)", r"もう一度",
    r"कोड (गलत|अमान्य)", r"पुनः प्रयास", r"फिर से",
    r"code (is |niet |onjuist|verkeerd)", r"probeer opnieuw",
    r"codul (este |nu este |incorect|gre[sș]it)", r"[iî]ncearc[aă] din nou",
    r"a k[oó]d (hib[aá]s|nem megfelel)", r"pr[oó]b[aá]ld [uú]jra",
    r"ο κωδικ[οό]ς (είναι |δεν είναι |λάθος|εσφαλμέν)", r"δοκιμ[άα]στε ξαν[άα]",
    r"koden (är |stämmer inte |felaktig|ogiltig)", r"f[oö]rs[oö]k igen",
    r"koden (er |stemmer ikke |feil|ugyldig)", r"pr[oø]v igjen",
    r"koden (er |er ikke |forkert|ugyldig)", r"pr[oø]v igen",
    r"koodi (on |ei ole |virheellinen|v[aä][aä]r[aä])", r"yrit[aä] uudelleen",
    r"k[oó]d (je |nen[íi] |nespr[aá]vn[yý]|chybn[yý])", r"zkuste to znovu",
    r"код (нев[іи]рний|неправильний|помилковий)", r"спробуйте (ще раз|знову)",
]

TV_CODE_SUCCESS_PATTERNS = [
    r"tu tv est[aá] lista", r"your tv is ready", r"sua tv est[aá] pronta", r"votre t[ée]l[ée] est pr[eê]t",
    r"dein tv ist bereit", r"la tua tv [eè] pronta", r"tv'niz hazır", r"הטלוויזיה שלך מוכנ", r"تلفازك جاهز",
    r"tv của bạn đã sẵn sàng", r"tw[oó]j telewizor jest gotowy", r"device activated", r"start watching",
    r"you can now enjoy", r"activation complete", r"logincomplete", r"tv is now connected",
    r"successfully linked", r"device is ready"
]

class NetflixSession:
    """Handles Netflix authentication via cookies and TV code activation using Async httpx."""

    def __init__(self, cookie_file=None, cookie_dict=None, proxy_dict=None):
        """
        Initialize a Netflix session (Async).
        
        Args:
            cookie_file: Path to a Netscape-format cookie file (.txt)
            cookie_dict: Dict of {cookie_name: cookie_value} for DB-loaded sessions
            proxy_dict: Optional httpx proxy dict {"http://": "...", "https://": "..."}
        """
        self.headers = self._get_random_headers()
        # Initialize AsyncClient with optional proxy
        client_kwargs = dict(
            headers=self.headers,
            timeout=15.0,
            follow_redirects=True,
            verify=True
        )
        if proxy_dict:
            # BUG FIX: httpx 0.27 removed the `proxies=` dict kwarg entirely.
            # Passing a dict raises TypeError at construction time, breaking TV
            # activation for every user whenever a proxy is configured.
            # The replacement API is `proxy=` with a single URL string.
            # proxy_dict is always {"http://": url, "https://": url} from
            # netflix_adapter.py, so we extract the https value (the only one
            # Netflix needs) and pass it as the singular `proxy=` kwarg.
            _proxy_url = (proxy_dict.get("https://")
                          or proxy_dict.get("http://")
                          or next(iter(proxy_dict.values()), None))
            if _proxy_url:
                client_kwargs['proxy'] = _proxy_url
        self.client = httpx.AsyncClient(**client_kwargs)
        self.cookies_raw = {}  # Store raw {name: value} for DB persistence

        if cookie_file:
            self.load_cookies_from_file(cookie_file)
        elif cookie_dict:
            self.load_cookies_from_dict(cookie_dict)

    def _get_random_headers(self):
        """Generate randomized headers to avoid detection (Ported from Refer Bot)."""
        import random
        user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ]
        
        return {
            'User-Agent': random.choice(user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            # 'Accept-Encoding': 'gzip, deflate', # httpx handles this
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Referer': 'https://www.netflix.com/'
        }

    async def close(self):
        """Close the async client."""
        await self.client.aclose()

    def load_cookies_from_file(self, cookie_file):
        """Loads cookies from a Netscape-format .txt file."""
        try:
            with open(cookie_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split("\t")
                    if len(parts) >= 7:
                        # domain, flag, path, secure, expires, name, value
                        # parts[0] is domain. parts[5] is name, parts[6] is value.
                        name, value = parts[5], parts[6]
                        self.cookies_raw[name] = value
            self._apply_cookies()
            logger.info(f"Loaded {len(self.cookies_raw)} cookie entries from file.")
            return True
        except Exception as e:
            logger.error(f"Error loading cookies from file: {e}")
            return False

    def load_cookies_from_dict(self, cookie_dict):
        """Loads cookies from a dictionary (used when loading from DB)."""
        self.cookies_raw = dict(cookie_dict)
        self._apply_cookies()
        logger.info(f"Loaded {len(self.cookies_raw)} cookie entries from dict.")

    def _apply_cookies(self):
        """Apply raw cookies to the httpx client."""
        self.client.cookies.clear()
        for name, value in self.cookies_raw.items():
            self.client.cookies.set(name, value, domain=".netflix.com")

    def get_cookies_for_storage(self):
        """Returns a JSON-serializable dict of cookies for DB storage."""
        return dict(self.cookies_raw)

    # HBO->NETFLIX CLEANUP: removed validate_session(), validate_fast(), and
    # validate_and_get_details() -- three separate /YourAccount-fetching cookie
    # validators (each with their own retry/status-classification logic) that
    # duplicated what fast_checker.py's check_cookie_sync() already does more
    # robustly (curl_cffi Chrome TLS impersonation, proxy support, rate
    # limiting). Nothing in this codebase called any of the three -- every real
    # cookie check goes through netflix_adapter.check_cookie_sync (used by
    # admin_handlers.py and bot.py), never through this class's validate_*
    # methods. Left over from the original HBO session-checking flow that was
    # superseded by fast_checker.py during the Netflix port. Only the methods
    # actually used by activate_tv() remain below.

    def _extract_full_details(self, html_text):
        """
        Extract full account details from Netflix page.
        """
        details = {
            "email": "Unknown",
            "country": "Unknown",
            "country_code": "",
            "plan": "Unknown",
            "video_quality": "Unknown",
        }

        # ═══ STEP 1: Try JSON extraction from netflix.reactContext ═══
        try:
            ctx = _extract_react_context(html_text)
            if ctx:
                models = ctx.get('models', {})

                # --- Email + Country from userInfo ---
                user_info = None
                if 'userInfo' in models:
                    user_info = models['userInfo'].get('data', models['userInfo'])
                elif 'signupContext' in models:
                    sc_data = models['signupContext'].get('data', {})
                    user_info = sc_data.get('userInfo', {})

                if user_info:
                    # Email
                    raw_email = user_info.get('emailAddress') or user_info.get('email')
                    if raw_email:
                        cleaned = _clean_value(raw_email)
                        if cleaned and '@' in cleaned:
                            details["email"] = cleaned

                    # Country
                    raw_country = user_info.get('countryOfSignup') or user_info.get('currentCountry')
                    if raw_country:
                        code = _clean_value(raw_country)
                        if code and len(code) == 2:
                            code = code.upper()
                            details["country_code"] = code
                            details["country"] = self._get_country_flag(code)

        except Exception as e:
            logger.debug(f"JSON extraction error: {e}")

        # ═══ STEP 2: Regex fallback for email ═══
        if details["email"] == "Unknown":
            email_patterns = [
                r'"emailAddress"\s*:\s*"([^"]+)"',
                r'"email"\s*:\s*"([^"]+)"',
                r'"memberEmail"\s*:\s*"([^"]+)"',
            ]
            for pattern in email_patterns:
                match = re.search(pattern, html_text)
                if match:
                    decoded = _clean_value(match.group(1))
                    if decoded and '@' in decoded:
                        details["email"] = decoded
                        break

        # ═══ STEP 3: Regex fallback for country ═══
        if details["country"] == "Unknown":
            country_patterns = [
                r'"countryOfSignup"\s*:\s*"([^"]+)"',
                r'"currentCountry"\s*:\s*"([^"]+)"',
                r'"country"\s*:\s*"([^"]+)"',
                r'"countryCode"\s*:\s*"([^"]+)"',
            ]
            for pattern in country_patterns:
                match = re.search(pattern, html_text)
                if match:
                    raw = _clean_value(match.group(1))
                    if raw and len(raw) == 2:
                        code = raw.upper()
                        details["country_code"] = code
                        details["country"] = self._get_country_flag(code)
                        break

        # ═══ STEP 4: Plan Name ═══
        plan_patterns = [
            r'"localizedPlanName"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"',
            r'"planName"\s*:\s*"([^"]+)"',
        ]
        raw_plan = None
        for pattern in plan_patterns:
            match = re.search(pattern, html_text)
            if match:
                raw_plan = _clean_value(match.group(1))
                break

        if raw_plan:
            norm_plan, video_quality = standardize_plan_details(raw_plan)
            details["plan"] = norm_plan
            details["video_quality"] = video_quality
        else:
            if "Premium" in html_text or "Ultra HD" in html_text:
                details["plan"] = "Premium"
                details["video_quality"] = "UHD"
            elif "Standard with ads" in html_text or "Standard with Ads" in html_text:
                details["plan"] = "Standard with Ads"
                details["video_quality"] = "HD"
            elif "Standard" in html_text:
                details["plan"] = "Standard"
                details["video_quality"] = "HD"
            elif "Basic" in html_text:
                # BUG FIX: was "HD" — real Netflix Basic has only ever streamed SD
                # (480p), same fix applied to standardize_plan_details() above. This
                # is a separate hardcoded fallback branch (only hit when the JSON/
                # regex plan-name extraction above found nothing), so it needed the
                # identical correction independently.
                details["plan"] = "Basic"
                details["video_quality"] = "SD"
            elif "Mobile" in html_text:
                # BUG FIX: this fallback had no Mobile branch at all — a Mobile-plan
                # account whose plan name wasn't matched by the JSON/regex extraction
                # above fell through with plan/video_quality left at their "Unknown"
                # defaults instead of being correctly tagged. Netflix Mobile plans are
                # SD-only, matching the 'mobile_keywords' branch in
                # standardize_plan_details() so both code paths agree.
                details["plan"] = "Mobile"
                details["video_quality"] = "SD"

        # ═══ STEP 5: Video Quality (direct extraction) ═══
        # BUG FIX: the raw "videoQuality" field on the Netflix account page comes back
        # as a free-form marketing string ("Ultra HD", "4K Ultra HD", "Full HD 1080p",
        # "HD 720p", "Standard Definition", etc.) depending on locale/plan. Displaying
        # that raw string leaked long, inconsistent labels into the bot instead of the
        # single short SD/HD/UHD tier the rest of the bot (and the admin panel) uses.
        # Normalize it the same way _display_quality() does in netflix_adapter.py.
        vq_match = re.search(r'"videoQuality"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"', html_text)
        if vq_match:
            raw_vq = (_clean_value(vq_match.group(1)) or "").upper()
            if raw_vq:
                if "4K" in raw_vq or "UHD" in raw_vq or "ULTRA" in raw_vq:
                    details["video_quality"] = "UHD"
                elif "SD" in raw_vq or "480" in raw_vq or "STANDARD DEFINITION" in raw_vq:
                    details["video_quality"] = "SD"
                elif "HD" in raw_vq or "FHD" in raw_vq or "720" in raw_vq or "1080" in raw_vq:
                    details["video_quality"] = "HD"

        return details

    async def _get_tv8_params(self):
        """
        Fetch ALL required parameters from the TV8 React page.
        
        Netflix redesigned /tv8 in mid-2026: removed the HTML <form> and
        hidden <input name="authURL">, replaced with a React app that renders
        8 individual PIN input boxes. All parameters now live inside the
        netflix.reactContext JSON blob in a <script> tag.
        """
        try:
            response = await self.client.get("https://www.netflix.com/tv8")
            if response.status_code != 200:
                logger.error(f"Failed to load /tv8: status {response.status_code}")
                return None

            html = response.text

            # ── Extract netflix.reactContext JSON ──
            ctx = None
            ctx_match = re.search(r'netflix\.reactContext\s*=\s*(\{.+?\});', html, re.DOTALL)
            if ctx_match:
                try:
                    ctx = json.loads(ctx_match.group(1))
                except json.JSONDecodeError:
                    try:
                        raw = _decode_hex_escapes(ctx_match.group(1))
                        ctx = json.loads(raw)
                    except Exception:
                        pass

            if not ctx:
                logger.error("Could not parse netflix.reactContext from /tv8")
                return None

            models = ctx.get('models', {})

            # ── Extract authURL ──
            auth_url = None

            # Priority 1: from flow.data.fields or flow.data
            flow_data = models.get('flow', {}).get('data', {})
            auth_url = flow_data.get('authURL')

            # Priority 2: from signupContext or userInfo
            if not auth_url:
                for key in ['signupContext', 'userInfo', 'loginContext']:
                    if key in models:
                        data = models[key].get('data', models[key])
                        auth_url = data.get('authURL')
                        if auth_url:
                            break

            # Priority 3: regex fallback from full HTML
            if not auth_url:
                m = re.search(r'"authURL"\s*:\s*"([^"]+)"', html)
                if m:
                    auth_url = m.group(1)
                    try:
                        auth_url = auth_url.encode().decode('unicode_escape')
                    except Exception:
                        pass

            if not auth_url:
                logger.error("Could not find authURL in reactContext or HTML")
                return None

            logger.info(f"Got authURL: {auth_url[:40]}...")

            # ── Extract flow parameters ──
            fields = flow_data.get('fields', {})

            params = {
                'authURL': auth_url,
                'flow': flow_data.get('flow', 'websiteSignUp'),
                'mode': flow_data.get('mode', 'enterTvLoginRendezvousCode'),
                'action': flow_data.get('action', 'nextAction'),
            }

            # Extract moneyballSessionUuid if present
            mbs = fields.get('moneyballSessionUuid')
            if isinstance(mbs, dict):
                params['moneyballSessionUuid'] = mbs.get('value', '')
            elif isinstance(mbs, str):
                params['moneyballSessionUuid'] = mbs

            # Extract esn if present
            esn = fields.get('esn')
            if isinstance(esn, dict):
                params['esn'] = esn.get('value', '')

            logger.info(f"TV8 params: flow={params['flow']}, mode={params['mode']}, action={params['action']}")
            return params

        except Exception as e:
            logger.error(f"Error fetching TV8 params: {e}")
            return None

    async def _get_auth_url(self):
        """Legacy wrapper — extracts just authURL for backward compatibility."""
        params = await self._get_tv8_params()
        return params['authURL'] if params else None

    async def get_account_details(self):
        """
        Fetches full account details.
        """
        try:
            response = await self.client.get("https://www.netflix.com/YourAccount")
            if response.status_code != 200:
                return self._default_details()

            return self._extract_full_details(response.text)

        except Exception as e:
            logger.error(f"Error fetching account details: {e}")
            return self._default_details()

    def _default_details(self):
        """Return default details dict."""
        return {
            "email": "Unknown",
            "country": "Unknown",
            "country_code": "",
            "plan": "Unknown",
            "video_quality": "Unknown",
        }

    def _get_country_flag(self, code):
        """Converts 2-letter country code to flag emoji + country name.
        BUG FIX (HBO->NETFLIX CLEANUP): this used to carry its own hardcoded
        53-country COUNTRY_NAMES dict — a leftover copy from the HBO port that
        only covered a fraction of the real Netflix-availability country list
        (249 countries, verified against Netflix's own signup country list).
        Any account whose country wasn't in that short list (e.g. PK/BD/LK were
        present, but dozens of real Netflix countries like Nigeria's neighbors,
        most of the Caribbean, several EU/Gulf states, etc. were missing) had
        its flag+name silently degrade to a bare code with no flag. Now reuses
        the single shared countries.COUNTRY_NAMES table (same one used by
        bot_helpers.country_flag() and the admin Country Breakdown screen) so
        there is exactly one source of truth for country names/codes."""
        from countries import COUNTRY_NAMES
        OFFSET = 127397
        try:
            flag = chr(ord(code[0]) + OFFSET) + chr(ord(code[1]) + OFFSET)
            name = COUNTRY_NAMES.get(code.upper(), code)
            return f"{flag} {name}"
        except Exception:
            return code

    async def activate_tv(self, code):
        """
        Activates a TV device using the 8-digit code.
        
        Updated July 2026: Netflix redesigned /tv8 from HTML form to React PIN input.
        Parameters now come from netflix.reactContext JSON instead of hidden inputs.
        """
        # Step 1: Get all parameters from the React page
        params = await self._get_tv8_params()
        if not params:
            # BUG FIX: Previously returned error_type="auth" here, which netflix_adapter.py
            # mapped to cookie_dead=True — permanently deleting a healthy cookie from the pool
            # whenever /tv8 failed to load for any reason (network blip, Netflix rate-limit,
            # temporary 5xx, slow Railway cold-start, React-context parse error).
            # A /tv8 page load failure says nothing about the cookie's validity — the
            # account may be perfectly active. Changed to "tv8_unavailable" which
            # netflix_adapter.py now treats as a transient error: skip this cookie and
            # try another, but leave it in the pool for future activations.
            return {"success": False, "error_type": "tv8_unavailable",
                    "message": "❌ Could not load activation page. This may be a temporary Netflix issue — retrying with another cookie."}

        # Step 2: Submit the TV code
        try:
            # Revert payload to match the proven legacy API format that Netflix still expects
            # even though their frontend React UI uses different field names internally.
            payload = {
                "flow": "websiteSignUp",
                "authURL": params['authURL'],
                "flowMode": "enterTvLoginRendezvousCode",
                "withFields": "tvLoginRendezvousCode,isTvUrl2",
                "code": code,
                "tvLoginRendezvousCode": code,
                "action": "nextAction",
            }

            # Still include moneyballSessionUuid if available just in case
            if params.get('moneyballSessionUuid'):
                payload["moneyballSessionUuid"] = params['moneyballSessionUuid']

            # Include esn if available
            if params.get('esn'):
                payload["esn"] = params['esn']

            logger.info(f"Submitting code {code} with authURL {params['authURL'][:30]}...")
            logger.info(f"Payload fields: {list(payload.keys())}")

            response = await self.client.post(
                "https://www.netflix.com/tv8",
                data=payload,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Origin": "https://www.netflix.com",
                    "Referer": "https://www.netflix.com/tv8",
                }
            )

            logger.info(f"Activation POST status: {response.status_code}")
            logger.info(f"Activation POST final URL: {response.url}")

            # ── Handle HTTP errors ──
            if response.status_code == 500:
                return {"success": False, "error_type": "expired_code", "message": "❌ Netflix returned error 500. Code may be expired or invalid."}

            if response.status_code == 403:
                # BUG FIX: Previously returned error_type="blocked" for 403, which
                # netflix_adapter.py mapped to cookie_dead=True. On Railway/VPS, the
                # authURL CSRF token in the /tv8 payload expires if the container is
                # slow (cold-start latency between fetching /tv8 and POSTing the code).
                # Netflix also returns 403 on rate-limit. Both are transient — the
                # cookie/account is healthy. Changed to "auth_expired" so netflix_adapter.py
                # skips this cookie without deleting it and retries with another.
                return {"success": False, "error_type": "auth_expired",
                        "message": "❌ authURL expired or rate-limited (403). Retrying with another cookie."}

            current_url = str(response.url).lower()

            # Clean text to accurately check for success/error patterns without hidden JS/CSS
            import html as html_mod
            clean_text = response.text
            clean_text = re.sub(r'<script[^>]*>.*?</script>', '', clean_text, flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<style[^>]*>.*?</style>', '', clean_text, flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
            clean_text = html_mod.unescape(clean_text)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip().lower()

            # ── Success detection (URL + Multi-Language) ──
            is_success = False

            if "/tv/out/success" in current_url or "/browse" in current_url:
                is_success = True
            elif "chooseprofile" in clean_text or "who's watching" in clean_text:
                is_success = True
            else:
                for pat in TV_CODE_SUCCESS_PATTERNS:
                    if re.search(pat, clean_text):
                        is_success = True
                        break

            # If still status 200, check if form disappeared
            if not is_success and response.status_code == 200:
                form_still_showing = (
                    "pin-number-input" in response.text or
                    "witcher-code-form" in response.text or
                    "enter the code" in clean_text
                )
                if not form_still_showing:
                    is_success = True

            if is_success:
                details = await self.get_account_details()
                return {
                    "success": True,
                    "message": "✅ TV activated successfully!",
                    "details": details,
                    "country": details.get("country", "Unknown"),
                    "plan": details.get("plan", "Unknown"),
                    "email": details.get("email", "Unknown"),
                    "video_quality": details.get("video_quality", "Unknown"),
                }

            # ── Failure detection (Multi-Language) ──
            for pat in TV_CODE_ERROR_PATTERNS:
                if re.search(pat, clean_text):
                    return {"success": False, "error_type": "invalid_code", "message": "❌ Incorrect or expired TV code."}

            # PIN form still showing = code wasn't accepted
            if "pin-number-input" in response.text or "witcher-code-form" in response.text:
                return {"success": False, "error_type": "not_accepted", "message": "❌ Code was not accepted. The activation form is still showing. Try a fresh code."}

            # Check if redirected to login (session expired)
            if "login" in current_url or "signin" in current_url:
                return {"success": False, "error_type": "session_expired", "message": "❌ Session expired. Cookie is no longer valid."}

            return {
                "success": False,
                "error_type": "unknown",
                "message": f"⚠️ Unexpected response (status {response.status_code}). The code may be invalid or expired."
            }

        except httpx.TimeoutException:
            return {"success": False, "error_type": "timeout", "message": "❌ Request timed out. Please try again."}
        except Exception as e:
            logger.error(f"Error activating TV: {e}")
            return {"success": False, "error_type": "error", "message": f"❌ Error: {str(e)}"}

