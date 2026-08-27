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
    r"something went wrong", r"algo sali[oó] mal", r"quelque chose s'est mal pass[ée]", r"etwas ist schiefgelaufen",
    r"qualcosa [eè] andato storto", r"bir [sş]eyler ters gitti", r"משהו השתבש", r"حدث خطأ ما",
    r"household", r"hogar", r"foyer", r"haushalt", r"nucleo domestico", r"hane", r"בית", r"عائلة",
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
            timeout=10.0,
            follow_redirects=True,
            verify=True
        )
        self._proxy_url = None
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
                self._proxy_url = _proxy_url
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

    @staticmethod
    def _extract_auth_url_regex(html):
        """
        Extract authURL from Netflix /tv8 page using proven regex patterns.
        Ported from FreeTV.py's extract_auth_url() — simple, reliable, works
        with both the old HTML form and the new React-based /tv8 page.
        """
        import urllib.parse as _up
        patterns = [
            r'name="authURL"\s+value="([^"]+)"',
            r'authURL["\']?\s*[:=]\s*["\']([^"]+)["\']',
            r'authURL=([^&\s"\']+)',
            r'["\']authURL["\']\s*:\s*["\']([^"\']+)["\']',
            r'value="(c1\.[^"]+)"',
        ]
        for pat in patterns:
            m = re.search(pat, html)
            if m:
                return _up.unquote(m.group(1))
        return None

    @staticmethod
    def _is_tv_code_error(cleaned_text):
        """Check if cleaned page text contains TV code error patterns.
        Ported from FreeTV.py — covers 30+ languages."""
        text_lower = cleaned_text.lower()
        for pattern in TV_CODE_ERROR_PATTERNS:
            if re.search(pattern, text_lower):
                return True
        return False

    @staticmethod
    def _is_tv_code_success(final_url, cleaned_text):
        """Check if final URL or cleaned text indicates TV activation success.
        Ported from FreeTV.py — uses explicit success indicators only."""
        if "/tv/out/success" in final_url.lower():
            return True
        text_lower = cleaned_text.lower()
        for pat in TV_CODE_SUCCESS_PATTERNS:
            if re.search(pat, text_lower):
                return True
        return False

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

        Ported from FreeTV.py's proven submit_tv_code() approach, using
        curl_cffi with Chrome120 TLS impersonation instead of httpx.

        Why this works when the old httpx version didn't:
        1. curl_cffi impersonates real Chrome TLS fingerprint → bypasses anti-bot
        2. Simple regex authURL extraction → works with any /tv8 page variant
        3. Strict URL-based success detection → no false positives
        4. Post-activation verification → catches edge cases where POST
           "succeeds" but TV never actually activates (proxy/CDN issue)
        """
        from curl_cffi import requests as curl_requests
        import html as html_mod

        # Create a fresh curl_cffi session with Chrome TLS impersonation
        curl_session = curl_requests.Session(impersonate="chrome120")

        # Set cookies from our raw cookie dict
        for name, value in self.cookies_raw.items():
            curl_session.cookies.set(name, value, domain=".netflix.com")

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
        }

        # Build common kwargs for curl_cffi requests
        base_kwargs = {"headers": headers, "timeout": 15, "allow_redirects": True}
        if self._proxy_url:
            base_kwargs["proxy"] = self._proxy_url

        try:
            # ══════════════════════════════════════════════
            #  Step 1: GET /tv8 → extract authURL (FreeTV.py regex approach)
            # ══════════════════════════════════════════════
            try:
                r = curl_session.get("https://www.netflix.com/tv8", **base_kwargs)
            except Exception as e:
                logger.error(f"Failed to fetch /tv8: {e}")
                return {"success": False, "error_type": "tv8_unavailable",
                        "message": "❌ Could not load activation page. Retrying with another cookie."}

            if r.status_code != 200:
                logger.error(f"Failed to load /tv8: status {r.status_code}")
                return {"success": False, "error_type": "tv8_unavailable",
                        "message": "❌ Could not load activation page. Retrying with another cookie."}

            auth_url = self._extract_auth_url_regex(r.text)
            if not auth_url:
                # Fallback: try to find any c1.xxx token in the page
                fallback = re.search(r'c1\.[a-zA-Z0-9%+=/]+', r.text)
                if fallback:
                    auth_url = fallback.group(0)
                else:
                    logger.error("Could not extract authURL from /tv8")
                    return {"success": False, "error_type": "tv8_unavailable",
                            "message": "❌ Could not extract authURL from activation page."}

            logger.info(f"Got authURL: {auth_url[:40]}...")

            # ══════════════════════════════════════════════
            #  Step 2: POST the TV code
            #  Uses Netflix's actual form fields from reactContext:
            #  - flow: "websiteSignUp" (the signup/login flow identifier)
            #  - authURL: CSRF token extracted from GET /tv8
            #  - mode: "enterTvLoginRendezvousCode" (current flow step)
            #  - action: "nextAction" (triggers field submission)
            #  - withFields lists: tvLoginRendezvousCode + isTvUrl2
            #  - isTvUrl2: "true" — required hidden field, tells Netflix
            #    this is the /tv8 (URL v2) flow, not the legacy /activate
            # ══════════════════════════════════════════════
            form_data = {
                "flow": "websiteSignUp",
                "mode": "enterTvLoginRendezvousCode",
                "authURL": auth_url,
                "withFields": "tvLoginRendezvousCode,isTvUrl2",
                "tvLoginRendezvousCode": code,
                "isTvUrl2": "true",
                "action": "nextAction",
            }

            post_headers = {
                **headers,
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": "https://www.netflix.com/tv8",
                "Origin": "https://www.netflix.com",
            }

            post_kwargs = {"data": form_data, "headers": post_headers,
                           "timeout": 15, "allow_redirects": True}
            if self._proxy_url:
                post_kwargs["proxy"] = self._proxy_url

            try:
                r = curl_session.post("https://www.netflix.com/tv8", **post_kwargs)
            except Exception as e:
                logger.error(f"Activation POST failed: {e}")
                return {"success": False, "error_type": "error",
                        "message": "❌ Activation request failed."}

            final_url = str(r.url) if hasattr(r, 'url') else "https://www.netflix.com/tv8"
            logger.info(f"Activation POST status: {r.status_code}, final URL: {final_url}")

            # ══════════════════════════════════════════════
            #  Step 3: Strict success/failure detection
            #
            #  DETECTION ORDER IS CRITICAL — do NOT rearrange:
            #    1. HTTP error codes (500/403)
            #    2. URL redirect success (most reliable, can't be faked)
            #    3. Clean HTML (strip JS/CSS that contain false-positive
            #       route names like "tvLoginSuccess" in every page load)
            #    4. ERROR detection FIRST (must run before success checks
            #       to prevent localized error pages from falling through
            #       to ambiguous → retry → false success)
            #    5. reactContext flow-mode (ONLY inside the actual JSON
            #       block, never the full raw HTML)
            #    6. Text-based success patterns with verification
            #    7. Session expired
            #    8. Ambiguous fallback (retryable)
            # ══════════════════════════════════════════════

            # 3a: Handle HTTP error codes
            if r.status_code == 500:
                return {"success": False, "error_type": "expired_code",
                        "message": "❌ Netflix returned error 500. Code may be expired."}
            if r.status_code == 403:
                return {"success": False, "error_type": "auth_expired",
                        "message": "❌ authURL expired or rate-limited (403). Retrying."}

            # 3b: URL-based success (MOST RELIABLE — Netflix only redirects
            #     to /tv/out/success on a real, confirmed activation)
            final_url_lower = final_url.lower()
            if "/tv/out/success" in final_url_lower:
                logger.info(f"TV activation SUCCESS: URL redirect → {final_url}")
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

            # 3c: Clean HTML — strip all <script> and <style> blocks FIRST.
            #     This is CRITICAL because Netflix's JS bundles contain route
            #     names like "tvLoginSuccess", "loginComplete", "/tv/out/success"
            #     on EVERY page load (they're moneyballPaths mapping entries).
            #     If we search the raw HTML, we get false-positive success on
            #     every single activation attempt — including wrong codes.
            clean_text = r.text
            clean_text = re.sub(r'<script[^>]*>.*?</script>', '', clean_text,
                                flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<style[^>]*>.*?</style>', '', clean_text,
                                flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
            clean_text = html_mod.unescape(clean_text)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()

            logger.info(f"Activation clean text (first 300): {clean_text[:300]}")

            # 3d: Error detection FIRST — must run BEFORE any success check.
            #     Netflix returns localized error messages (Turkish, Spanish,
            #     Arabic, etc.) based on the proxy IP or account locale.
            #     If error detection runs after a broken success check, the
            #     bot never reaches the error patterns and reports a false
            #     success for every wrong code.
            if self._is_tv_code_error(clean_text):
                return {"success": False, "error_type": "invalid_code",
                        "message": "❌ Incorrect or expired TV code."}

            # 3e: reactContext flow-mode success — Netflix's React SPA may
            #     transition the flow mode to a success state inside the
            #     reactContext JSON without redirecting. But we MUST only
            #     check inside the actual "mode" field value in the cleaned
            #     text (scripts stripped), NOT the full raw HTML. The raw
            #     HTML always contains "tvLoginSuccess" as a route/path
            #     definition in the JS bundles regardless of outcome.
            clean_text_lower = clean_text.lower()
            react_mode_success = False
            # These patterns only match the actual reactContext mode value,
            # not JS route definitions (which were stripped above)
            for marker in ['"mode":"tvloginsuccess"', '"mode": "tvloginsuccess"',
                           '"mode":"logincomplete"', '"mode": "logincomplete"',
                           'mode tvloginsuccess', 'mode logincomplete']:
                if marker in clean_text_lower:
                    react_mode_success = True
                    break
            if react_mode_success:
                logger.info("TV activation SUCCESS: reactContext flow-mode transition")
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

            # 3f: Success text patterns (FreeTV.py's explicit success indicators)
            if self._is_tv_code_success(final_url, clean_text):
                # Text-based success detected — VERIFY by re-fetching /tv8
                # to confirm the PIN form is actually gone.
                logger.info("TV activation text-pattern success detected, verifying...")
                verify_passed = True
                try:
                    import time as _time
                    _time.sleep(1.5)
                    verify_r = curl_session.get("https://www.netflix.com/tv8", **base_kwargs)
                    # Strip JS from verify response too — same false-positive risk
                    verify_clean = re.sub(r'<script[^>]*>.*?</script>', '', verify_r.text,
                                          flags=re.DOTALL | re.IGNORECASE)
                    verify_lower = verify_clean.lower()

                    # If PIN form is STILL showing → false positive
                    if ("pin-number-input" in verify_lower or
                            "entertvloginrendezvouscode" in verify_lower or
                            "witcher-code-form" in verify_lower):
                        # Double-check: does the cleaned verify page also
                        # show a success message in visible text?
                        has_success_in_verify = any(
                            m in verify_lower for m in
                            ['your tv is ready', 'device activated',
                             'tu tv est', 'sua tv est', 'votre t',
                             'dein tv ist', 'activation complete']
                        )
                        if has_success_in_verify:
                            logger.info("TV activation verify: PIN form + success text both present → trusting success")
                        else:
                            logger.warning("TV activation FALSE POSITIVE — PIN form still showing after delay")
                            verify_passed = False
                except Exception as e:
                    logger.warning(f"Post-activation verify failed: {e}, trusting original success")

                if verify_passed:
                    logger.info("TV activation SUCCESS: verified via text pattern + /tv8 re-check")
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
                else:
                    return {"success": False, "error_type": "not_accepted",
                            "message": "❌ Code was not accepted. Please try a fresh code."}

            # 3g: Session expired (redirected to login)
            if "login" in final_url_lower or "signin" in final_url_lower:
                return {"success": False, "error_type": "session_expired",
                        "message": "❌ Session expired. Cookie is no longer valid."}

            # 3h: Everything else → AMBIGUOUS (retryable, never assume success)
            logger.warning(f"TV activation AMBIGUOUS — will retry. "
                           f"URL={final_url}, status={r.status_code}, "
                           f"text_preview={clean_text[:200]}")
            return {
                "success": False,
                "error_type": "activation_ambiguous",
                "message": f"⚠️ Unexpected response (status {r.status_code}). Retrying..."
            }

        except Exception as e:
            logger.error(f"Error activating TV: {e}")
            return {"success": False, "error_type": "error",
                    "message": f"❌ Error: {str(e)}"}
        finally:
            try:
                curl_session.close()
            except Exception:
                pass

