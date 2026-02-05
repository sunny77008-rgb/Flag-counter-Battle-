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

const youtube = google.youtube({
  version: "v3",
  auth: API_KEY
});

let votes = {};
let lastVoter = {};
let processedMessages = new Set();

// 🌍 FULL COUNTRY MAP (major countries included)
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

async function getLiveChatId() {
  const res = await youtube.videos.list({
    part: "liveStreamingDetails",
    id: VIDEO_ID
  });

  if (!res.data.items.length) {
    console.log("No live stream found.");
    return null;
  }

  return res.data.items[0].liveStreamingDetails.activeLiveChatId;
}

async function fetchComments(liveChatId) {
  try {
    const res = await youtube.liveChatMessages.list({
      liveChatId: liveChatId,
      part: "snippet,authorDetails",
      maxResults: 200
    });

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

    io.emit("updateVotes", {
      votes: votes,
      lastVoter: lastVoter
    });

  } catch (error) {
    console.error("Error fetching comments:", error.message);
  }
}

io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("resetVotes", () => {
    votes = {};
    lastVoter = {};
    processedMessages.clear();
    io.emit("updateVotes", { votes, lastVoter });
    console.log("Votes reset");
  });
});

app.get("/", (req, res) => {
  res.send("🚀 Flag Battle Server Running");
});

server.listen(3000, async () => {
  console.log("Server running on port 3000");

  const liveChatId = await getLiveChatId();
  if (!liveChatId) return;

  setInterval(() => {
    fetchComments(liveChatId);
  }, 5000);
});