import { getToken, issuePass } from "./task2/automat.js";

const secret = process.env.AUTOMAT_SECRET;
if (!secret) throw new Error("Postavi AUTOMAT_SECRET");

const token = await getToken(
	"https://luka-web.eu.auth0.com",
	"https://passes-api",
	"BQJgQs3bgdNJx1E4rdTTFlG4dEhPopu9",
	secret,
	"read:passes create:passes",
);

await issuePass(
	"https://passes-web.onrender.com/passes",
	token,
	"Ivan Turkalj",
	"HR-123456789",
);
await issuePass(
	"https://passes-web.onrender.com/passes",
	token,
	"Jan Koljenić",
	"HR-987654321",
);
console.log("Izdane 2 propusnice");
