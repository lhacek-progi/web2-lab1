import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";

export async function getToken(
	authority: string, //adresa Auth0 tenanta
	audience: string, //ID API-a
	clientId: string,
	clientSecret: string, //username i password automata
	scope: string, //dozvole koje se traze, npr. create:passes
): Promise<string> {
	const tokenUrl = `${authority.replace(/\/+$/, "")}/oauth/token`; //adresa token enpointa, regex za brisanje vise od jedne kose crte

	const response = await fetch(tokenUrl, {
		//slanje http requesta i cekanje responsea
		method: "POST", //saljemo podatke
		headers: { "Content-Type": "application/x-www-form-urlencoded" }, //standard za token enpoint po RFC-u
		body: new URLSearchParams({
			grant_type: "client_credentials",
			client_id: clientId,
			client_secret: clientSecret,
			audience: audience,
			scope: scope,
		}),
	});

	if (!response.ok) {
		throw new Error(`Token request failed with status ${response.status}`);
	}

	const data = (await response.json()) as { access_token?: string }; //response vracen u JSON-u, obecamo typescriptu sda je acess_token polje tipa string
	if (!data.access_token) {
		throw new Error(
			`Token response did not contain access_token (status ${response.status})`,
		);
	}
	return data.access_token;
}

export async function issuePass(
	url: string, //adresa enpointa (https://tvojapp.onrender.com/passes)
	token: string,
	name: string,
	document: string, //podaci osobe za koju se issuea pass
): Promise<void> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json", //body poruke je JSON objekt
			Accept: "image/png",
		},
		body: JSON.stringify({ name, document }),
	});

	if (response.status !== 201) {
		throw new Error(`Issue pass request failed with status ${response.status}`);
	}

	const location = response.headers.get("location"); //REST api garantira da vraca resurs pod location headerom
	if (!location) {
		throw new Error(
			`Location header missing in response (status ${response.status})`,
		);
	}

	// location može biti apsolutna ili relativna adresa; identifikator je zadnji dio putanje
	const segments = new URL(location, url).pathname.split("/").filter(Boolean);
	const id = segments.at(-1); //uzimamo ID, koji je uvijek na kraju URL-a
	if (!id) {
		throw new Error(
			`Could not extract pass id from Location header (status ${response.status})`,
		);
	}
	//spremanje PNG-a
	const png = Buffer.from(await response.arrayBuffer()); //pretvaranje u Node veziju buffera
	await writeFile(`${decodeURIComponent(id)}.png`, png); //spremanje slike u datoteku, decodeURIComponent jer se moze desiti da se razmak procita kao %20
}
