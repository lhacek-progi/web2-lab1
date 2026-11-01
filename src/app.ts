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

const { auth: oidcAuth, requiresAuth } = oidc;

//citanje env varijable, ako je nema, rusi apk sa porukom
function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Environment variable ${name} is not set`);
	return value;
}

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = //uzima se ova druga jer smo an renderu, nema .env na oblaku, uzeo bi prvi da pokrecem apk lokalno
	(
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
app.set("trust proxy", true); // Render je ispred kao HTTPS proxy
app.set("view engine", "ejs");
app.set(
	"views",
	path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "views"),
);

const checkJwt = jwtAuth({ issuerBaseURL: ISSUER, audience: AUDIENCE }); //middleware protector, accepta samo tokene potpisane od naseg authoritya

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
		res.json(pass); //dobijemo pass
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

const oidcMiddleware = oidcAuth({
	authRequired: false,
	auth0Logout: true,
	issuerBaseURL: ISSUER,
	baseURL: BASE_URL,
	clientID: CLIENT_ID,
	clientSecret: CLIENT_SECRET,
	secret: SESSION_SECRET,
	authorizationParams: {
		response_type: "code",
		scope: "openid profile email",
	},
});

//sve rute ispod ove linije prolaze kroz Middleware
app.use(oidcMiddleware);

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

app.post("/admin/passes/:id/cancel", requiresAuth(), async (req, res) => {
	await cancelPass(req.params.id as string);
	res.redirect("/");
});

app.post("/admin/passes/:id/delete", requiresAuth(), async (req, res) => {
	await deletePass(req.params.id as string);
	res.redirect("/");
});

app.use(
	//error handler
	(
		err: { status?: number; statusCode?: number; message?: string },
		req: Request,
		res: Response,
		_next: NextFunction,
	) => {
		const status = err.status ?? err.statusCode ?? 500;

		if (status >= 500) {
			console.error(err);
		}

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
