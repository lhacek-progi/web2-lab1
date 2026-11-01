import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { auth as jwtAuth, requiredScopes } from "express-oauth2-jwt-bearer";
import oidc from "express-openid-connect";
import QRCode from "qrcode";
import {
	cancelPass,
	createPass,
	deletePass,
	findPass,
	getStats,
	initDb,
	listPasses,
} from "./db.js";

// express-openid-connect je CommonJS paket, pa requiresAuth nije dostupan kao named import
const { auth: oidcAuth, requiresAuth } = oidc;

// ---------- konfiguracija iz environment varijabli ----------
function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Environment variable ${name} is not set`);
	return value;
}

const PORT = Number(process.env.PORT ?? 3000);
// Render sam postavlja RENDER_EXTERNAL_URL, lokalno koristimo BASE_URL iz .env
const BASE_URL = (
	process.env.BASE_URL ??
	process.env.RENDER_EXTERNAL_URL ??
	`http://localhost:${PORT}`
).replace(/\/+$/, "");
const ISSUER = requireEnv("AUTH0_ISSUER_BASE_URL");
const AUDIENCE = requireEnv("AUTH0_AUDIENCE");
const CLIENT_ID = requireEnv("AUTH0_CLIENT_ID");
const CLIENT_SECRET = requireEnv("AUTH0_CLIENT_SECRET");
const SESSION_SECRET = requireEnv("SESSION_SECRET");

const app = express();
app.set("trust proxy", true); // Render je ispred nas kao HTTPS proxy
app.set("view engine", "ejs");
app.set(
	"views",
	path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "views"),
);

// ---------- API za automat: OAuth2 Client Credentials (M2M) ----------
// "Zaštitar": provjerava potpis, iss, aud i exp access tokena. Bez tokena / nevaljan -> 401.
const checkJwt = jwtAuth({ issuerBaseURL: ISSUER, audience: AUDIENCE });

app.get(
	"/passes/:id",
	checkJwt,
	requiredScopes("read:passes"),
	async (req, res) => {
		const pass = await findPass(req.params.id as string);
		if (!pass) {
			res.status(404).json({ error: "Pass not found" });
			return;
		}
		res.json(pass);
	},
);

app.post(
	"/passes",
	checkJwt,
	requiredScopes("create:passes"),
	express.json(),
	async (req, res) => {
		const name: unknown = req.body?.name;
		const document: unknown = req.body?.document;
		if (
			typeof name !== "string" ||
			!name.trim() ||
			typeof document !== "string" ||
			!document.trim()
		) {
			res
				.status(400)
				.json({ error: "Fields 'name' and 'document' are required" });
			return;
		}

		const pass = await createPass(name.trim(), document.trim());
		// QR vodi na JAVNU stranicu, Location na API pristupnu točku
		const png = await QRCode.toBuffer(`${BASE_URL}/info/${pass.id}`, {
			type: "png",
			width: 300,
		});

		res
			.status(201)
			.location(`${BASE_URL}/passes/${pass.id}`)
			.type("image/png")
			.send(png);
	},
);

// ---------- web stranice: OpenID Connect login korisnika ----------
app.use(
	oidcAuth({
		authRequired: false, // početna i /info su javne
		auth0Logout: true,
		issuerBaseURL: ISSUER,
		baseURL: BASE_URL,
		clientID: CLIENT_ID,
		clientSecret: CLIENT_SECRET,
		secret: SESSION_SECRET,
		// Authorization Code flow: Auth0 server vraća "code" na /callback, a server ga uz
		// client_secret mijenja za ID token. Radi i preko http://localhost.
		authorizationParams: {
			response_type: "code",
			scope: "openid profile email",
		},
	}),
);

app.get("/", async (req, res) => {
	const stats = await getStats();
	const loggedIn = req.oidc.isAuthenticated();
	const passes = loggedIn ? await listPasses() : [];
	res.render("index", { stats, loggedIn, user: req.oidc.user, passes });
});

app.get("/info/:id", async (req, res) => {
	const pass = await findPass(req.params.id);
	if (!pass) {
		res.status(404).render("info", { pass: null });
		return;
	}
	res.render("info", { pass });
});

const form = express.urlencoded({ extended: false });

app.post("/admin/passes/:id/cancel", requiresAuth(), form, async (req, res) => {
	await cancelPass(req.params.id as string);
	res.redirect("/");
});

app.post("/admin/passes/:id/delete", requiresAuth(), form, async (req, res) => {
	await deletePass(req.params.id as string);
	res.redirect("/");
});

// ---------- greške ----------
app.use(
	(
		err: { status?: number; statusCode?: number; message?: string },
		req: Request,
		res: Response,
		_next: NextFunction,
	) => {
		const status = err.status ?? err.statusCode ?? 500;
		if (status >= 500) console.error(err);
		const message =
			status >= 500 ? "Internal server error" : (err.message ?? "Error");
		if (req.path.startsWith("/passes")) {
			res.status(status).json({ error: message });
		} else {
			res.status(status).send(message);
		}
	},
);

await initDb();
app.listen(PORT, () => {
	console.log(`Server running on ${BASE_URL} (port ${PORT})`);
});
