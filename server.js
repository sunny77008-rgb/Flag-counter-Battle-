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
  console.error("Missing YT_API_KEY or VIDEO_ID");
  process.exit(1);
}

const youtube = google.youtube({
  version: "v3",
  auth: API_KEY
});

let votes = {};
let lastVoter = {};
let processedMessages = new Set(); // duplicate comments avoid karne ke liye

async function getLiveChatId() {
  try {
    const res = await youtube.videos.list({
      part: "liveStreamingDetails",
      id: VIDEO_ID
    });

    if (!res.data.items.length) return null;

    const details = res.data.items[0].liveStreamingDetails;
    if (!details || !details.activeLiveChatId) return null;

    return details.activeLiveChatId;

  } catch (error) {
    console.error("Error getting liveChatId:", error.message);
    return null;
  }
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

      if (text.includes("india")) {
        votes.india = (votes.india || 0) + 1;
        lastVoter.india = username;
      }

      if (text.includes("usa")) {
        votes.usa = (votes.usa || 0) + 1;
        lastVoter.usa = username;
      }

      if (text.includes("brazil")) {
        votes.brazil = (votes.brazil || 0) + 1;
        lastVoter.brazil = username;
      }
    });

    io.emit("updateVotes", { votes, lastVoter });

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
  res.send("Flag Battle Server Running 🚀");
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log("Server running on port " + PORT);

  const liveChatId = await getLiveChatId();

  if (!liveChatId) {
    console.log("Live stream not active");
    return;
  }

  setInterval(() => {
    fetchComments(liveChatId);
  }, 5000);
});