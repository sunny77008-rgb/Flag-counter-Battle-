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

let votes = {};
let lastVoter = {};
let processedMessages = new Set();
let nextPageToken = null;
let currentLiveChatId = null;

/* ================= COUNTRY MAP ================= */

const countryMap = {
  "afghanistan":"af","albania":"al","algeria":"dz","andorra":"ad","angola":"ao",
  "argentina":"ar","armenia":"am","australia":"au","austria":"at","azerbaijan":"az",
  "bahamas":"bs","bahrain":"bh","bangladesh":"bd","belarus":"by","belgium":"be",
  "belize":"bz","benin":"bj","bhutan":"bt","bolivia":"bo","bosnia":"ba",
  "botswana":"bw","brazil":"br","brunei":"bn","bulgaria":"bg","cambodia":"kh",
  "cameroon":"cm","canada":"ca","chile":"cl","china":"cn","colombia":"co",
  "croatia":"hr","cuba":"cu","cyprus":"cy","czech":"cz","denmark":"dk",
  "egypt":"eg","estonia":"ee","ethiopia":"et","finland":"fi","france":"fr",
  "germany":"de","ghana":"gh","greece":"gr","hungary":"hu","iceland":"is",
  "india":"in","indonesia":"id","iran":"ir","iraq":"iq","ireland":"ie",
  "israel":"il","italy":"it","jamaica":"jm","japan":"jp","jordan":"jo",
  "kazakhstan":"kz","kenya":"ke","kuwait":"kw","laos":"la","latvia":"lv",
  "lebanon":"lb","libya":"ly","malaysia":"my","maldives":"mv","mexico":"mx",
  "mongolia":"mn","morocco":"ma","myanmar":"mm","nepal":"np","netherlands":"nl",
  "new zealand":"nz","nigeria":"ng","norway":"no","oman":"om","pakistan":"pk",
  "philippines":"ph","poland":"pl","portugal":"pt","qatar":"qa","romania":"ro",
  "russia":"ru","saudi arabia":"sa","serbia":"rs","singapore":"sg",
  "south africa":"za","south korea":"kr","spain":"es","sri lanka":"lk",
  "sweden":"se","switzerland":"ch","thailand":"th","turkey":"tr",
  "uae":"ae","uk":"gb","ukraine":"ua","usa":"us","united states":"us",
  "vietnam":"vn"
};

/* ================= GET LIVE CHAT ================= */

async function getLiveChatId() {
  try {
    const res = await youtube.videos.list({
      part: "liveStreamingDetails",
      id: VIDEO_ID
    });

    if (!res.data.items.length) {
      console.log("⚠ No active live found. Retrying in 20s...");
      setTimeout(startLiveCheck, 20000);
      return null;
    }

    const chatId =
      res.data.items[0].liveStreamingDetails?.activeLiveChatId;

    if (!chatId) {
      console.log("⚠ Live exists but no active chat yet...");
      setTimeout(startLiveCheck, 20000);
      return null;
    }

    console.log("✅ Live chat connected");
    return chatId;

  } catch (err) {
    console.error("LiveChatId error:", err.message);
    setTimeout(startLiveCheck, 20000);
    return null;
  }
}

/* ================= FETCH COMMENTS ================= */

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

      if (processedMessages.has(msg.id)) return;
      processedMessages.add(msg.id);

      const text = msg.snippet.displayMessage.toLowerCase();
      const username = msg.authorDetails.displayName;

      for (let name in countryMap) {
        if (text.includes(name)) {
          const code = countryMap[name];
          votes[code] = (votes[code] || 0) + 1;
          lastVoter[code] = username;
        }
      }

    });

    io.emit("updateVotes", { votes, lastVoter });

    const interval = res.data.pollingIntervalMillis || 10000;

    setTimeout(fetchComments, interval);

  } catch (err) {

    if (err.message.includes("quota")) {
      console.error("🚨 QUOTA EXCEEDED — slowing polling");
      setTimeout(fetchComments, 60000);
      return;
    }

    console.error("Fetch error:", err.message);
    setTimeout(fetchComments, 20000);
  }
}

/* ================= START CHECK ================= */

async function startLiveCheck() {
  currentLiveChatId = await getLiveChatId();

  if (currentLiveChatId) {
    votes = {};
    lastVoter = {};
    processedMessages.clear();
    nextPageToken = null;

    fetchComments();
  }
}

/* ================= SOCKET ================= */

io.on("connection", (socket) => {
  console.log("👤 Client connected");

  socket.emit("updateVotes", { votes, lastVoter });

  socket.on("resetVotes", () => {
    votes = {};
    lastVoter = {};
    processedMessages.clear();
    nextPageToken = null;

    io.emit("updateVotes", { votes: {}, lastVoter: {} });

    console.log("🔄 Votes reset");
  });
});

/* ================= ROUTE ================= */

app.get("/", (req, res) => {
  res.send("🚀 Flag Battle Server Running 24/7");
});

/* ================= START SERVER ================= */

server.listen(3000, () => {
  console.log("🔥 Server running on port 3000");
  startLiveCheck();
});