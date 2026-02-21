const express = require("express");
const { google } = require("googleapis");
const http = require("http");
const socketIo = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*" }
});

const VIDEO_ID = process.env.VIDEO_ID;

// 🔥 5 API KEYS SETUP
const API_KEYS = [
  process.env.YT_API_KEY_1,
  process.env.YT_API_KEY_2,
  process.env.YT_API_KEY_3,
  process.env.YT_API_KEY_4,
  process.env.YT_API_KEY_5
].filter(key => key);

if (API_KEYS.length === 0 || !VIDEO_ID) {
  console.error("❌ API Keys or VIDEO_ID missing");
  process.exit(1);
}

console.log(`🔑 ${API_KEYS.length} API keys loaded`);

let currentKeyIndex = 0;
let dailyQuotaUsed = [0, 0, 0, 0, 0];
const DAILY_LIMIT = 10000;
const COST_PER_CALL = 5;

function getCurrentKey() {
  return API_KEYS[currentKeyIndex];
}

function switchApiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log(`🔄 Switched to API Key ${currentKeyIndex + 1}/${API_KEYS.length}`);
  return google.youtube({ version: "v3", auth: getCurrentKey() });
}

function getYoutube() {
  return google.youtube({ version: "v3", auth: getCurrentKey() });
}

// 🔥 GAME STATE
let votes = {};
let lastVoter = {};
let processedMessages = new Set();
let nextPageToken = null;
let currentLiveChatId = null;
let isRoundActive = false;
let isGameOver = true;
let currentTarget = null;
let canAcceptTarget = false;
let roundComments = [];

// 🔥 COUNTRY MAP
const countryMap = {
  "af":"afghanistan","al":"albania","dz":"algeria","ad":"andorra","ao":"angola",
  "ag":"antigua","ar":"argentina","am":"armenia","au":"australia","at":"austria",
  "az":"azerbaijan","bs":"bahamas","bh":"bahrain","bd":"bangladesh","bb":"barbados",
  "by":"belarus","be":"belgium","bz":"belize","bj":"benin","bt":"bhutan",
  "bo":"bolivia","ba":"bosnia","bw":"botswana","br":"brazil","bn":"brunei",
  "bg":"bulgaria","bf":"burkina","bi":"burundi","kh":"cambodia","cm":"cameroon",
  "ca":"canada","cv":"cape verde","cf":"central african","td":"chad","cl":"chile",
  "cn":"china","co":"colombia","km":"comoros","cg":"congo","cr":"costa rica",
  "hr":"croatia","cu":"cuba","cy":"cyprus","cz":"czechia","dk":"denmark",
  "dj":"djibouti","dm":"dominica","do":"dominican rep","ec":"ecuador","eg":"egypt",
  "sv":"el salvador","gq":"eq. guinea","er":"eritrea","ee":"estonia","sz":"eswatini",
  "et":"ethiopia","fj":"fiji","fi":"finland","fr":"france","ga":"gabon",
  "gm":"gambia","ge":"georgia","de":"germany","gh":"ghana","gr":"greece",
  "gd":"grenada","gt":"guatemala","gn":"guinea","gw":"guinea-bissau","gy":"guyana",
  "ht":"haiti","hn":"honduras","hu":"hungary","is":"iceland","in":"india",
  "id":"indonesia","ir":"iran","iq":"iraq","ie":"ireland","il":"israel",
  "it":"italy","jm":"jamaica","jp":"japan","jo":"jordan","kz":"kazakhstan",
  "ke":"kenya","ki":"kiribati","kp":"north korea","kr":"south korea","kw":"kuwait",
  "kg":"kyrgyzstan","la":"laos","lv":"latvia","lb":"lebanon","ls":"lesotho",
  "lr":"liberia","ly":"libya","li":"liechtenstein","lt":"lithuania","lu":"luxembourg",
  "mg":"madagascar","mw":"malawi","my":"malaysia","mv":"maldives","ml":"mali",
  "mt":"malta","mh":"marshall is","mr":"mauritania","mu":"mauritius","mx":"mexico",
  "fm":"micronesia","md":"moldova","mc":"monaco","mn":"mongolia","me":"montenegro",
  "ma":"morocco","mz":"mozambique","mm":"myanmar","na":"namibia","nr":"nauru",
  "np":"nepal","nl":"netherlands","nz":"new zealand","ni":"nicaragua","ne":"niger",
  "ng":"nigeria","mk":"north macedonia","no":"norway","om":"oman","pk":"pakistan",
  "pw":"palau","pa":"panama","pg":"papua ng","py":"paraguay","pe":"peru",
  "ph":"philippines","pl":"poland","pt":"portugal","qa":"qatar","ro":"romania",
  "ru":"russia","rw":"rwanda","kn":"saint kitts","lc":"saint lucia","vc":"saint vincent",
  "ws":"samoa","sm":"san marino","st":"sao tome","sa":"saudi arabia","sn":"senegal",
  "rs":"serbia","sc":"seychelles","sl":"sierra leone","sg":"singapore","sk":"slovakia",
  "si":"slovenia","sb":"solomon is","so":"somalia","za":"south africa","ss":"south sudan",
  "es":"spain","lk":"sri lanka","sd":"sudan","sr":"suriname","se":"sweden",
  "ch":"switzerland","sy":"syria","tw":"taiwan","tj":"tajikistan","tz":"tanzania",
  "th":"thailand","tl":"timor-leste","tg":"togo","to":"tonga","tt":"trinidad",
  "tn":"tunisia","tr":"turkey","tm":"turkmenistan","tv":"tuvalu","ug":"uganda",
  "ua":"ukraine","ae":"uae","gb":"uk","us":"usa","uy":"uruguay","uz":"uzbekistan",
  "vu":"vanuatu","va":"vatican","ve":"venezuela","vn":"vietnam","ye":"yemen",
  "zm":"zambia","zw":"zimbabwe"
};

