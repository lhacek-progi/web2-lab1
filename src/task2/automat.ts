import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";

export async function getToken(
	authority: string,
	audience: string,
	clientId: string,
	clientSecret: string,
	scope: string,
): Promise<string> {
	const tokenUrl = `${authority.replace(/\/+$/, "")}/oauth/token`;

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

	const data = (await response.json()) as { access_token?: string };
	if (!data.access_token) {
		throw new Error(
			`Token response did not contain access_token (status ${response.status})`,
		);
	}
	return data.access_token;
}

export async function issuePass(
	url: string,
	token: string,
	name: string,
	document: string,
): Promise<void> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "image/png",
		},
		body: JSON.stringify({ name, document }),
	});

	if (response.status !== 201) {
		throw new Error(`Issue pass request failed with status ${response.status}`);
	}

	const location = response.headers.get("location");
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
