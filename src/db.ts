import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error("DATABASE_URL is not set");
}

// Render External URL (…render.com) zahtijeva SSL; Internal URL i lokalna baza ne.
const useSsl = connectionString.includes(".render.com");

export const pool = new pg.Pool({
	connectionString,
	ssl: useSsl ? { rejectUnauthorized: false } : false,
});

export type PassStatus = "ACTIVE" | "CANCELLED";

export interface Pass {
	id: string;
	name: string;
	document: string;
	issuedAt: string;
	status: PassStatus;
}

interface PassRow {
	id: string;
	name: string;
	document: string;
	issued_at: Date;
	status: PassStatus;
}

function toPass(row: PassRow): Pass {
	return {
		id: row.id,
		name: row.name,
		document: row.document,
		issuedAt: row.issued_at.toISOString(),
		status: row.status,
	};
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

export async function initDb(): Promise<void> {
	await pool.query(`
        CREATE TABLE IF NOT EXISTS passes (
            id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name      TEXT NOT NULL,
            document  TEXT NOT NULL,
            issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            status    TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'CANCELLED'))
        )
    `);
}

export async function getStats(): Promise<{ total: number; active: number }> {
	const { rows } = await pool.query<{ total: number; active: number }>(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'ACTIVE')::int AS active
        FROM passes
    `);
	return rows[0];
}

export async function listPasses(): Promise<Pass[]> {
	const { rows } = await pool.query<PassRow>(
		"SELECT * FROM passes ORDER BY issued_at DESC",
	);
	return rows.map(toPass);
}

export async function findPass(id: string): Promise<Pass | null> {
	if (!isUuid(id)) return null;
	const { rows } = await pool.query<PassRow>(
		"SELECT * FROM passes WHERE id = $1",
		[id],
	);
	return rows[0] ? toPass(rows[0]) : null;
}

export async function createPass(
	name: string,
	document: string,
): Promise<Pass> {
	const { rows } = await pool.query<PassRow>(
		"INSERT INTO passes (name, document) VALUES ($1, $2) RETURNING *",
		[name, document],
	);
	return toPass(rows[0]);
}

export async function cancelPass(id: string): Promise<void> {
	if (!isUuid(id)) return;
	await pool.query("UPDATE passes SET status = 'CANCELLED' WHERE id = $1", [
		id,
	]);
}

export async function deletePass(id: string): Promise<void> {
	if (!isUuid(id)) return;
	await pool.query("DELETE FROM passes WHERE id = $1", [id]);
}
