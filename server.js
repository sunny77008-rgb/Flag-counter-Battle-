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
  console.error("Missing YT_API_KEY or VIDEO_ID in environment variables");
  process.exit(1);
}

const youtube = google.youtube({
  version: "v3",
  auth: API_KEY
});

let votes = {};

async function getLiveChatId() {
  try {
    const res = await youtube.videos.list({
      part: "liveStreamingDetails",
      id: VIDEO_ID
    });

    if (!res.data.items.length) {
      console.log("Invalid VIDEO_ID");
      return null;
    }

    const details = res.data.items[0].liveStreamingDetails;

    if (!details || !details.activeLiveChatId) {
      console.log("Live stream not active");
      return null;
    }

    return details.activeLiveChatId;

  } catch (error) {
    console.error("Error fetching liveChatId:", error.message);
    return null;
  }
}

async function fetchComments(liveChatId) {
  try {
    const res = await youtube.liveChatMessages.list({
      liveChatId: liveChatId,
      part: "snippet",
      maxResults: 200
    });

    res.data.items.forEach(msg => {
      const text = msg.snippet.displayMessage.toLowerCase();

      if (text.includes("india")) votes.india = (votes.india || 0) + 1;
      if (text.includes("usa")) votes.usa = (votes.usa || 0) + 1;
      if (text.includes("brazil")) votes.brazil = (votes.brazil || 0) + 1;
    });

    io.emit("updateVotes", votes);

  } catch (error) {
    console.error("Error fetching comments:", error.message);
  }
}

app.get("/", (req, res) => {
  res.send("Flag Battle Server Running 🚀");
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log("Server running on port " + PORT);

  const liveChatId = await getLiveChatId();

  if (!liveChatId) {
    console.log("Waiting for live stream...");
    return;
  }

  setInterval(() => {
    fetchComments(liveChatId);
  }, 5000);
});