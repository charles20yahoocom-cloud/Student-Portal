const nodemailer = require('nodemailer');

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!smtpConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    return { sent: false, reason: 'SMTP not configured' };
  }
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html
    });
    return { sent: true };
  } catch (err) {
    console.error('sendMail failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, smtpConfigured };