const nameToCode = {};
for (let code in countryMap) {
  nameToCode[countryMap[code]] = code;
}

// 🔥 MULTILINGUAL COUNTRY DETECTION
const multilingualCountries = {
  // English variations
  "india": "in", "america": "us", "usa": "us", "united states": "us",
  "united states of america": "us", "brazil": "br", "indonesia": "id",
  "mexico": "mx", "japan": "jp", "pakistan": "pk", "vietnam": "vn",
  "philippines": "ph", "turkey": "tr", "russia": "ru", "china": "cn",
  "uk": "gb", "england": "gb", "britain": "gb", "germany": "de",
  "france": "fr", "italy": "it", "spain": "es", "canada": "ca",
  "australia": "au", "korea": "kr", "south korea": "kr",
  
  // 🔥 HINDI (भारत)
  "भारत": "in", "इंडिया": "in", "हिंदुस्तान": "in", "भारतवर्ष": "in",
  
  // 🔥 URDU (پاکستان)
  "پاکستان": "pk", "پاکِستان": "pk",
  
  // 🔥 ARABIC (السعودية, مصر, etc)
  "السعودية": "sa", "مصر": "eg", "الإمارات": "ae", "الامارات": "ae",
  "المغرب": "ma", "الجزائر": "dz", "تونس": "tn", "ليبيا": "ly",
  "العراق": "iq", "سوريا": "sy", "الأردن": "jo", "لبنان": "lb",
  "فلسطين": "ps", "قطر": "qa", "الكويت": "kw", "البحرين": "bh",
  "عمان": "om", "اليمن": "ye", "السودان": "sd", "الصومال": "so",
  
  // 🔥 SPANISH (España, México, etc)
  "españa": "es", "méxico": "mx", "argentina": "ar", "colombia": "co",
  "chile": "cl", "perú": "pe", "peru": "pe", "venezuela": "ve",
  "ecuador": "ec", "guatemala": "gt", "cuba": "cu", "bolivia": "bo",
  "república dominicana": "do", "honduras": "hn", "paraguay": "py",
  "el salvador": "sv", "nicaragua": "ni", "costa rica": "cr",
  "puerto rico": "pr", "panamá": "pa", "panama": "pa", "uruguay": "uy",
  
  // 🔥 FRENCH (France, etc)
  "france": "fr", "francia": "fr", "allemagne": "de", "espagne": "es",
  "italie": "it", "royaume-uni": "gb", "états-unis": "us", "canada": "ca",
  "brésil": "br", "argentine": "ar", "mexique": "mx", "chine": "cn",
  "japon": "jp", "inde": "in", "russie": "ru", "turquie": "tr",
  
  // 🔥 PORTUGUESE (Brasil, etc)
  "brasil": "br", "portugal": "pt", "angola": "ao", "moçambique": "mz",
  "mozambique": "mz", "cabo verde": "cv", "guiné-bissau": "gw",
  "guine-bissau": "gw", "são tomé": "st", "sao tome": "st",
  "timor-leste": "tl", "timor leste": "tl",
  
  // 🔥 RUSSIAN (Россия, etc)
  "россия": "ru", "русия": "ru", "ссср": "ru", "украина": "ua",
  "україна": "ua", "беларусь": "by", "казахстан": "kz",
  
  // 🔥 CHINESE (中国, etc)
  "中国": "cn", "中國": "cn", "中华人民共和国": "cn", "台湾": "tw",
  "臺灣": "tw", "香港": "hk", "日本": "jp", "韩国": "kr", "韓國": "kr",
  "朝鲜": "kp", "朝鮮": "kp", "印度": "in", "巴基斯坦": "pk",
  "印度尼西亚": "id", "印度尼西亞": "id", "泰国": "th", "泰國": "th",
  "越南": "vn", "马来西亚": "my", "馬來西亞": "my", "菲律宾": "ph",
  "菲律賓": "ph", "新加坡": "sg", "缅甸": "mm", "緬甸": "mm",
  
  // 🔥 JAPANESE (日本, etc)
  "日本": "jp", "にほん": "jp", "にっぽん": "jp", "韓国": "kr",
  "かんこく": "kr", "中国": "cn", "ちゅうごく": "cn", "インド": "in",
  "いんど": "in", "ロシア": "ru", "ろしあ": "ru", "アメリカ": "us",
  "あめりか": "us", "イギリス": "gb", "いぎりす": "gb", "ドイツ": "de",
  "どいつ": "de", "フランス": "fr", "ふらんす": "fr", "イタリア": "it",
  "いたりあ": "it", "ブラジル": "br", "ぶらじる": "br",
  
  // 🔥 KOREAN (한국, etc)
  "한국": "kr", "대한민국": "kr", "남한": "kr", "북한": "kp",
  "조선": "kp", "미국": "us", "영국": "gb", "독일": "de", "프랑스": "fr",
  "이탈리아": "it", "일본": "jp", "중국": "cn", "인도": "in",
  "러시아": "ru", "브라질": "br", "멕시코": "mx", "인도네시아": "id",
  "터키": "tr", "사우디아라비아": "sa",
  
  // 🔥 BENGALI (বাংলাদেশ, ভারত)
  "বাংলাদেশ": "bd", "ভারত": "in", "ভারতবর্ষ": "in", "পাকিস্তান": "pk",
  
  // 🔥 TAMIL (இந்தியா, etc)
  "இந்தியா": "in", "பாகிஸ்தான்": "pk", "இலங்கை": "lk", "சீனா": "cn",
  "ஜப்பான்": "jp", "கொரியா": "kr", "அமெரிக்கா": "us", "ஐக்கிய அமெரிக்கா": "us",
  "ஐக்கிய இராச்சியம்": "gb", "பிரான்ஸ்": "fr", "ஜெர்மனி": "de",
  
  // 🔥 TELUGU (భారతదేశం, etc)
  "భారతదేశం": "in", "భారత్": "in", "పాకిస్తాన్": "pk", "అమెరికా": "us",
  "చైనా": "cn", "జపాన్": "jp",
  
  // 🔥 MARATHI (भारत, etc)
  "भारत": "in", "भारतदेश": "in", "पाकिस्तान": "pk",
  
  // 🔥 PUNJABI (ਭਾਰਤ, etc)
  "ਭਾਰਤ": "in", "ਭਾਰਤਦੇਸ਼": "in", "ਪਾਕਿਸਤਾਨ": "pk",
  
  // 🔥 GUJARATI (ભારત, etc)
  "ભારત": "in", "પાકિસ્તાન": "pk",
  
  // 🔥 MALAYALAM (ഇന്ത്യ, etc)
  "ഇന്ത്യ": "in", "പാക്കിസ്ഥാൻ": "pk",
  
  // 🔥 KANNADA (ಭಾರತ, etc)
  "ಭಾರತ": "in", "ಪಾಕಿಸ್ತಾನ": "pk",
  
  // 🔥 THAI (ประเทศไทย, etc)
  "ไทย": "th", "ประเทศไทย": "th", "เมืองไทย": "th",
  
  // 🔥 VIETNAMESE (Việt Nam, etc)
  "việt nam": "vn", "vietnam": "vn", "việtnam": "vn",
  
  // 🔥 INDONESIAN/MALAY (Indonesia, Malaysia)
  "indonesia": "id", "malaysia": "my", "singapura": "sg", "singapore": "sg",
  "thailand": "th", "filipina": "ph", "vietnam": "vn", "kamboja": "kh",
  "myanmar": "mm", "laos": "la", "brunei": "bn", "timor leste": "tl",
  
  // 🔥 GERMAN (Deutschland, etc)
  "deutschland": "de", "österreich": "at", "schweiz": "ch",
  "vereinigte staaten": "us", "vereinigtes königreich": "gb",
  "frankreich": "fr", "italien": "it", "spanien": "es",
  
  // 🔥 ITALIAN (Italia, etc)
  "italia": "it", "stati uniti": "us", "regno unito": "gb",
  "francia": "fr", "germania": "de", "spagna": "es",
  
  // 🔥 DUTCH (Nederland, etc)
  "nederland": "nl", "belgië": "be", "belgie": "be",
  "verenigde staten": "us", "verenigd koninkrijk": "gb",
  "duitsland": "de", "frankrijk": "fr",
  
  // 🔥 POLISH (Polska, etc)
  "polska": "pl", "stany zjednoczone": "us", "wielka brytania": "gb",
  "niemcy": "de", "francja": "fr", "włochy": "it", "hiszpania": "es",
  "rosja": "ru", "chiny": "cn", "japonia": "jp", "korea": "kr",
  
  // 🔥 TURKISH (Türkiye, etc)
  "türkiye": "tr", "turkiye": "tr", "türkei": "tr", "turkey": "tr",
  "almanya": "de", "amerika": "us", "birleşik krallık": "gb",
  "fransa": "fr", "italya": "it", "ispanya": "es", "çin": "cn",
  "japonya": "jp", "kore": "kr", "hindistan": "in", "pakistan": "pk",
  "iran": "ir", "ırak": "iq", "israil": "il", "suudi arabistan": "sa",
  "misir": "eg", "endonezya": "id", "brezilya": "br", "meksika": "mx",
  "arjantin": "ar", "rusya": "ru", "ukrayna": "ua",
  
  // 🔥 PERSIAN/FARSI (ایران, etc)
  "ایران": "ir", "ایران": "ir", "عراق": "iq", "افغانستان": "af",
  "پاکستان": "pk", "هند": "in", "ترکیه": "tr", "عربستان": "sa",
  
  // 🔥 HEBREW (ישראל, etc)
  "ישראל": "il", "אמריקה": "us", "אנגליה": "gb", "צרפת": "fr",
  "גרמניה": "de", "איטליה": "it", "סין": "cn", "יפן": "jp",
  
  // 🔥 GREEK (Ελλάδα, etc)
  "ελλάδα": "gr", "ελλας": "gr", "ηπα": "us", "ηνωμένο βασίλειο": "gb",
  "γαλλία": "fr", "γερμανία": "de", "ιταλία": "it", "ισπανία": "es",
  "ρωσία": "ru", "κίνα": "cn", "ιαπωνία": "jp", "κορέα": "kr",
  
  // 🔥 SWEDISH (Sverige, etc)
  "sverige": "se", "norge": "no", "danmark": "dk", "suomi": "fi",
  "förenta staterna": "us", "storbritannien": "gb",
  
  // 🔥 FINNISH (Suomi, etc)
  "suomi": "fi", "yhdysvallat": "us", "yhdistynyt kuningaskunta": "gb",
  
  // 🔥 CZECH (Česko, etc)
  "česko": "cz", "česká republika": "cz", "spojené státy": "us",
  "velká británie": "gb", "německo": "de", "francie": "fr",
  
  // 🔥 HUNGARIAN (Magyarország, etc)
  "magyarország": "hu", "egyesült államok": "us", "egyesült királyság": "gb",
  "németország": "de", "franciaország": "fr", "olaszország": "it",
  
  // 🔥 ROMANIAN (România, etc)
  "românia": "ro", "romania": "ro", "statele unite": "us",
  "marea britanie": "gb", "germania": "de", "franța": "fr",
  
  // 🔥 BULGARIAN (България, etc)
  "българия": "bg", "сащ": "us", "великобритания": "gb",
  "германия": "de", "франция": "fr", "русия": "ru",
  
  // 🔥 SERBIAN (Србија, etc)
  "србија": "rs", "srbija": "rs", "хрватска": "hr", "hrvatska": "hr",
  "словенија": "si", "slovenija": "si", "босна": "ba", "bosna": "ba",
  
  // 🔥 CROATIAN (Hrvatska, etc)
  "hrvatska": "hr", "sjedinjene države": "us", "velika britanija": "gb",
  "njemačka": "de", "francuska": "fr", "talijanska": "it",
  
  // 🔥 UKRAINIAN (Україна, etc)
  "україна": "ua", "украина": "ua", "сша": "us", "велика британія": "gb",
  "німеччина": "de", "франція": "fr", "росія": "ru", "китай": "cn",
  
  // 🔥 CATALAN (Espanya, etc)
  "espanya": "es", "estats units": "us", "regne unit": "gb",
  "alemanya": "de", "frança": "fr", "itàlia": "it",
  
  // 🔥 FILIPINO/TAGALOG (Pilipinas, etc)
  "pilipinas": "ph", "philippines": "ph", "estados unidos": "us",
  "amerika": "us", "hapon": "jp", "tsina": "cn", "indya": "in",
  
  // 🔥 SWAHILI (Kenya, Tanzania, etc)
  "kenya": "ke", "tanzania": "tz", "uganda": "ug", "nigeria": "ng",
  "afrika kusini": "za", "misri": "eg", "ethiopia": "et", "ghana": "gh",
  
  // 🔥 AFRIKAANS (Suid-Afrika, etc)
  "suid-afrika": "za", "verenigde state": "us", "verenigde koninkryk": "gb",
  "duitsland": "de", "frankryk": "fr",
  
  // 🔥 AMHARIC (ኢትዮጵያ, etc)
  "ኢትዮጵያ": "et", "ኢትዮጵያ": "et",
  
  // 🔥 ZULU (iNingizimu Afrika, etc)
  "iningizimu afrika": "za",
  
  // 🔥 HAUSA (Nijeriya, etc)
  "nijeriya": "ng", "najeriya": "ng",
  
  // 🔥 YORUBA (Nàìjíríà, etc)
  "nàìjíríà": "ng",
  
  // 🔥 IGBO (Naịjịrịa, etc)
  "naịjịrịa": "ng",
  
  // 🔥 SOMALI (Soomaaliya, etc)
  "soomaaliya": "so", "soomaaliya": "so",
  
  // 🔥 HAWAIIAN (ʻAmelika, etc)
  "ʻamelika": "us", "pelekānea": "gb",
  
  // 🔥 MAORI (Aotearoa, etc)
  "aotearoa": "nz", "amerika": "us", "ingarangi": "gb",
  
  // 🔥 SAMOAN (Amerika Sāmoa, etc)
  "amerika sāmoa": "as", "sāmoa": "ws",
  
  // 🔥 TONGAN (Tonga, etc)
  "tonga": "to",
  
  // 🔥 FIJIAN/HINDI (Viti, etc)
  "viti": "fj", "फ़िजी": "fj",
  
  // 🔥 TAMAZIGHT/BERBER (ⵍⵎⵖⵔⵉⴱ, etc)
  "ⵍⵎⵖⵔⵉⴱ": "ma", "ⵜⴰⴳⵍⴷⵉⵜ ⵏ ⵍⵎⵖⵔⵉⴱ": "ma",
  
  // 🔥 KURDISH (Kurdistan, etc)
  "kurdistan": "iq", "كوردستان": "iq", "kurdistanê": "iq",
  
  // 🔥 UZBEK (Oʻzbekiston, etc)
  "oʻzbekiston": "uz", "ozbekistan": "uz", "ўзбекистон": "uz",
  
  // 🔥 KAZAKH (Қазақстан, etc)
  "қазақстан": "kz", "казахстан": "kz", "qazaqstan": "kz",
  
  // 🔥 KYRGYZ (Кыргызстан, etc)
  "кыргызстан": "kg", "kyrgyzstan": "kg", "qırğızistan": "kg",
  
  // 🔥 TAJIK (Тоҷикистон, etc)
  "тоҷикистон": "tj", "tajikistan": "tj",
  
  // 🔥 TURKMEN (Türkmenistan, etc)
  "türkmenistan": "tm", "turkmenistan": "tm",
  
  // 🔥 MONGOLIAN (Монгол, etc)
  "монгол": "mn", "mongol": "mn", "монгол улс": "mn",
  
  // 🔥 NEPALI (नेपाल, etc)
  "नेपाल": "np", "nepal": "np",
  
  // 🔥 SINHALA (ශ්‍රී ලංකා, etc)
  "ශ්‍රී ලංකා": "lk", "sri lanka": "lk", "ilankai": "lk",
  
  // 🔥 LAO (ລາວ, etc)
  "ລາວ": "la", "lao": "la", "ສປປລາວ": "la",
  
  // 🔥 MYANMAR/BURMESE (မြန်မာ, etc)
  "မြန်မာ": "mm", "myanmar": "mm", "burma": "mm",
  
  // 🔥 KHMER (កម្ពុជា, etc)
  "កម្ពុជា": "kh", "kampuchea": "kh", "cambodia": "kh",
  
  // 🔥 HMONG (Hmoob, etc)
  "hmoob teb": "cn", "hmoob": "cn",
  
  // 🔥 PASHTO (افغانستان, etc)
  "افغانستان": "af", "afghanistan": "af",
  
  // 🔥 DHIVEHI (ދިވެހިރާއްޖޭ, etc)
  "ދިވެހިރާއްޖޭ": "mv", "maldives": "mv",
  
  // 🔥 TIBETAN (བོད་, etc)
  "བོད་": "cn", "tibet": "cn",
  
  // 🔥 UYGHUR (شىنجاڭ, etc)
  "شىنجاڭ": "cn", "xinjiang": "cn",
  
  // 🔥 BELARUSIAN (Беларусь, etc)
  "беларусь": "by", "белоруссия": "by", "belarus": "by",
  
  // 🔥 MOLDOVAN (Moldova, etc)
  "moldova": "md", "молдова": "md",
  
  // 🔥 ESTONIAN (Eesti, etc)
  "eesti": "ee", "estonia": "ee",
  
  // 🔥 LATVIAN (Latvija, etc)
  "latvija": "lv", "latvia": "lv",
  
  // 🔥 LITHUANIAN (Lietuva, etc)
  "lietuva": "lt", "lithuania": "lt",
  
  // 🔥 SLOVAK (Slovensko, etc)
  "slovensko": "sk", "slovakia": "sk",
  
  // 🔥 SLOVENIAN (Slovenija, etc)
  "slovenija": "si", "slovenia": "si",
  
  // 🔥 MACEDONIAN (Македонија, etc)
  "македонија": "mk", "makedonija": "mk", "north macedonia": "mk",
  
  // 🔥 ALBANIAN (Shqipëria, etc)
  "shqipëria": "al", "shqiperia": "al", "albania": "al",
  
  // 🔥 BOSNIAN (Bosna, etc)
  "bosna i hercegovina": "ba", "bosnia": "ba",
  
  // 🔥 MONTENEGRIN (Crna Gora, etc)
  "crna gora": "me", "montenegro": "me", "црна гора": "me",
  
  // 🔥 ARMENIAN (Հայաստան, etc)
  "հայաստան": "am", "hayastan": "am", "armenia": "am",
  
  // 🔥 AZERBAIJANI (Azərbaycan, etc)
  "azərbaycan": "az", "azerbaijan": "az", "azerbaycan": "az",
  
  // 🔥 GEORGIAN (საქართველო, etc)
  "საქართველო": "ge", "sakartvelo": "ge", "georgia": "ge",
  
  // 🔥 MALTESE (Malta, etc)
  "malta": "mt",
  
  // 🔥 ICELANDIC (Ísland, etc)
  "ísland": "is", "iceland": "is",
  
  // 🔥 LUXEMBOURGISH (Lëtzebuerg, etc)
  "lëtzebuerg": "lu", "luxembourg": "lu", "luxemburg": "lu",
  
  // 🔥 IRISH (Éire, etc)
  "éire": "ie", "eire": "ie", "ireland": "ie",
  
  // 🔥 WELSH (Cymru, etc)
  "cymru": "gb", "wales": "gb", "cymru": "gb",
  
  // 🔥 SCOTS GAELIC (Alba, etc)
  "alba": "gb", "scotland": "gb",
  
  // 🔥 BASQUE (Euskal Herria, etc)
  "euskal herria": "es", "basque": "es", "pais vasco": "es",
  
  // 🔥 CATALAN (Catalunya, etc)
  "catalunya": "es", "catalonia": "es",
  
  // 🔥 GALICIAN (Galicia, etc)
  "galicia": "es", "galiza": "es",
  
  // 🔥 OCCITAN (Occitània, etc)
  "occitània": "fr", "occitania": "fr",
  
  // 🔥 BRETON (Breizh, etc)
  "breizh": "fr", "brittany": "fr",
  
  // 🔥 CORNISH (Kernow, etc)
  "kernow": "gb", "cornwall": "gb",
  
  // 🔥 MANX (Mannin, etc)
  "mannin": "im", "isle of man": "im",
  
  // 🔥 JERSEY (Jèrri, etc)
  "jèrri": "je", "jersey": "je",
  
  // 🔥 GUERNSEY (Guernési, etc)
  "guernési": "gg", "guernsey": "gg",
  
  // 🔥 FAROESE (Føroyar, etc)
  "føroyar": "fo", "faroe": "fo", "faroe islands": "fo",
  
  // 🔥 GREENLANDIC (Kalaallit Nunaat, etc)
  "kalaallit nunaat": "gl", "greenland": "gl",
  
  // 🔥 SÁMI (Sápmi, etc)
  "sápmi": "no", "sapmi": "no", "samiland": "no",
  
  // 🔥 INUKTITUT (ᓄᓇᕗᑦ, etc)
  "ᓄᓇᕗᑦ": "ca", "nunavut": "ca",
  
  // 🔥 HAITIAN CREOLE (Ayiti, etc)
  "ayiti": "ht", "haiti": "ht",
  
  // 🔥 JAMAICAN PATOIS (Jamrock, etc - informal)
  "jamrock": "jm", "jamaica": "jm",
  
  // 🔥 BAJAN (Bimshire, etc - informal)
  "bim": "bb", "barbados": "bb",
  
  // 🔥 TRINI (Trini, etc - informal)
  "trini": "tt", "trinidad": "tt",
  
  // 🔥 GUYANESE CREOLE (Guyana, etc)
  "guyana": "gy",
  
  // 🔥 SURINAMESE (Sranan, etc)
  "sranan": "sr", "suriname": "sr",
  
  // 🔥 GRENADIAN (Grenada, etc)
  "grenada": "gd",
  
  // 🔥 VINCENTIAN (Vincy, etc - informal)
  "vincy": "vc", "st vincent": "vc",
  
  // 🔥 LUCIAN (Saint Lucia, etc)
  "saint lucia": "lc", "st lucia": "lc",
  
  // 🔥 KITTITIAN (St Kitts, etc)
  "st kitts": "kn", "saint kitts": "kn",
  
  // 🔥 ANTIGUAN (Antigua, etc)
  "antigua": "ag", "antigua and barbuda": "ag",
  
  // 🔥 DOMINICAN (Dominica, etc)
  "dominica": "dm",
  
  // 🔥 BAHAMIAN (Bahamas, etc)
  "bahamas": "bs",
  
  // 🔥 CAYMANIAN (Cayman, etc)
  "cayman": "ky", "cayman islands": "ky",
  
  // 🔥 BERMUDIAN (Bermuda, etc)
  "bermuda": "bm",
  
  // 🔥 TURKS AND CAICOS (TCI, etc)
  "turks and caicos": "tc", "tci": "tc",
  
  // 🔥 BRITISH VIRGIN ISLANDS (BVI, etc)
  "british virgin islands": "vg", "bvi": "vg",
  
  // 🔥 US VIRGIN ISLANDS (USVI, etc)
  "us virgin islands": "vi", "usvi": "vi",
  
  // 🔥 ANGUILLAN (Anguilla, etc)
  "anguilla": "ai",
  
  // 🔥 MONTSERRATIAN (Montserrat, etc)
  "montserrat": "ms",
  
  // 🔥 ARUBAN (Aruba, etc)
  "aruba": "aw",
  
  // 🔥 CURAÇAOAN (Curaçao, etc)
  "curaçao": "cw", "curacao": "cw",
  
  // 🔥 BONAIRE (Bonaire, etc)
  "bonaire": "bq",
  
  // 🔥 SABA (Saba, etc)
  "saba": "bq",
  
  // 🔥 SINT EUSTATIUS (Statia, etc)
  "statia": "bq", "sint eustatius": "bq",
  
  // 🔥 SINT MAARTEN (St Maarten, etc)
  "st maarten": "sx", "sint maarten": "sx",
  
  // 🔥 SAINT MARTIN (St Martin, etc - French side)
  "st martin": "mf", "saint martin": "mf",
  
  // 🔥 SAINT BARTHÉLEMY (St Barths, etc)
  "st barths": "bl", "saint barthélemy": "bl", "saint barthelemy": "bl",
  
  // 🔥 SAINT PIERRE AND MIQUELON (St Pierre, etc)
  "st pierre": "pm", "saint pierre": "pm",
  
  // 🔥 FRENCH GUIANA (Guyane, etc)
  "guyane": "gf", "french guiana": "gf",
  
  // 🔥 FALKLAND ISLANDS (Malvinas, etc)
  "falkland": "fk", "malvinas": "fk", "falkland islands": "fk",
  
  // 🔥 SOUTH GEORGIA (SGSSI, etc)
  "south georgia": "gs",
  
  // 🔥 GIBRALTAR (Gib, etc)
  "gibraltar": "gi", "gib": "gi",
  
  // 🔥 MALTESE (Malta, etc)
  "malta": "mt",
  
  // 🔥 CYPRUS (Kypros, etc)
  "kypros": "cy", "cyprus": "cy", "kıbrıs": "cy",
  
  // 🔥 ÅLAND ISLANDS (Åland, etc)
  "åland": "ax", "aland": "ax",
  
  // 🔥 CHANNEL ISLANDS (Jersey/Guernsey already covered)
  
  // 🔥 ISLE OF MAN (Mann, etc)
  "mann": "im", "isle of man": "im",
  
  // 🔥 COCOS ISLANDS (Cocos, etc)
  "cocos": "cc", "keeling": "cc",
  
  // 🔥 CHRISTMAS ISLAND (Christmas, etc)
  "christmas island": "cx",
  
  // 🔥 NORFOLK ISLAND (Norfolk, etc)
  "norfolk island": "nf",
  
  // 🔥 NAURU (Nauru, etc)
  "nauru": "nr",
  
  // 🔥 TUVALU (Tuvalu, etc)
  "tuvalu": "tv",
  
  // 🔥 KIRIBATI (Kiribati, etc)
  "kiribati": "ki",
  
  // 🔥 MARSHALL ISLANDS (Marshall, etc)
  "marshall islands": "mh",
  
  // 🔥 PALAU (Palau, etc)
  "palau": "pw",
  
  // 🔥 MICRONESIA (FSM, etc)
  "micronesia": "fm", "fsm": "fm",
  
  // 🔥 SAMOA (Samoa, etc)
  "samoa": "ws", "western samoa": "ws",
  
  // 🔥 AMERICAN SAMOA (AmSam, etc)
  "american samoa": "as", "amsam": "as",
  
  // 🔥 TONGA (Tonga, etc)
  "tonga": "to",
  
  // 🔥 VANUATU (Vanuatu, etc)
  "vanuatu": "vu",
  
  // 🔥 FIJI (Fiji, etc)
  "fiji": "fj",
  
  // 🔥 SOLOMON ISLANDS (Solomons, etc)
  "solomon islands": "sb", "solomons": "sb",
  
  // 🔥 PAPUA NEW GUINEA (PNG, etc)
  "papua new guinea": "pg", "png": "pg",
  
  // 🔥 NEW CALEDONIA (Nouvelle-Calédonie, etc)
  "nouvelle-calédonie": "nc", "new caledonia": "nc",
  
  // 🔥 FRENCH POLYNESIA (Tahiti, etc)
  "tahiti": "pf", "french polynesia": "pf",
  
  // 🔥 WALLIS AND FUTUNA (Wallis, etc)
  "wallis": "wf", "wallis and futuna": "wf",
  
  // 🔥 NIUE (Niue, etc)
  "niue": "nu",
  
  // 🔥 COOK ISLANDS (Cook Islands, etc)
  "cook islands": "ck",
  
  // 🔥 TOKELAU (Tokelau, etc)
  "tokelau": "tk",
  
  // 🔥 PITCAIRN ISLANDS (Pitcairn, etc)
  "pitcairn": "pn",
  
  // 🔥 GUAM (Guam, etc)
  "guam": "gu",
  
  // 🔥 NORTHERN MARIANA ISLANDS (Saipan, etc)
  "saipan": "mp", "northern mariana": "mp",
  
  // 🔥 PUERTO RICO (Puerto Rico, etc)
  "puerto rico": "pr",
  
  // 🔥 US MINOR OUTLYING ISLANDS (USMOI, etc)
  "us minor outlying": "um",
  
  // 🔥 BRITISH INDIAN OCEAN TERRITORY (Chagos, etc)
  "chagos": "io", "british indian ocean": "io",
  
  // 🔥 HEARD ISLAND AND MCDONALD ISLANDS (Heard, etc)
  "heard island": "hm",
  
  // 🔥 BOUVET ISLAND (Bouvet, etc)
  "bouvet island": "bv",
  
  // 🔥 SVALBARD AND JAN MAYEN (Svalbard, etc)
  "svalbard": "sj", "jan mayen": "sj",
  
  // 🔥 ANTARCTICA (Antarctica, etc)
  "antarctica": "aq",
  
  // 🔥 FRENCH SOUTHERN TERRITORIES (TAAF, etc)
  "taaf": "tf", "french southern": "tf",
  
  // 🔥 SOUTH SANDWICH ISLANDS (South Sandwich, etc)
  "south sandwich": "gs"
};

