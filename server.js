import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');


const dataPath = path.resolve(
    process.env.DATA_PATH || './aikavach-data.json'
);

// Middleware
app.use(express.json({ limit: '1mb' }));

app.use(
    session({
        name: 'aikavach.sid',
        secret: process.env.SESSION_SECRET ||
            'development-only-change-this-secret-before-deploying',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 8 * 60 * 60 * 1000
        }
    })
);

// Read application data
function readData() {
    try {
        const parsed = JSON.parse(
            fs.readFileSync(dataPath, 'utf8')
        );

        return {
            users: Array.isArray(parsed.users) ? parsed.users : [],
            oauthTokens: Array.isArray(parsed.oauthTokens) ?
                parsed.oauthTokens : []
        };
    } catch (error) {
        if (
            error.code !== 'ENOENT' &&
            !(error instanceof SyntaxError)
        ) {
            throw error;
        }

        return {
            users: [],
            oauthTokens: []
        };
    }
}

// Write application data
function writeData(data) {
    const directory = path.dirname(dataPath);

    fs.mkdirSync(directory, { recursive: true });

    const temporaryPath = `${dataPath}.tmp`;

    fs.writeFileSync(
        temporaryPath,
        JSON.stringify(data, null, 2), { mode: 0o600 }
    );

    fs.renameSync(temporaryPath, dataPath);
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.userId) {
        return next();
    }

    return res.status(401).json({
        message: 'Please sign in first.'
    });
}

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

// Register
app.post('/api/auth/register', async(req, res) => {
    try {
        const email = String((req.body && req.body.email) || '')
            .trim()
            .toLowerCase();

        const password = String((req.body && req.body.password) || '');

        if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
            return res.status(400).json({
                message: 'Enter a valid email and a password of at least 10 characters.'
            });
        }

        const data = readData();

        if (data.users.some(user => user.email === email)) {
            return res.status(409).json({
                message: 'An account with this email already exists.'
            });
        }

        const user = {
            id: crypto.randomUUID(),
            email,
            password_hash: await bcrypt.hash(password, 12),
            created_at: new Date().toISOString()
        };

        data.users.push(user);
        writeData(data);

        req.session.userId = user.id;
        req.session.email = email;

        req.session.save(error => {
            if (error) {
                console.error('Registration session error:', error);

                return res.status(500).json({
                    message: 'Account created, but sign-in failed.'
                });
            }

            return res.status(201).json({
                ok: true,
                email
            });
        });
    } catch (error) {
        console.error('Registration error:', error);

        return res.status(500).json({
            message: 'Could not register your account.'
        });
    }
});


// Login
app.post('/api/auth/login', async(req, res) => {
    try {
        const email = String(req.body ?.email || '')
            .trim()
            .toLowerCase();

        const password = String(req.body ?.password || '');

        const data = readData();

        const user = data.users.find(
            item => item.email === email
        );

        if (!user ||
            !(await bcrypt.compare(password, user.password_hash))
        ) {
            return res.status(401).json({
                message: 'Invalid email or password. Create an account first if you are new.'
            });
        }

        req.session.userId = user.id;
        req.session.email = user.email;

        req.session.save(error => {
            if (error) {
                console.error('Login session error:', error);

                return res.status(500).json({
                    message: 'Could not save your login session.'
                });
            }

            return res.json({
                ok: true,
                email: user.email
            });
        });
    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            message: 'Could not log in.'
        });
    }
});

// Check current login
app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            authenticated: false
        });
    }

    return res.json({
        authenticated: true,
        email: req.session.email
    });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(error => {
        if (error) {
            console.error('Logout error:', error);

            return res.status(500).json({
                message: 'Could not log out.'
            });
        }

        res.clearCookie('aikavach.sid', {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
        });

        return res.json({ ok: true });
    });
});

// OAuth provider configuration
function providerConfig(provider) {
    if (provider === 'google') {
        return {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            redirectUri: process.env.GOOGLE_REDIRECT_URI,
            authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            scope: 'openid email https://www.googleapis.com/auth/gmail.readonly'
        };
    }

    if (provider === 'microsoft') {
        return {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            redirectUri: process.env.MICROSOFT_REDIRECT_URI,
            authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
            tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            scope: 'openid email offline_access https://graph.microsoft.com/Mail.Read'
        };
    }

    return null;
}

