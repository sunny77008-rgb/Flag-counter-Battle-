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

async function getLiveChatId() {
  const res = await youtube.videos.list({
    part: "liveStreamingDetails",
    id: VIDEO_ID
  });
  return res.data.items[0].liveStreamingDetails.activeLiveChatId;
}

async function fetchComments(liveChatId) {
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
}

server.listen(3000, async () => {
  const liveChatId = await getLiveChatId();

  setInterval(() => {
    fetchComments(liveChatId);
  }, 5000);
});