async function getLiveChatId() {
  try {
    const youtube = getYoutube();
    const res = await youtube.videos.list({
      part: "liveStreamingDetails",
      id: VIDEO_ID
    });

    if (!res.data.items.length) {
      console.log("⚠ No active live found. Retrying...");
      setTimeout(startLiveCheck, 30000);
      return null;
    }

    const chatId = res.data.items[0].liveStreamingDetails?.activeLiveChatId;
    if (!chatId) {
      setTimeout(startLiveCheck, 30000);
      return null;
    }
    console.log("✅ Live chat connected");
    return chatId;
  } catch (err) {
    console.error("❌ Error getting live chat:", err.message);
    if (err.message.includes("quota")) {
      switchApiKey();
    }
    setTimeout(startLiveCheck, 30000);
    return null;
  }
}

// 🔥 DETECT COUNTRY FROM ANY LANGUAGE
function detectCountry(text) {
  // 🔥 CHECK: Agar text undefined/null hai toh return null
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lowerText = text.toLowerCase().trim();

  // Pehle check karo 2-letter code
  if (lowerText.length === 2 && countryMap[lowerText]) {
    return lowerText;
  }
  
  // Multilingual database check
  for (let name in multilingualCountries) {
    if (lowerText.includes(name)) {
      return multilingualCountries[name];
    }
  }
  
  // Original English names check
  for (let name in nameToCode) {
    if (lowerText.includes(name)) {
      return nameToCode[name];
    }
  }
  
  return null;
}