// Start OAuth connection
app.get('/api/oauth/:provider/start', requireAuth, (req, res) => {
    const provider = req.params.provider;
    const config = providerConfig(provider);

    if (!config) {
        return res.status(404).send('Unknown OAuth provider.');
    }

    if (!config.clientId || !config.redirectUri) {
        return res.status(503).send(
            `${provider} OAuth is not configured. Check your .env file.`
        );
    }

    const state = crypto.randomBytes(32).toString('hex');

    req.session.oauthState = state;
    req.session.oauthProvider = provider;

    const authorizationUrl = new URL(config.authUrl);

    authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: config.scope,
        state,
        ...(provider === 'google' ? {
            access_type: 'offline',
            prompt: 'consent'
        } : {})
    }).toString();

    // Save the session before redirecting to the provider.
    req.session.save(error => {
        if (error) {
            console.error('OAuth session save error:', error);

            return res.status(500).send(
                'Could not save the OAuth session. Please try again.'
            );
        }

        return res.redirect(authorizationUrl.toString());
    });
});

// OAuth callback
app.get(
    '/api/oauth/:provider/callback',
    requireAuth,
    async(req, res) => {
        const provider = req.params.provider;
        const config = providerConfig(provider);

        if (!config) {
            return res.status(404).send('Unknown OAuth provider.');
        }

        const returnedState =
            typeof req.query.state === 'string' ?
            req.query.state :
            '';

        if (!returnedState ||
            returnedState !== req.session.oauthState ||
            req.session.oauthProvider !== provider
        ) {
            console.error('OAuth state validation failed.', {
                provider,
                sessionExists: Boolean(req.session),
                sessionHasState: Boolean(req.session.oauthState),
                sessionProvider: req.session.oauthProvider
            });

            return res.status(400).send(
                'OAuth state validation failed. Please try connecting again.'
            );
        }

        if (req.query.error) {
            return res.status(400).send(
                `OAuth authorization failed: ${String(req.query.error)}`
            );
        }

        const code =
            typeof req.query.code === 'string' ?
            req.query.code :
            '';

        if (!config.clientSecret || !code) {
            return res.status(400).send(
                'OAuth credentials or authorization code missing.'
            );
        }

        try {
            const tokenResponse = await fetch(config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    code,
                    redirect_uri: config.redirectUri,
                    grant_type: 'authorization_code'
                })
            });

            const tokens = await tokenResponse.json();

            if (!tokenResponse.ok || !tokens.access_token) {
                console.error(
                    'OAuth token exchange failed:',
                    tokens.error || tokenResponse.status
                );

                return res.status(502).send(
                    'Provider token exchange failed. Check your OAuth configuration.'
                );
            }

            const data = readData();

            const existing = data.oauthTokens.find(
                token =>
                token.user_id === req.session.userId &&
                token.provider === provider
            );

            const row = {
                user_id: req.session.userId,
                provider,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token ||
                    existing ?.refresh_token ||
                    null,
                expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
                scope: tokens.scope || config.scope
            };

            data.oauthTokens = data.oauthTokens.filter(
                token =>
                !(
                    token.user_id === row.user_id &&
                    token.provider === provider
                )
            );

            data.oauthTokens.push(row);

            writeData(data);

            delete req.session.oauthState;
            delete req.session.oauthProvider;

            req.session.save(error => {
                if (error) {
                    console.error(
                        'OAuth completion session error:',
                        error
                    );

                    return res.status(500).send(
                        'Connected account, but could not finish the session update.'
                    );
                }

                return res.redirect(`${frontendUrl}/?mailbox=connected`);
            });
        } catch (error) {
            console.error(
                'OAuth callback error:',
                error.message
            );

            return res.status(502).send(
                'Could not complete provider authorization.'
            );
        }
    }
);

// Connected mailbox status
app.get('/api/mailbox/status', requireAuth, (req, res) => {
    const connected = readData().oauthTokens
        .filter(token => token.user_id === req.session.userId)
        .map(({ provider, scope }) => ({
            provider,
            scope
        }));

    res.json({ connected });
});

// Disconnect a mailbox
app.post(
    '/api/mailbox/disconnect/:provider',
    requireAuth,
    (req, res) => {
        const data = readData();

        data.oauthTokens = data.oauthTokens.filter(
            token =>
            !(
                token.user_id === req.session.userId &&
                token.provider === req.params.provider
            )
        );

        writeData(data);

        res.json({ ok: true });
    }
);

