// api/github-auth.js
// This file handles the server-side logic for GitHub OAuth.
// It exchanges the authorization code received from GitHub for an access token.

import axios from 'axios'; // Import axios for making HTTP requests

// The default export function serves as the entry point for the Vercel Serverless Function.
export default async function handler(req, res) {
  // Extract the 'code' from the query parameters. This code is provided by GitHub
  // after the user authorizes your application.
  const { code } = req.query;

  // If no code is provided, return a 400 Bad Request error.
  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter from GitHub OAuth callback.' });
  }

  // Retrieve GitHub Client ID and Client Secret from environment variables.
  // These should be configured in your Vercel project settings.
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

  // Basic validation for environment variables
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.error("Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET in environment variables.");
    return res.status(500).json({ error: 'Server configuration error: GitHub credentials missing.' });
  }

  try {
    // Step 1: Exchange the authorization code for an access token.
    // This is a POST request to GitHub's access token endpoint.
    const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,       // Your GitHub OAuth App's Client ID
      client_secret: GITHUB_CLIENT_SECRET, // Your GitHub OAuth App's Client Secret
      code: code                          // The authorization code received from GitHub
    }, {
      // Important: Tell GitHub you want a JSON response.
      headers: { Accept: 'application/json' }
    });

    // Extract the access token from the response.
    const access_token = tokenRes.data.access_token;

    // If no access token is received, throw an error.
    if (!access_token) {
      console.error("Failed to retrieve access token from GitHub:", tokenRes.data);
      throw new Error('No access token received from GitHub.');
    }

    // Step 2: (Optional but recommended) Fetch user information using the access token.
    // This verifies the token and gets the authenticated user's details.
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${access_token}` } // Use the access token for authorization
    });

    // Return the access token and user data to the frontend.
    // The frontend will then store this token locally.
    return res.status(200).json({
      access_token: access_token, // The GitHub PAT
      user: userRes.data          // The authenticated GitHub user's public profile data
    });

  } catch (e) {
    // Log the error for debugging purposes on the server.
    console.error('GitHub OAuth process failed:', e.message);
    // Return a 500 Internal Server Error with a user-friendly message and details.
    return res.status(500).json({ error: 'GitHub OAuth process failed', details: e.message });
  }
}
