// api/github-auth.js
// This file handles the server-side logic for GitHub OAuth.
// It exchanges the authorization code received from GitHub for an access token,
// then redirects the user back to the frontend with the token.

import axios from 'axios'; // Import axios for making HTTP requests

// The default export function serves as the entry point for the Vercel Serverless Function.
export default async function handler(req, res) {
  // Extract the 'code' from the query parameters. This code is provided by GitHub
  // after the user authorizes your application.
  const { code } = req.query;

  // Retrieve GitHub Client ID and Client Secret from environment variables.
  // These should be configured in your Vercel project settings.
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

  // --- Start: Enhanced Environment Variable Check ---
  // If environment variables are not defined, return a 500 error immediately.
  // This helps diagnose if the function is crashing due to missing configuration.
  if (!GITHUB_CLIENT_ID) {
    console.error("Serverless Function Error: GITHUB_CLIENT_ID is not defined in Vercel environment variables.");
    return res.status(500).send("Server Configuration Error: GITHUB_CLIENT_ID is missing.");
  }
  if (!GITHUB_CLIENT_SECRET) {
    console.error("Serverless Function Error: GITHUB_CLIENT_SECRET is not defined in Vercel environment variables.");
    return res.status(500).send("Server Configuration Error: GITHUB_CLIENT_SECRET is missing.");
  }
  // --- End: Enhanced Environment Variable Check ---

  // If no code is provided, redirect back to the frontend with an error message.
  // This scenario typically happens if the user cancels the OAuth flow or there's a misdirection.
  if (!code) {
    console.warn("OAuth Callback: No 'code' parameter provided in the redirect from GitHub.");
    return res.redirect(`/?oauth_error=no_code_provided`);
  }

  try {
    console.log("Serverless Function: Attempting to exchange GitHub code for access token...");
    // Log the presence of Client ID (without revealing the actual value for security)
    console.log(`Serverless Function: GITHUB_CLIENT_ID is ${GITHUB_CLIENT_ID ? 'present' : 'missing'}.`);

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

    // If no access token is received, redirect with an error.
    if (!access_token) {
      console.error("Serverless Function: Failed to retrieve access token from GitHub. Response data:", tokenRes.data);
      return res.redirect(`/?oauth_error=no_access_token_received`);
    }

    console.log("Serverless Function: Access token received. Fetching user info...");
    // Step 2: Fetch user information using the access token.
    // This verifies the token and gets the authenticated user's details.
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `token ${access_token}` } // Use the access token for authorization
    });

    const user = userRes.data;
    console.log(`Serverless Function: User info fetched for: ${user.login}`);

    // Step 3: Redirect back to the frontend (your main application page)
    // Pass the access token and relevant user info as query parameters.
    // The frontend will then pick these up and store them in localStorage.
    const frontendRedirectUrl = `/?access_token=${access_token}&user_login=${user.login}&user_avatar=${encodeURIComponent(user.avatar_url)}`;
    console.log(`Serverless Function: Redirecting to frontend: ${frontendRedirectUrl}`);
    return res.redirect(frontendRedirectUrl);

  } catch (e) {
    // Log the error for debugging purposes on the server.
    console.error('Serverless Function: GitHub OAuth process failed within try/catch block.');

    // Provide more specific error details based on the type of error.
    if (e.response) {
      // This means Axios received an error response from the GitHub API (e.g., 400, 401, 403).
      console.error('GitHub API response error Status:', e.response.status, 'Data:', e.response.data);
      return res.redirect(`/?oauth_error=github_api_error&status=${e.response.status}&details=${encodeURIComponent(e.response.data.error || e.response.data.message || 'Unknown GitHub API error')}`);
    } else if (e.request) {
      // This means the request was made but no response was received (e.g., network timeout).
      console.error('Network error during GitHub API call:', e.message);
      return res.redirect(`/?oauth_error=network_error&details=${encodeURIComponent(e.message)}`);
    } else {
      // Other unexpected errors (e.g., syntax error, variable not defined).
      console.error('Unexpected error during OAuth process:', e.message);
      return res.status(500).send(`Internal Server Error during OAuth: ${e.message}`);
    }
  }
}
