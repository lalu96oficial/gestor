import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db/pg';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const q = db();

    let shareTable = 'public_links';
    try {
      const tbls = await q.query(
        `select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'token'
            and table_name not in ('email_tokens', 'sessions')
          limit 1`
      );
      if (tbls.length) shareTable = String(tbls[0].table_name);
    } catch {}

    const rows = await q.query(
      `with recursive archive_folders as (
         select id, name, parent_id
           from folders
          where kind = 'archive' and deleted_at is null
         union all
         select f.id, f.name, f.parent_id
           from folders f
           join archive_folders af on f.parent_id = af.id
          where f.deleted_at is null
       )
       select
         fi.id as file_id,
         fi.name as file_name,
         fi.mime_type,
         af.id as folder_id,
         af.name as folder_name,
         af.parent_id as folder_parent_id
       from files fi
       join archive_folders af on fi.folder_id = af.id
       where fi.deleted_at is null
         and (
           fi.mime_type like 'video/%'
           or fi.name ~* '\\.(mp4|mkv|webm|mov|avi|m3u8)$'
         )
       order by af.name asc, fi.name asc`
    );

    const origin = req.nextUrl.origin || 'https://nube.morvehtv.com';
    const carpetasMap = new Map<string, { nombre: string; archivos: { nombre: string; url_embed: string; formato: string }[] }>();

    for (const r of rows) {
      const fileId = String(r.file_id);
      const fileName = String(r.file_name);
      const folderName = r.folder_parent_id === null ? 'Películas' : String(r.folder_name || 'Sin carpeta');

      let token = '';
      try {
        const existing = await q.query(
          `select token from ${shareTable} where file_id = $1 limit 1`,
          [fileId]
        );
        if (existing.length && existing[0].token) {
          token = String(existing[0].token);
        } else {
          token = crypto.randomBytes(16).toString('hex');
          await q.query(
            `insert into ${shareTable} (file_id, token) values ($1, $2)`,
            [fileId, token]
          );
        }
      } catch {
        token = crypto.randomBytes(16).toString('hex');
      }

      if (!carpetasMap.has(folderName)) {
        carpetasMap.set(folderName, { nombre: folderName, archivos: [] });
      }

      carpetasMap.get(folderName)!.archivos.push({
        nombre: fileName,
        url_embed: `${origin}/v/${token}`,
        formato: 'iframe',
      });
    }

    return NextResponse.json(
      { carpetas: Array.from(carpetasMap.values()) },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno generando catálogo';
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