// 🔥 LIBRETRANSLATE API (FREE - No API key needed)
async function translateToEnglish(text) {
  try {
    const response = await axios.post("https://libretranslate.de/translate", {
      q: text,
      source: "auto",
      target: "en",
      format: "text"
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000
    });
    
    return response.data.translatedText;
  } catch (err) {
    console.log("⚠ Translation failed, using original:", err.message);
    return text;
  }
}

// 🔥 ALTERNATIVE: MyMemory API (FREE - 1000 words/day)
async function translateToEnglishMyMemory(text) {
  try {
    const encodedText = encodeURIComponent(text);
    const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=auto|en`;
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data.responseStatus === 200) {
      return response.data.responseData.translatedText;
    }
    return text;
  } catch (err) {
    console.log("⚠ MyMemory failed:", err.message);
    return text;
  }
}

async function fetchComments() {
  if (!currentLiveChatId) return;
  
  if (dailyQuotaUsed[currentKeyIndex] + COST_PER_CALL > DAILY_LIMIT) {
    console.log(`⚠ Key ${currentKeyIndex + 1} quota full (${dailyQuotaUsed[currentKeyIndex]}), switching...`);
    switchApiKey();
  }
  
  try {
    const youtube = getYoutube();
    const res = await youtube.liveChatMessages.list({
      liveChatId: currentLiveChatId,
      part: "snippet,authorDetails",
      pageToken: nextPageToken,
      maxResults: 200
    });

    dailyQuotaUsed[currentKeyIndex] += COST_PER_CALL;
    nextPageToken = res.data.nextPageToken;

    // 🔥 ASYNC LOOP for translation
    for (const msg of res.data.items) {
      if (processedMessages.has(msg.id)) continue;
      processedMessages.add(msg.id);
      if (!isRoundActive) continue;

      const originalText = msg.snippet?.displayMessage || "";
const username = msg.authorDetails?.displayName || "Anonymous";

// Agar message nahi hai toh skip karo
if (!originalText) continue;
      
      // 🔥 STEP 1: Check if original text has country (fastest)
      let countryCode = detectCountry(originalText);
      let translatedText = originalText;
      let usedTranslation = false;
      
      // 🔥 STEP 2: Agar nahi mila toh translate karo
      if (!countryCode) {
        // Pehle LibreTranslate try karo
        translatedText = await translateToEnglish(originalText);
        usedTranslation = true;
        
        // Translated text se country detect karo
        countryCode = detectCountry(translatedText);
        
        // Agar phir bhi nahi mila toh MyMemory try karo
        if (!countryCode && translatedText === originalText) {
          translatedText = await translateToEnglishMyMemory(originalText);
          countryCode = detectCountry(translatedText);
        }
      }
      
      // 🔥 STEP 3: Agar country mila toh process karo
      if (countryCode) {
        votes[countryCode] = (votes[countryCode] || 0) + 1;
        lastVoter[countryCode] = username;

        const commentData = {
          id: msg.id,
          username: username,
          originalMessage: originalText,      // Original language
          translatedMessage: translatedText,  // English mein
          message: translatedText,            // Game ke liye (English)
          countryCode: countryCode,
          countryName: countryMap[countryCode],
          wasTranslated: usedTranslation,
          timestamp: Date.now()
        };
        
        roundComments.push(commentData);
        io.emit("newComment", commentData);

        // 🔥 SET TARGET
        if (!currentTarget && canAcceptTarget && !isGameOver) {
          currentTarget = countryCode;
          console.log(`🎯 TARGET SET: ${countryMap[countryCode]} by ${username}`);
          if (usedTranslation) {
            console.log(`   Original: ${originalText}`);
            console.log(`   Translated: ${translatedText}`);
          }
        }

        console.log(`💬 ${username}: "${originalText.substring(0, 50)}${originalText.length > 50 ? '...' : ''}" → ${countryCode.toUpperCase()}`);
      }
    }

    io.emit("updateVotes", { votes, lastVoter });
    
    const interval = isRoundActive ? 10000 : 60000;
    setTimeout(fetchComments, interval);

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.message.includes("quota")) {
      switchApiKey();
      setTimeout(fetchComments, 5000);
      return;
    }
    setTimeout(fetchComments, 30000);
  }
}

async function startLiveCheck() {
  currentLiveChatId = await getLiveChatId();
  if (currentLiveChatId) fetchComments();
}

io.on("connection", (socket) => {
  console.log("👤 Client connected");
  socket.emit("updateVotes", { votes, lastVoter });
  
  // 🔥 ROUND START
  socket.on("startRound", () => {
    console.log("🟢 startRound received");
    
    if (isGameOver && currentTarget) {
      io.emit("roundReset");
      console.log("🔄 Previous round reset");
    }
    
    isRoundActive = true;
    isGameOver = false;
    currentTarget = null;
    canAcceptTarget = false;
    
    setTimeout(() => {
      canAcceptTarget = true;
      console.log("🎯 Now accepting target comments");
    }, 3000);
    
    console.log("🟢 Round STARTED - 3s delay before target");
  });

  // 🔥 GAME OVER
  socket.on("gameOver", () => {
    isGameOver = true;
    isRoundActive = false;
    canAcceptTarget = false;
    console.log("🎮 Game Over - Round ended");
  });

  // 🔥 END ROUND
  socket.on("endRound", () => {
    isRoundActive = false;
    canAcceptTarget = false;
    votes = {};
    lastVoter = {};
    roundComments = [];
    io.emit("updateVotes", { votes: {}, lastVoter: {} });
    console.log("🔴 Round ended");
  });

  socket.on("resetVotes", () => {
    votes = {};
    lastVoter = {};
    roundComments = [];
    io.emit("updateVotes", { votes: {}, lastVoter: {} });
    console.log("🔄 Manual Reset");
  });
});

app.get("/", (req, res) => res.send("🚀 Flag Battle Server"));
app.get("/health", (req, res) => res.json({ 
  status: "OK", 
  roundActive: isRoundActive,
  gameOver: isGameOver,
  currentTarget: currentTarget ? "HIDDEN" : null,
  currentKey: currentKeyIndex + 1,
  quotaUsed: dailyQuotaUsed
}));

server.listen(3000, () => {
  console.log("🔥 Server on port 3000");
  console.log(`🔑 ${API_KEYS.length} API keys loaded`);
  startLiveCheck();
});