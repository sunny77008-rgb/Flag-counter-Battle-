const express = require("express");
const { google } = require("googleapis");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*" }
});

const API_KEY = process.env.YT_API_KEY;
const VIDEO_ID = process.env.VIDEO_ID;

if (!API_KEY || !VIDEO_ID) {
  console.error("❌ YT_API_KEY or VIDEO_ID missing in Render ENV");
  process.exit(1);
}

const youtube = google.youtube({
  version: "v3",
  auth: API_KEY
});

// 🔥 ROUND-BASED SYSTEM
let votes = {};
let lastVoter = {};
let processedMessages = new Set();
let nextPageToken = null;
let currentLiveChatId = null;
let isRoundActive = false;  // NEW: Track if round is running
let roundComments = [];     // NEW: Store comments for current round only

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

// Reverse map for detection
const nameToCode = {};
for (let code in countryMap) {
  nameToCode[countryMap[code]] = code;
}

async function getLiveChatId() {
  try {
    const res = await youtube.videos.list({
      part: "liveStreamingDetails",
      id: VIDEO_ID
    });

    if (!res.data.items.length) {
      console.log("⚠ No active live found. Retrying...");
      setTimeout(startLiveCheck, 20000);
      return null;
    }

    const chatId = res.data.items[0].liveStreamingDetails?.activeLiveChatId;
    if (!chatId) {
      setTimeout(startLiveCheck, 20000);
      return null;
    }
    console.log("✅ Live chat connected");
    return chatId;
  } catch (err) {
    console.error("❌ Error getting live chat:", err.message);
    setTimeout(startLiveCheck, 20000);
    return null;
  }
}

function detectCountry(text) {
  const lowerText = text.toLowerCase().trim();

  // Direct code match (2 letters)
  if (lowerText.length === 2 && countryMap[lowerText]) {
    return lowerText;
  }

  // Name match
  for (let name in nameToCode) {
    if (lowerText.includes(name)) {
      return nameToCode[name];
    }
  }

  // Common variations
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

  try {
    const res = await youtube.liveChatMessages.list({
      liveChatId: currentLiveChatId,
      part: "snippet,authorDetails",
      pageToken: nextPageToken,
      maxResults: 200
    });

    nextPageToken = res.data.nextPageToken;

    res.data.items.forEach(msg => {
      // Skip if already processed
      if (processedMessages.has(msg.id)) return;
      processedMessages.add(msg.id);

      // Skip if round not active
      if (!isRoundActive) return;

      const text = msg.snippet.displayMessage;
      const username = msg.authorDetails.displayName;
      const countryCode = detectCountry(text);

      if (countryCode) {
        // Update votes
        votes[countryCode] = (votes[countryCode] || 0) + 1;
        lastVoter[countryCode] = username;

        // 🔥 NEW: Store in round comments
        const commentData = {
          id: msg.id,
          username: username,
          message: text,
          countryCode: countryCode,
          countryName: countryMap[countryCode],
          timestamp: Date.now()
        };
        roundComments.push(commentData);

        // 🔥 NEW: Emit individual comment event
        io.emit("newComment", commentData);

        console.log(`💬 ${username}: ${text} → ${countryCode.toUpperCase()}`);
      }
    });

    io.emit("updateVotes", { votes, lastVoter });
    const interval = res.data.pollingIntervalMillis || 5000;
    setTimeout(fetchComments, interval);

  } catch (err) {
    console.error("❌ Error fetching comments:", err.message);
    setTimeout(fetchComments, 10000);
  }
}

async function startLiveCheck() {
  currentLiveChatId = await getLiveChatId();
  if (currentLiveChatId) fetchComments();
}

io.on("connection", (socket) => {
  console.log("👤 Client connected");
  socket.emit("updateVotes", { votes, lastVoter });

  // 🔥 NEW: Round start - Accept comments
  socket.on("startRound", () => {
    isRoundActive = true;
    console.log("🟢 Round STARTED - Accepting comments");
  });

  // 🔥 NEW: Round end - Reset everything
  socket.on("endRound", () => {
    isRoundActive = false;
    votes = {};
    lastVoter = {};
    roundComments = [];  // Clear round comments
    // Keep processedMessages to avoid duplicates

    io.emit("updateVotes", { votes: {}, lastVoter: {} });
    io.emit("roundReset");  // Notify clients
    console.log("🔴 Round ENDED - Comments reset for next round");
  });

  // Legacy reset (for compatibility)
  socket.on("resetVotes", () => {
    votes = {};
    lastVoter = {};
    roundComments = [];
    io.emit("updateVotes", { votes: {}, lastVoter: {} });
    console.log("🔄 Manual Reset Done");
  });

  // Send current round comments to new client
  socket.emit("roundComments", roundComments);
});

app.get("/", (req, res) => res.send("🚀 Flag Battle Server Running"));
app.get("/health", (req, res) => res.json({ 
  status: "OK", 
  roundActive: isRoundActive,
  commentsCount: roundComments.length 
}));

server.listen(3000, () => {
  console.log("🔥 Server running on port 3000");
  console.log("📺 Video ID:", VIDEO_ID);
  startLiveCheck();
});