// Retrieve recent Gmail messages for the signed-in user.
app.get('/api/mailbox/messages', requireAuth, async(req, res) => {
    try {
        const userId = req.session.userId;
        const data = readData();

        const savedToken = (data.oauthTokens || []).find(
            token =>
            token.user_id === userId &&
            token.provider === 'google'
        );

        if (!savedToken) {
            return res.status(401).json({
                message: 'Google is not connected. Please connect Gmail first.'
            });
        }

        if (!process.env.GOOGLE_CLIENT_ID ||
            !process.env.GOOGLE_CLIENT_SECRET ||
            !process.env.GOOGLE_REDIRECT_URI) {
            return res.status(503).json({
                message: 'Google OAuth configuration is incomplete.'
            });
        }

        // Create the Google OAuth client.
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        oauth2Client.setCredentials({
            access_token: savedToken.access_token,
            refresh_token: savedToken.refresh_token || undefined,
            expiry_date: savedToken.expires_at
        });

        // Google refreshes expired access tokens automatically; save the new
        // token so the next request does not have to refresh again.
        oauth2Client.on('tokens', freshTokens => {
            try {
                const latest = readData();
                const row = latest.oauthTokens.find(
                    token =>
                    token.user_id === userId &&
                    token.provider === 'google'
                );

                if (!row) return;

                if (freshTokens.access_token) row.access_token = freshTokens.access_token;
                if (freshTokens.expiry_date) row.expires_at = freshTokens.expiry_date;
                if (freshTokens.refresh_token) row.refresh_token = freshTokens.refresh_token;

                writeData(latest);
            } catch (persistError) {
                console.error('Could not save refreshed Google token:', persistError.message);
            }
        });

        // Gmail API client.
        const gmail = google.gmail({
            version: 'v1',
            auth: oauth2Client
        });

        // Limit the number of messages returned.
        const requestedLimit = Number.parseInt(req.query.limit, 10) || 10;
        const maxResults = Math.min(Math.max(requestedLimit, 1), 25);

        const pageToken = req.query.pageToken || undefined;

        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            maxResults,
            pageToken,
            q: 'in:anywhere -in:trash'
        });

        const messageRefs = listResponse.data.messages || [];

        // Retrieve each message's headers and content.
        const messages = await Promise.all(
            messageRefs.map(async reference => {
                const response = await gmail.users.messages.get({
                    userId: 'me',
                    id: reference.id,
                    format: 'full'
                });

                const message = response.data;
                const headers = message.payload ?.headers || [];
                const getHeader = (name) =>
                    headers.find(
                        (header) =>
                        header.name ?.toLowerCase() === name.toLowerCase()
                    ) ?.value || '';

                // Decode Gmail's base64url-encoded message body.
                const decodeBody = part => {
                    if (!part) return '';

                    if (part.body ?.data) {
                        return Buffer.from(
                            part.body.data,
                            'base64url'
                        ).toString('utf8');
                    }

                    for (const child of part.parts || []) {
                        const result = decodeBody(child);
                        if (result) return result;
                    }

                    return '';
                };

                const findPlainText = part => {
                    if (!part) return '';

                    if (
                        part.mimeType === 'text/plain' &&
                        part.body ?.data
                    ) {
                        return decodeBody(part);
                    }

                    for (const child of part.parts || []) {
                        const result = findPlainText(child);
                        if (result) return result;
                    }

                    return '';
                };

                const body =
                    findPlainText(message.payload) ||
                    decodeBody(message.payload) ||
                    message.snippet ||
                    '';

                return {
                    id: message.id,
                    threadId: message.threadId,
                    from: getHeader('From'),
                    to: getHeader('To'),
                    subject: getHeader('Subject') || '(No subject)',
                    date: getHeader('Date'),
                    snippet: message.snippet || '',
                    body: body.slice(0, 20000)
                };
            })
        );

        return res.json({
            ok: true,
            count: messages.length,
            messages,
            nextPageToken: listResponse.data.nextPageToken || null
        });

    } catch (error) {
        console.error(
            'Gmail retrieval failed:',
            error.response ?.data ?.error || error.message
        );

        if (error.response ?.status === 401 ||
            error.response ?.status === 403) {
            return res.status(error.response ?.status).json({
                message: 'Gmail access was denied. Check the Gmail permission and reconnect Google if necessary.'
            });
        }

        return res.status(502).json({
            message: 'Could not retrieve Gmail messages. Check the backend terminal for details.'
        });
    }
});
// Start server
app.listen(port, () => {
    console.log(`AiKavach API listening on http://localhost:${port}`);
});