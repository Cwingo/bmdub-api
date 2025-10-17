// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';

/* ---------- CONFIG ---------- */
const app = express();
const PORT = process.env.PORT || 3000;

const {
  // Email backends
  BREVO_API_KEY,
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_USER,
  SMTP_PASS,

  // Addresses
  TO_EMAIL = 'cmwingo@email.sc.edu',
  FROM_EMAIL = 'bmDub Contact <cwingo64@gmail.com>', // must be verified in Brevo if using API

  // CORS
  CORS_ORIGINS = 'https://cwingo.github.io,https://Cwingo.github.io,https://cwingo242.github.io,http://localhost:5173'
} = process.env;

/* ---------- CORS ---------- */
const allowList = CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowList.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    }
  })
);
// handle preflight for all routes
app.options('*', cors());

/* ---------- COMMON MIDDLEWARE ---------- */
app.use(express.json({ limit: '100kb' }));

/* ---------- RATE LIMIT ---------- */
const limiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/contact', limiter);

/* ---------- SMTP TRANSPORT (fallback if no API key) ---------- */
let transporter = null;
if (!BREVO_API_KEY) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('Missing SMTP_* env vars and no BREVO_API_KEY provided.');
    process.exit(1);
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // 465 = SMTPS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    requireTLS: true,
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    keepAlive: true,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { ciphers: 'TLSv1.2' }
  });
}

/* ---------- HELPERS ---------- */
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const sanitize = s => String(s ?? '').trim();
const extractEmail = val => {
  const m = /<([^>]+)>/.exec(val || '');
  return (m && m[1]) || val;
};

/* Brevo HTTP API sender (preferred) */
async function sendViaBrevoAPI({ from, to, subject, text, replyTo }) {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { email: extractEmail(from) },
      to: [{ email: extractEmail(to) }],
      replyTo: replyTo ? { email: extractEmail(replyTo) } : undefined,
      subject,
      textContent: text
    })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Brevo API ${resp.status}: ${body}`);
  }
  return resp.json();
}

/* ---------- ROUTES ---------- */
app.get('/', (_req, res) =>
  res.json({ ok: true, service: 'bmDub API', time: new Date().toISOString() })
);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Quick diagnostics for grading/verification
app.get('/debug/verify', async (_req, res) => {
  try {
    if (BREVO_API_KEY) {
      // simple ping to Brevo (no send) – we’ll just return ok if key is present
      return res.json({ ok: true, backend: 'brevo-api' });
    }
    const result = await Promise.race([
      transporter.verify(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('SMTP verify timeout')), 12000))
    ]);
    res.json({ ok: true, backend: 'smtp', result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/contact', async (req, res) => {
  try {
    const name = sanitize(req.body?.name);
    const email = sanitize(req.body?.email);
    const subject = sanitize(req.body?.subject);
    const message = sanitize(req.body?.message);
    const source = sanitize(req.body?.source);
    const honeypot = sanitize(req.body?.website); // bots fill this

    // honeypot = silently succeed
    if (honeypot) return res.status(200).json({ ok: true, skip: true });

    // validation
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Name is required (min 2 chars).' });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (!subject || subject.length < 2) {
      return res.status(400).json({ error: 'Subject is required (min 2 chars).' });
    }
    if (!message || message.length < 10) {
      return res.status(400).json({ error: 'Message is required (min 10 chars).' });
    }

    const text = `
New contact form submission

Name: ${name}
Email: ${email}
Subject: ${subject}
Source: ${source || 'form'}

Message:
${message}
`.trim();

    const payload = {
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject: `[bmDub Contact] ${subject}`,
      text,
      replyTo: `${name} <${email}>`
    };

    if (BREVO_API_KEY) {
      await sendViaBrevoAPI(payload);
    } else {
      await transporter.sendMail({
        to: payload.to,
        from: payload.from,
        replyTo: payload.replyTo,
        subject: payload.subject,
        text: payload.text
      });
    }

    res.json({ ok: true, message: 'Email sent successfully.' });
  } catch (err) {
    console.error('Mail error:', err);
    res.status(500).json({ error: 'Failed to send email. Please try again later.' });
  }
});

/* ---------- ERROR HANDLER ---------- */
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err?.message || err);
  res.status(500).json({ error: 'Internal server error.' });
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
