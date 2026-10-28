# AutoExpert Live

Vaš `autoexpert_analytics.html` prebačen u pravi sajt: Node.js + SQLite backend, automatski scraper,
korisnički nalozi sa obaveštenjima i praćenje cena kroz vreme. Dizajn je ostao isti.

## Pokretanje
```bash
npm install
cp .env.example .env      # postavi JWT_SECRET i ADMIN_KEY
npm start                 # http://localhost:3000
```
Podrazumevani izvor je `demo` (simulirano tržište), pa sve radi odmah: cene se pomeraju, oglasi nestaju
i vraćaju se, a obaveštenja se ispisuju u konzolu dok ne podesiš SMTP/Twilio/Viber.

## Šta je gde
| Fajl | Uloga |
|---|---|
| `server/scrapers/polovni.js` | Pravi scraper (šablon, vidi napomenu ispod) |
| `server/scrapers/demo.js` | Simulirani izvor za testiranje |
| `server/jobs.js` | Cron: scrape → upis u bazu → obaveštenja (default na 30 min) |
| `server/ingest.js` | Novi oglasi, istorija cena, istek (nestao N puta zaredom), brisanje posle 30 dana |
| `server/scoring.js` | AE Ocena, procena tržišne cene (medijana sličnih oglasa) i rizik |
| `server/alerts.js`, `notifiers.js` | Poklapanje sačuvanih pretraga i slanje (email / SMS / Viber) |
| `server/index.js` | REST API + autentifikacija (JWT, bcrypt) |
| `public/index.html`, `public/live.js` | Vaš frontend + prijava, "Obavesti me", istorija cene |

## Važne napomene
1. **Pravi scraper:** CSS selektori u `polovni.js` su pretpostavke - moraju se prilagoditi stvarnom HTML-u
   (F12 → Inspect). Pre toga proverite uslove korišćenja i `robots.txt`; mnogi oglasnici zabranjuju
   automatsko preuzimanje, a za komercijalni sajt treba dozvola ili zvanični feed/API. Ako se oglasi
   učitavaju JavaScript-om, umesto `fetch` koristite Playwright. Uključuje se sa `SOURCES=polovni` (ili `demo,polovni`).
2. **Bezbednost od lažnog "isteka":** ako scraper padne ili vrati 0 oglasa, ništa se ne proglašava isteklim.
3. **SMS:** Twilio nalog + broj pošiljaoca. **Viber:** potreban Viber Bot (Viber Business); korisnik se mora
   pretplatiti na bota, a njegov Viber ID stiže na vaš webhook (webhook nije uključen u ovu verziju).
   **Email:** bilo koji SMTP (npr. Brevo, Mailgun, Gmail app password).
4. **Produkcija:** HTTPS (nginx/Caddy), jak `JWT_SECRET`, rezervna kopija `data/autoexpert.db`, i pravila
   privatnosti jer čuvate emailove i telefone (GDPR / Zakon o zaštiti podataka o ličnosti).
5. AE Ocena je heuristika (cena vs. tržište, kilometraža, godište, rizik) - kad prikupite više podataka, podesite
   težine u `scoring.js`. Tabovi „Tržišne tendencije" i „Kalkulator uvoza" ostali su kao u originalu (statični).

## Vlastiti oglasi (korisnici i prodavci)
Prijavljeni korisnik klikne **Postavi oglas** (do 6 slika, telefon za kontakt), a u **Moji oglasi** menja cenu
(svaka promena ulazi u istoriju i okida „pad cene" obaveštenja), označava oglas kao prodat, obnavlja ga ili briše.
- Oglas odmah dobija AE Ocenu i procenu tržišne cene (poređenjem sa sličnim oglasima u bazi). Ocena je pouzdana
  tek kad ima bar 3 slična oglasa; do tada je tržišna cena = tražena cena.
- Oglas ističe posle 60 dana bez obnove (`USER_LISTING_DAYS`), a istekli/prodati se brišu posle 30 dana zajedno sa slikama.
- Limit: 10 aktivnih oglasa po nalogu, 20 objava na sat, slike JPG/PNG/WEBP do 5 MB.
- Kad pustiš sajt u rad, u `.env` stavi `SOURCES=` (prazno) da nestanu demo oglasi.
- Moderacija: `DELETE /api/admin/listings/:id` sa headerom `x-admin-key`.
- Svi tekstovi od korisnika se escape-uju na izlazu (zaštita od XSS), a slike se serviraju sa `nosniff`.
- Pre javnog lansiranja razmislite o: verifikaciji emaila, dugmetu „Prijavi oglas", ograničenju slika po IP adresi
  i uslovima korišćenja (prodavac odgovara za tačnost oglasa; vi ste samo platforma).
