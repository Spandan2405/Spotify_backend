// BACKEND FLOW: /auth/login -> /auth/callback (access, refresh tokens) -> extractAccessToken -> sending it to the frontend using query params (url)
// Access token gets expired

const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
require("dotenv").config();
const serverless = require("serverless-http");
const cors = require("cors");

const app = express();
const port = 8000;
app.use(cors({ origin: "http://localhost:5173" })); // CORS - Cross-Origin Resource Sharing to allow requests

// Spotify API credentials
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

//console.log("Client ID:", clientId);
//console.log("Client Secret:", clientSecret ? "Loaded" : "Missing");
//console.log("Redirect URI used:", redirectUri);
//console.log("Frontend URL:", frontendUrl);

// Login endpoint to initiate Spotify authorization
app.get("/auth/login", (req, res) => {
  //console.log("/auth/login ->");
  try {
    const scopes =
      "user-read-private user-follow-read user-read-email playlist-read-private user-library-read user-read-recently-played user-top-read";
    const authQuery = querystring.stringify({
      response_type: "code",
      client_id: clientId,
      scope: scopes,
      redirect_uri: redirectUri,
      show_dialog: true, // Force Spotify to show the authorization dialog
    });
    res.redirect(`https://accounts.spotify.com/authorize?${authQuery}`);
  } catch (error) {
    console.error("Error in /auth/login:", error.message);
    res.status(500).send("Authentication failed");
  }
});

// Callback endpoint to handle Spotify authorization code
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code || null;
  //console.log(
  //   "/auth/callback?code -> Received code:",
  //   code?.slice(0, 20),
  //   "..."
  // );
  if (!code) {
    res.redirect(`${frontendUrl}`);
    return null;
  }

  try {
    const payload = querystring.stringify({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
    });
    const response = await axios({
      method: "post",
      url: "https://accounts.spotify.com/api/token",
      data: payload,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
    });

    if (response.status === 200) {
      const { access_token, refresh_token, expires_in } = response.data;
      //console.log(
      //   "/auth/callback -> Access token received:",
      //   access_token?.slice(0, 20),
      //   "..."
      // );
      //console.log(
      //   "/auth/callback -> Refresh token received:",
      //   refresh_token?.slice(0, 20),
      //   "..."
      // );

      const queryParams = querystring.stringify({
        access_token,
        refresh_token,
        expires_in,
      });
      res.redirect(`${frontendUrl}?${queryParams}`);
    } else {
      res.redirect(`/?${querystring.stringify({ error: "invalid token" })}`);
    }
  } catch (error) {
    console.error("Error in /auth/callback:", error.message);
    res.status(500).send("Authentication failed");
  }
});

// Refresh token endpoint
app.get("/auth/refresh_token", async (req, res) => {
  //console.log("/auth/refresh_token ->");
  const { refresh_token } = req.query;

  if (!refresh_token) {
    return res.status(400).send("Missing refresh_token");
  }

  try {
    const payload = querystring.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    });
    const response = await axios({
      method: "post",
      url: "https://accounts.spotify.com/api/token",
      data: payload,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
    });

    //console.log(
    //   "/auth/refresh_token -> New access token:",
    //   response.data.access_token
    // );
    res.json({
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
    });
  } catch (error) {
    console.error("Error refreshing token:", error.message);
    res.status(500).send("Failed to refresh token");
  }
});

// Helper function to make authenticated API requests
async function makeSpotifyRequest(url, accessToken, queryParams = {}) {
  if (!accessToken) {
    throw new Error("No access token provided");
  }

  // Append query parameters to the URL
  const queryString = querystring.stringify(queryParams);
  const fullUrl = queryString ? `${url}?${queryString}` : url;

  try {
    const response = await axios.get(fullUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${fullUrl}:`, error.message);
    throw error;
  }
}

// Middleware to extract access token from headers
const extractAccessToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  //console.log(
  //   "extractAccessToken -> Authorization header:",
  //   authHeader.slice(0, 20),
  //   "..."
  // );
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Missing or invalid access token");
  }
  req.accessToken = authHeader.split(" ")[1];
  next();
};

// User profile endpoint
app.get("/user/profile", extractAccessToken, async (req, res) => {
  try {
    const data = await makeSpotifyRequest(
      "https://api.spotify.com/v1/me",
      req.accessToken
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch user profile");
  }
});

// User playlists endpoint
app.get("/user/playlists", extractAccessToken, async (req, res) => {
  try {
    const data = await makeSpotifyRequest(
      "https://api.spotify.com/v1/me/playlists",
      req.accessToken
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch playlists");
  }
});

// User top tracks endpoint
app.get("/user/top-tracks", extractAccessToken, async (req, res) => {
  try {
    const { time_range } = req.query;
    const validTimeRanges = ["short_term", "medium_term", "long_term"];
    const timeRange = validTimeRanges.includes(time_range)
      ? time_range
      : "medium_term"; // Default to medium_term

    const data = await makeSpotifyRequest(
      "https://api.spotify.com/v1/me/top/tracks",
      req.accessToken,
      { time_range: timeRange }
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch top tracks");
  }
});

// User recently played tracks endpoint
app.get("/user/recently-played", extractAccessToken, async (req, res) => {
  try {
    const data = await makeSpotifyRequest(
      "https://api.spotify.com/v1/me/player/recently-played",
      req.accessToken
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch recently played tracks");
  }
});

// User top artists endpoint
app.get("/user/top-artists", extractAccessToken, async (req, res) => {
  try {
    const { time_range } = req.query;
    const validTimeRanges = ["short_term", "medium_term", "long_term"];
    const timeRange = validTimeRanges.includes(time_range)
      ? time_range
      : "medium_term"; // Default to medium_term

    const data = await makeSpotifyRequest(
      "https://api.spotify.com/v1/me/top/artists",
      req.accessToken,
      { time_range: timeRange }
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch top artists");
  }
});

// User following artists endpoint
app.get("/user/following", extractAccessToken, async (req, res) => {
  try {
    const data = await makeSpotifyRequest(
      "https://api.spotify.com/v1/me/following?type=artist",
      req.accessToken
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch following artists");
  }
});

// Artist detail endpoint
app.get("/artist/:id", extractAccessToken, async (req, res) => {
  const { id } = req.params;
  try {
    const data = await makeSpotifyRequest(
      `https://api.spotify.com/v1/artists/${id}`,
      req.accessToken
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch artist details");
  }
});

// Artist top tracks endpoint
app.get("/artist/:id/top-tracks", extractAccessToken, async (req, res) => {
  const { id } = req.params;
  try {
    const data = await makeSpotifyRequest(
      `https://api.spotify.com/v1/artists/${id}/top-tracks`,
      req.accessToken,
      { market: "US" } // Market is required for top tracks
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch artist top tracks");
  }
});

// Track detail endpoint
app.get("/track/:id", extractAccessToken, async (req, res) => {
  const { id } = req.params;
  try {
    const data = await makeSpotifyRequest(
      `https://api.spotify.com/v1/tracks/${id}`,
      req.accessToken
    );
    res.json(data);
  } catch (error) {
    res.status(500).send("Failed to fetch track details");
  }
});

// Logout endpoint
app.get("/auth/logout", (req, res) => {
  res.redirect(frontendUrl);
});

app.get("/", (req, res) => {
  res.send(
    "Welcome to the Spotify Backend API. Use /auth/login to start the authentication process."
  );
});

module.exports.handler = serverless(app);
