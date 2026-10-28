// Kanali obaveštenja. Ako kanal nije podešen u .env, poruka se ispisuje u konzolu (dev režim).
const nodemailer = require('nodemailer');
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;

async function sendEmail(user, subject, text, html) {
  if (!mailer) return console.log(`[EMAIL → ${user.email}] ${subject}\n${text}\n`);
  await mailer.sendMail({ from: process.env.MAIL_FROM, to: user.email, subject, text, html });
}
async function sendSms(user, text) {
  if (!user.phone) return;
  if (!process.env.TWILIO_SID) return console.log(`[SMS → ${user.phone}] ${text}`);
  const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: user.phone, From: process.env.TWILIO_FROM, Body: text.slice(0, 300) }),
  });
  if (!r.ok) throw new Error('Twilio: ' + (await r.text()));
}
async function sendViber(user, text) {
  if (!user.viber_id) return;
  if (!process.env.VIBER_TOKEN) return console.log(`[VIBER → ${user.viber_id}] ${text}`);
  const r = await fetch('https://chatapi.viber.com/pa/send_message', {
    method: 'POST', headers: { 'X-Viber-Auth-Token': process.env.VIBER_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver: user.viber_id, type: 'text', sender: { name: 'AutoExpert' }, text }),
  });
  const j = await r.json(); if (j.status !== 0) throw new Error('Viber: ' + j.status_message);
}

const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function notify(user, channels, car, kind) {
  const eur = n => n.toLocaleString('sr-RS') + ' €';
  const head = kind.startsWith('drop') ? '📉 Pad cene' : '🔥 Novi oglas';
  const text = `${head}: ${car.brand} ${car.model} (${car.year}) - ${eur(car.price)}, ${car.mileage.toLocaleString('sr-RS')} km, ${car.location}. AE Ocena ${car.score}/10. ${car.link}`;
  const html = `<h3>${head}: ${h(car.brand)} ${h(car.model)}</h3><p>${car.year}. · ${car.mileage.toLocaleString('sr-RS')} km · ${h(car.location)}<br><b>${eur(car.price)}</b> (tržišna ~${eur(car.market_price)})<br>AE Ocena: <b>${car.score}/10</b></p><p><a href="${h(car.link)}">Pogledaj oglas</a></p>`;
  const jobs = [];
  if (channels.includes('email')) jobs.push(sendEmail(user, `${head}: ${car.brand} ${car.model} - AE ${car.score}`, text, html));
  if (channels.includes('sms')) jobs.push(sendSms(user, text));
  if (channels.includes('viber')) jobs.push(sendViber(user, text));
  const res = await Promise.allSettled(jobs);
  res.filter(r => r.status === 'rejected').forEach(r => console.error('Notifikacija nije poslata:', r.reason.message));
  return res.some(r => r.status === 'fulfilled');
}
module.exports = { notify };
