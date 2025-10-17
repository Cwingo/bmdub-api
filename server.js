// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';

/* CONFIG */
const app = express();
app.set('trust proxy', 1); // for Render / proxies
const PORT = process.env.PORT || 3000;

const {
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_USER,
  SMTP_PASS,
  TO_EMAIL = 'cmwingo@email.sc.edu',
  FROM_EMAIL = 'bmDub Contact <no-reply@bmdub.app>',
  CORS_ORIGINS
} = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('SMTP configuration is missing. Please check your environment variables.');
  process.exit(1);
}

/* MIDDLEWARE */
const origins = (CORS_ORIGINS ||
  'https://cwingo.github.io,https://Cwingo.github.io,https://cwingo242.github.io,http://localhost:5173,http://localhost:5174')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '100kb' }));

/* RATE LIMIT */
const limiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/contact', limiter);

/* MAILER */
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

/* HELPERS */
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
}
function sanitize(s) {
  return String(s || '').toString().trim();
}

/* ROUTES */
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'bmDub API', time: new Date().toISOString() });
});
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/* SMTP DEBUG */
app.get('/debug/verify', async (_req, res) => {
  try {
    await transporter.verify();
    res.json({ ok: true, message: 'SMTP ready' });
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
    const honeypot = sanitize(req.body?.website);

    // Honeypot
    if (honeypot) return res.status(200).json({ ok: true, skip: true });

    // Validation
    if (!name || name.length < 2)
      return res.status(400).json({ error: 'Name is required and must be at least 2 characters.' });
    if (!isEmail(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (!subject || subject.length < 2)
      return res.status(400).json({ error: 'Subject is required and must be at least 2 characters.' });
    if (!message || message.length < 10)
      return res.status(400).json({ error: 'Message is required and must be at least 10 characters.' });

    const text = `
New contact form submission

Name: ${name}
Email: ${email}
Subject: ${subject}
Source: ${source || 'form'}

Message:
${message}`.trim();

    await transporter.sendMail({
      to: TO_EMAIL,
      from: FROM_EMAIL,           // Use a VERIFIED sender in Brevo
      replyTo: `${name} <${email}>`,
      subject: `[bmDub Contact] ${subject}`,
      text
    });

    res.json({ ok: true, message: 'Email sent successfully.' });
  } catch (err) {
    console.error('Mail error:', err);
    // Surface the SMTP error so you can diagnose 500s from the browser/Logs
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/* ERROR HANDLING */
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err?.message || err);
  res.status(500).json({ error: 'Internal server error.' });
});

/* START */
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
