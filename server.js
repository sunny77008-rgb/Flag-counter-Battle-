const express = require("express");
const { google } = require("googleapis");
const http = require("http");
const socketIo = require("socket.io");

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

function detectCountry(text) {
  const lowerText = text.toLowerCase().trim();
  if (lowerText.length === 2 && countryMap[lowerText]) {
    return lowerText;
  }
  for (let name in nameToCode) {
    if (lowerText.includes(name)) {
      return nameToCode[name];
    }
  }
  const variations = {
    "india": "in", "america": "us", "usa": "us", "united states": "us",
    "brazil": "br", "indonesia": "id", "mexico": "mx", "japan": "jp",
    "pakistan": "pk", "vietnam": "vn", "philippines": "ph", "turkey": "tr",
    "russia": "ru", "china": "cn", "uk": "gb", "england": "gb", 
    "britain": "gb", "germany": "de", "france": "fr", "italy": "it",
    "spain": "es", "canada": "ca", "australia": "au", "korea": "kr"
  };
  for (let varName in variations) {
    if (lowerText.includes(varName)) {
      return variations[varName];
    }
  }
  return null;
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

    res.data.items.forEach(msg => {
      if (processedMessages.has(msg.id)) return;
      processedMessages.add(msg.id);
      if (!isRoundActive) return;

      const text = msg.snippet.displayMessage;
      const username = msg.authorDetails.displayName;
      const countryCode = detectCountry(text);

      if (countryCode) {
        votes[countryCode] = (votes[countryCode] || 0) + 1;
        lastVoter[countryCode] = username;

        const commentData = {
          id: msg.id,
          username: username,
          message: text,
          countryCode: countryCode,
          countryName: countryMap[countryCode],
          timestamp: Date.now()
        };
        roundComments.push(commentData);
        io.emit("newComment", commentData);

        // 🔥 SET TARGET: Hidden - no emit to clients
        if (!currentTarget && canAcceptTarget && !isGameOver) {
          currentTarget = countryCode;
          console.log(`🎯 TARGET SET: ${countryMap[countryCode]} by ${username} (HIDDEN)`);
        }

        console.log(`💬 ${username}: ${text} → ${countryCode.toUpperCase()}`);
      }
    });

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
  
  // 🔥 REMOVED: Target display on connection

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